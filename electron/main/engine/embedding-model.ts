import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { EmbeddingModelSource } from '@shared/types/narracat'

/**
 * 解析打包进客户端的本地 embedding 模型根目录（ADR-0024）。
 *
 * 返回的是 transformers.js `localModelPath` 期望的根目录——其下按 {org}/{model}/... 布局，
 * 即模型在 `<root>/Xenova/bge-base-zh-v1.5/...`。仅当该模型权重确实存在时返回路径；
 * 否则返回 undefined，由 MCP server 回退到按需下载（开发态未 prepare 时友好）。
 *
 * - 打包态：`<resourcesPath>/NarraCatEmbeddingModel`（electron-builder extraResources 的 to）
 * - 开发态：`<appRoot>/build/embedding-model`（prepare-embedding-model.mjs 的产出）
 */

type FileExists = (path: string) => boolean

export const PACKAGED_EMBEDDING_MODEL_DIR = 'NarraCatEmbeddingModel'
const DEV_EMBEDDING_MODEL_DIR = join('build', 'embedding-model')
// 用于探测「模型是否真的就绪」的标志权重文件（q8）。
const MODEL_WEIGHT_REL = join('Xenova', 'bge-base-zh-v1.5', 'onnx', 'model_quantized.onnx')

export interface ResolveEmbeddingModelPathOptions {
  appRoot: string
  resourcesPath?: string
  fileExists?: FileExists
}

function isPackagedAppRoot(appRoot: string, resourcesPath?: string): boolean {
  return Boolean(resourcesPath && appRoot === join(resourcesPath, 'app.asar'))
}

/** 候选根目录（按打包态/开发态调整优先序，与 engine.ts 一致） */
function candidates(appRoot: string, resourcesPath?: string): string[] {
  const packaged = resourcesPath ? join(resourcesPath, PACKAGED_EMBEDDING_MODEL_DIR) : undefined
  const dev = join(appRoot, DEV_EMBEDDING_MODEL_DIR)
  const ordered = isPackagedAppRoot(appRoot, resourcesPath) ? [packaged, dev] : [dev, packaged]
  return ordered.filter((value): value is string => Boolean(value))
}

/**
 * 解析 embedding 模型来源（含已检查的候选路径），供向量健康诊断展示与判定。
 *
 * - 命中本地权重 → `bundled-offline`（打包档内置离线，spawn 时注入路径、禁联网）；
 * - 未命中且打包态 → `missing`（本应内置却找不到，是降级风险，需暴露解析路径）；
 * - 未命中且开发态 → `on-demand-download`（无内置模型，引擎回退按需下载，dev 友好）。
 */
export function describeEmbeddingModelSource({
  appRoot,
  resourcesPath,
  fileExists = existsSync,
}: ResolveEmbeddingModelPathOptions): EmbeddingModelSource {
  const checked = candidates(appRoot, resourcesPath)
  const modelPath = checked.find((root) => fileExists(join(root, MODEL_WEIGHT_REL)))
  if (modelPath) return { kind: 'bundled-offline', modelPath, candidates: checked }
  if (isPackagedAppRoot(appRoot, resourcesPath)) return { kind: 'missing', candidates: checked }
  return { kind: 'on-demand-download', candidates: checked }
}

/**
 * @returns 本地模型根目录（存在权重时）；否则 undefined（→ 按需下载回退）
 */
export function resolveEmbeddingModelPath(options: ResolveEmbeddingModelPathOptions): string | undefined {
  return describeEmbeddingModelSource(options).modelPath
}
