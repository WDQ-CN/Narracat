import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  firstEmbeddingFailureReason,
  mapEmbeddingHealthProbeResult,
  parseSelfTestReportText,
  runEmbeddingHealthProbe,
  summarizeEmbeddingHealth,
} from './embedding-probe'
import type {
  EmbeddingModelSource,
  EmbeddingProbeProcessInfo,
  EmbeddingSelfTestReport,
} from '@shared/types/narracat'

function passingReport(durationMs = 42): EmbeddingSelfTestReport {
  return {
    ok: true,
    modelLoad: { ok: true, modelName: 'Xenova/bge-base-zh-v1.5', dim: 768 },
    embed: { ok: true, dim: 768, normalized: true, durationMs },
    sqliteVec: { ok: true },
    retrieval: { ok: true, hit: true, topDistance: 0 },
  }
}

const okProcess: EmbeddingProbeProcessInfo = {
  ok: true,
  command: 'memory-worker',
  args: ['__embedding_selftest__'],
  stdout: '',
  stderr: '',
  exitCode: 0,
  signal: null,
}

const bundledSource: EmbeddingModelSource = {
  kind: 'bundled-offline',
  modelPath: '/res/NarraCatEmbeddingModel',
  candidates: ['/res/NarraCatEmbeddingModel'],
}

describe('parseSelfTestReportText', () => {
  test('完整报告 JSON 放行', () => {
    const report = parseSelfTestReportText(JSON.stringify(passingReport()))
    expect(report?.ok).toBe(true)
    expect(report?.embed.dim).toBe(768)
  })

  test('非 JSON → null', () => {
    expect(parseSelfTestReportText('not json at all')).toBeNull()
  })

  test('缺少自检步骤字段 → null（契约不完整不放行）', () => {
    expect(parseSelfTestReportText(JSON.stringify({ ok: true }))).toBeNull()
  })
})

describe('firstEmbeddingFailureReason', () => {
  test('内置模型未找到优先于一切', () => {
    const missing: EmbeddingModelSource = { kind: 'missing', candidates: ['/res/NarraCatEmbeddingModel'] }
    expect(firstEmbeddingFailureReason({ modelSource: missing, selfTest: null, process: okProcess })).toBe(
      '内置模型未找到',
    )
  })

  test('无自检结果 + 通道报错 → 自检进程异常', () => {
    const proc: EmbeddingProbeProcessInfo = { ...okProcess, ok: false, error: '记忆工具调用超时（120s）：__embedding_selftest__' }
    expect(firstEmbeddingFailureReason({ modelSource: bundledSource, selfTest: null, process: proc })).toContain(
      '自检进程异常',
    )
  })

  test('sqlite-vec 不可用被精确报出', () => {
    const report = passingReport()
    report.sqliteVec = { ok: false, error: 'extension not loadable' }
    expect(firstEmbeddingFailureReason({ modelSource: bundledSource, selfTest: report, process: okProcess })).toBe(
      'sqlite-vec 扩展不可用：extension not loadable',
    )
  })

  test('模型加载失败先于检索环节', () => {
    const report = passingReport()
    report.modelLoad = { ok: false, error: 'onnx model missing' }
    report.retrieval = { ok: false }
    expect(firstEmbeddingFailureReason({ modelSource: bundledSource, selfTest: report, process: okProcess })).toBe(
      '模型加载失败：onnx model missing',
    )
  })
})

describe('summarizeEmbeddingHealth', () => {
  test('全链路通过 → ok / 不降级 / 正常结论带耗时', () => {
    const out = summarizeEmbeddingHealth({ modelSource: bundledSource, selfTest: passingReport(88), process: okProcess })
    expect(out.ok).toBe(true)
    expect(out.degraded).toBe(false)
    expect(out.summary).toContain('向量语义检索正常')
    expect(out.summary).toContain('88ms')
  })

  test('失败 → degraded + 降级结论含原因', () => {
    const report = passingReport()
    report.ok = false
    report.retrieval = { ok: false, error: 'KNN 未命中刚写入的向量' }
    const out = summarizeEmbeddingHealth({ modelSource: bundledSource, selfTest: report, process: okProcess })
    expect(out.ok).toBe(false)
    expect(out.degraded).toBe(true)
    expect(out.summary).toContain('降级为纯 FTS')
    expect(out.summary).toContain('向量检索往返失败')
  })
})

describe('mapEmbeddingHealthProbeResult', () => {
  test('透传 checkedAt / modelSource / selfTest / process 并附结论', () => {
    const result = mapEmbeddingHealthProbeResult({
      checkedAt: '2026-06-19T00:00:00.000Z',
      modelSource: bundledSource,
      selfTest: passingReport(),
      process: okProcess,
    })
    expect(result.checkedAt).toBe('2026-06-19T00:00:00.000Z')
    expect(result.ok).toBe(true)
    expect(result.modelSource.kind).toBe('bundled-offline')
    expect(result.selfTest?.retrieval.hit).toBe(true)
  })
})

describe('runEmbeddingHealthProbe（memory worker 通道）', () => {
  test('worker 返回通过报告 → 结论正常', async () => {
    const result = await runEmbeddingHealthProbe({
      appRoot: '/repo',
      fileExists: () => false,
      checkedAt: 'T',
      callSelfTest: async () => JSON.stringify(passingReport(12)),
    })
    expect(result.ok).toBe(true)
    expect(result.degraded).toBe(false)
    expect(result.modelSource.kind).toBe('on-demand-download') // dev 无内置模型
    expect(result.summary).toContain('向量语义检索正常')
    expect(result.process.command).toBe('memory-worker')
  })

  test('通道抛错（worker 故障/超时）→ 进程级失败被汇总', async () => {
    const result = await runEmbeddingHealthProbe({
      appRoot: '/repo',
      fileExists: () => false,
      checkedAt: 'T',
      callSelfTest: async () => {
        throw new Error('记忆引擎进程已退出（code 1）')
      },
    })
    expect(result.ok).toBe(false)
    expect(result.degraded).toBe(true)
    expect(result.process.error).toContain('已退出')
    expect(result.summary).toContain('自检进程异常')
  })

  test('报告 JSON 损坏 → 解析失败判降级', async () => {
    const result = await runEmbeddingHealthProbe({
      appRoot: '/repo',
      fileExists: () => false,
      checkedAt: 'T',
      callSelfTest: async () => '{broken',
    })
    expect(result.ok).toBe(false)
    expect(result.summary).toContain('自检结果解析失败')
  })

  // P1 回归：打包态内置模型缺失必须直接判降级，不得跑自检（避免联网下载掩盖坏 RC 包）。
  test('打包态内置模型缺失 → 不调通道、判降级（不联网下载）', async () => {
    let called = false
    const resourcesPath = '/res'
    const result = await runEmbeddingHealthProbe({
      appRoot: join(resourcesPath, 'app.asar'), // 打包态判定 appRoot === join(resourcesPath, 'app.asar')
      resourcesPath,
      fileExists: () => false, // 无权重 → modelSource.kind = 'missing'
      checkedAt: 'T',
      callSelfTest: async () => {
        called = true
        return JSON.stringify(passingReport())
      },
    })
    expect(called).toBe(false)
    expect(result.modelSource.kind).toBe('missing')
    expect(result.ok).toBe(false)
    expect(result.degraded).toBe(true)
    expect(result.summary).toContain('内置模型未找到')
  })
})
