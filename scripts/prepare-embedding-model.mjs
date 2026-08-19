#!/usr/bin/env node
/**
 * 构建期把 NovelMemory 的本地 embedding 模型（bge-base-zh-v1.5 q8）拉到 build/，
 * 供 electron-builder 经 extraResources 打进安装包，实现首次使用离线、免下载。
 *
 * 与 prepare-headless-agent-runtime.mjs 同套路：下载到 build/ 下、SHA256 校验、幂等跳过。
 * 模型二进制不进 git 仓库（build/ 已 gitignore）。
 *
 * 用法：
 *   node scripts/prepare-embedding-model.mjs           下载+校验（缺失或校验失败才下）
 *   node scripts/prepare-embedding-model.mjs --check    仅校验是否就绪（CI/打包前置）
 */
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

export const EMBEDDING_MODEL_RESOURCE_NAME = 'NarraCatEmbeddingModel'
export const EMBEDDING_MODEL_ID = 'Xenova/bge-base-zh-v1.5'
export const EMBEDDING_MODEL_DTYPE = 'q8'

// 加载 q8 所需的最小文件集（已实测 transformers.js 可据此纯本地加载），各文件 SHA256 锁定。
const FILES = [
  { path: 'config.json', sha256: '855206771223efad2dfb8e212a716b20c4c71c8094309ca2da79d31bacb03276' },
  { path: 'tokenizer_config.json', sha256: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3' },
  { path: 'tokenizer.json', sha256: '7dfbf1966ebf99d471c3796e9b457329d2b2182b817e144f1e904b957745c839' },
  { path: 'onnx/model_quantized.onnx', sha256: 'b665f3bba56c3119bc76ba131ebcc544d720a7408cb11581bdf354aaa0198d43' },
]

// HF_ENDPOINT 是 HuggingFace 官方镜像协议（国内常用 https://hf-mirror.com）；
// 本机网络直连 huggingface.co 不可达时用它绕开。缺省官方源。
const HF_ENDPOINT = process.env.HF_ENDPOINT?.trim().replace(/\/$/, '') || 'https://huggingface.co'
const HF_BASE = `${HF_ENDPOINT}/${EMBEDDING_MODEL_ID}/resolve/main`

export function embeddingModelOutputDir(root = repoRoot) {
  return join(root, 'build', 'embedding-model')
}

/** localModelPath 期望的 {root}/{org}/{model}/... 布局下，该模型的目录 */
function modelDir(root = repoRoot) {
  return join(embeddingModelOutputDir(root), ...EMBEDDING_MODEL_ID.split('/'))
}

async function sha256Of(path) {
  const buf = await readFile(path)
  return createHash('sha256').update(buf).digest('hex')
}

async function fileMatches(path, sha256) {
  try {
    await access(path)
    return (await sha256Of(path)) === sha256
  } catch {
    return false
  }
}

async function downloadFile(url, dest, sha256) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败 ${url}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const actual = createHash('sha256').update(buf).digest('hex')
  if (actual !== sha256) {
    throw new Error(`SHA256 不匹配 ${url}\n  期望 ${sha256}\n  实际 ${actual}`)
  }
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, buf)
}

/** 校验模型四件套是否就绪（present + sha 匹配） */
export async function isEmbeddingModelReady(root = repoRoot) {
  const dir = modelDir(root)
  for (const f of FILES) {
    if (!(await fileMatches(join(dir, f.path), f.sha256))) return false
  }
  return true
}

export async function prepareEmbeddingModel({ root = repoRoot, checkOnly = false } = {}) {
  const dir = modelDir(root)
  if (checkOnly) {
    const ready = await isEmbeddingModelReady(root)
    if (!ready) throw new Error(`embedding 模型未就绪于 ${dir}，请先运行 node scripts/prepare-embedding-model.mjs`)
    console.log(`✓ embedding 模型已就绪: ${EMBEDDING_MODEL_ID} (${EMBEDDING_MODEL_DTYPE}) @ ${dir}`)
    return dir
  }

  for (const f of FILES) {
    const dest = join(dir, f.path)
    if (await fileMatches(dest, f.sha256)) {
      console.log(`跳过（已就绪）: ${f.path}`)
      continue
    }
    console.log(`下载: ${f.path} …`)
    await downloadFile(`${HF_BASE}/${f.path}`, dest, f.sha256)
  }
  console.log(`✓ embedding 模型就绪: ${EMBEDDING_MODEL_ID} (${EMBEDDING_MODEL_DTYPE}) @ ${dir}`)
  return dir
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  prepareEmbeddingModel({ checkOnly: process.argv.includes('--check') }).catch((error) => {
    console.error(`prepare-embedding-model 失败: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
