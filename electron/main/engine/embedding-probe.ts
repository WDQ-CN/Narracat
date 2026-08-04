import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describeEmbeddingModelSource } from './embedding-model.ts'
import { getMemoryHostFor } from '../memory/index.ts'
import { MEMORY_EMBEDDING_SELFTEST_TOOL } from '@shared/types/memory-rpc'
import type {
  EmbeddingHealthProbeResult,
  EmbeddingModelSource,
  EmbeddingProbeProcessInfo,
  EmbeddingSelfTestReport,
} from '@shared/types/narracat'

/**
 * Embedding 向量健康探针（#320，拆旧刀5 前置改走 memory worker）。
 *
 * 经 memory host 的 worker 级伪工具 `__embedding_selftest__` 进程内直调引擎自检
 * （模型加载 → 向量生成 → sqlite-vec → 检索往返，sqlite 注入 App 根 N-API 驱动），
 * 汇总成「向量语义检索正常 / 降级为纯 FTS（原因…）」的体检结论。探的就是生产路径本身
 * ——生产 embedding 自切片⑥起就跑在同一 worker 形态里，不再 spawn headless node。
 *
 * 解析/总结/来源分类均为纯函数，带单测；传输经 callSelfTest DI 注入（测试假通道）。
 */

type FileExists = (path: string) => boolean

const MAX_CAPTURED_OUTPUT_LENGTH = 8_000

export interface EmbeddingHealthProbeOptions {
  appRoot: string
  resourcesPath?: string
  /** userData 根：worker env 组装 + 探针哨兵项目目录归属（缺省落系统临时目录） */
  userDataPath?: string
  checkedAt?: string
  fileExists?: FileExists
  /** 测试注入点：缺省经 memory host 调 worker 伪工具，返回 EmbeddingSelfTestReport JSON 文本 */
  callSelfTest?: () => Promise<string>
}

function isStep(value: unknown): value is { ok: boolean } {
  return typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean'
}

/**
 * 校验 worker 返回的 EmbeddingSelfTestReport JSON 文本；形状不完整/损坏 → null（契约不放行）。
 */
export function parseSelfTestReportText(text: string): EmbeddingSelfTestReport | null {
  try {
    const parsed = JSON.parse(text) as Partial<EmbeddingSelfTestReport>
    if (typeof parsed?.ok !== 'boolean') return null
    if (!isStep(parsed.modelLoad) || !isStep(parsed.embed) || !isStep(parsed.sqliteVec) || !isStep(parsed.retrieval)) {
      return null
    }
    return parsed as EmbeddingSelfTestReport
  } catch {
    return null
  }
}

function withReason(prefix: string, error?: string): string {
  return error ? `${prefix}：${error}` : prefix
}

/** 命中第一处失败环节，给出可读原因（模型缺失 / 加载失败 / sqlite-vec 不可用 …）。 */
export function firstEmbeddingFailureReason({
  modelSource,
  selfTest,
  process: proc,
}: {
  modelSource: EmbeddingModelSource
  selfTest: EmbeddingSelfTestReport | null
  process: EmbeddingProbeProcessInfo
}): string {
  if (modelSource.kind === 'missing') return '内置模型未找到'
  if (!selfTest) {
    return proc.error ? `自检进程异常：${proc.error}` : '自检结果解析失败'
  }
  if (!selfTest.modelLoad.ok) return withReason('模型加载失败', selfTest.modelLoad.error)
  if (!selfTest.embed.ok) return withReason('向量生成异常', selfTest.embed.error)
  if (!selfTest.sqliteVec.ok) return withReason('sqlite-vec 扩展不可用', selfTest.sqliteVec.error)
  if (!selfTest.retrieval.ok) return withReason('向量检索往返失败', selfTest.retrieval.error)
  // 自检各环节都 ok，但通道本身异常（worker 故障 / 超时）——
  // 不能仅凭 selfTest.ok 判健康（拿到报告后通道仍可能报错，按降级处理）。
  if (!proc.ok) {
    return proc.error
      ? `自检进程异常结束：${proc.error}`
      : `自检进程异常退出（exitCode ${proc.exitCode ?? 'null'}${proc.signal ? `, signal ${proc.signal}` : ''}）`
  }
  return '未知原因'
}

/** 汇总成 ok / degraded / 一句话结论。健康要求自检通过「且」通道正常收尾。 */
export function summarizeEmbeddingHealth(input: {
  modelSource: EmbeddingModelSource
  selfTest: EmbeddingSelfTestReport | null
  process: EmbeddingProbeProcessInfo
}): { ok: boolean; degraded: boolean; summary: string } {
  if (input.process.ok && input.selfTest?.ok) {
    const ms = input.selfTest.embed.durationMs
    return {
      ok: true,
      degraded: false,
      summary: ms != null ? `向量语义检索正常（向量生成 ${ms}ms）` : '向量语义检索正常',
    }
  }
  return { ok: false, degraded: true, summary: `降级为纯 FTS（${firstEmbeddingFailureReason(input)}）` }
}

export function mapEmbeddingHealthProbeResult({
  checkedAt,
  modelSource,
  selfTest,
  process: proc,
}: {
  checkedAt: string
  modelSource: EmbeddingModelSource
  selfTest: EmbeddingSelfTestReport | null
  process: EmbeddingProbeProcessInfo
}): EmbeddingHealthProbeResult {
  const { ok, degraded, summary } = summarizeEmbeddingHealth({ modelSource, selfTest, process: proc })
  return { ok, degraded, checkedAt, summary, modelSource, selfTest, process: proc }
}

/** 通道执行信息合成（EmbeddingProbeProcessInfo 形状沿用，command/args 标注 worker 通道来源）。 */
function workerProcessInfo(input: { ok: boolean; stdout?: string; error?: string }): EmbeddingProbeProcessInfo {
  return {
    ok: input.ok,
    command: 'memory-worker',
    args: [MEMORY_EMBEDDING_SELFTEST_TOOL],
    stdout: (input.stdout ?? '').slice(-MAX_CAPTURED_OUTPUT_LENGTH),
    stderr: '',
    exitCode: input.ok ? 0 : null,
    signal: null,
    ...(input.error ? { error: input.error } : {}),
  }
}

export async function runEmbeddingHealthProbe({
  appRoot,
  resourcesPath,
  userDataPath,
  checkedAt = new Date().toISOString(),
  fileExists = existsSync,
  callSelfTest,
}: EmbeddingHealthProbeOptions): Promise<EmbeddingHealthProbeResult> {
  const modelSource = describeEmbeddingModelSource({ appRoot, resourcesPath, fileExists })

  // P1：打包态内置模型缺失（kind==='missing' 仅在 packaged 下产生）直接判降级、不跑自检。
  // 否则未注入 NARRACAT_EMBEDDING_MODEL_PATH 时引擎会回退按需下载/缓存，一个缺模型的坏 RC 包
  // 仍可能经网络/缓存"通过"，掩盖问题、违背「离线可跑、不联网下载」。dev 的 on-demand-download
  // 不在此列（dev 联网下载是预期行为）。
  if (modelSource.kind === 'missing') {
    return mapEmbeddingHealthProbeResult({
      checkedAt,
      modelSource,
      selfTest: null,
      process: workerProcessInfo({ ok: false, error: '内置 embedding 模型未找到，跳过自检以避免联网下载' }),
    })
  }

  const runSelfTest =
    callSelfTest ??
    (async () => {
      // 哨兵项目：自检不触碰工具上下文，config.yaml 无需存在；独立 worker 键位不与真实项目混住。
      const probeProjectPath = join(userDataPath ?? tmpdir(), 'narracat-embedding-probe')
      const host = getMemoryHostFor({ appRoot, resourcesPath, userDataPath })
      const result = await host.callTool(probeProjectPath, MEMORY_EMBEDDING_SELFTEST_TOOL, {})
      return result.text
    })

  let text: string
  try {
    text = await runSelfTest()
  } catch (error) {
    return mapEmbeddingHealthProbeResult({
      checkedAt,
      modelSource,
      selfTest: null,
      process: workerProcessInfo({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    })
  }

  return mapEmbeddingHealthProbeResult({
    checkedAt,
    modelSource,
    selfTest: parseSelfTestReportText(text),
    process: workerProcessInfo({ ok: true, stdout: text }),
  })
}
