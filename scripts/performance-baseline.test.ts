import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

import {
  collectRendererAssetMetrics,
  createAgentStreamingBenchmarkEvents,
  evaluatePerformanceBudgets,
  formatPerformanceReport,
  type PerformanceBaselineResult,
} from './performance-baseline'

async function createAssetFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narracat-assets-'))
  await mkdir(join(root, 'nested'), { recursive: true })
  await Promise.all([
    writeFile(join(root, 'index.js'), 'console.log("hello")\n', 'utf-8'),
    writeFile(join(root, 'style.css'), '.root { color: red; }\n', 'utf-8'),
    writeFile(join(root, 'font.woff2'), Buffer.alloc(128, 1)),
    writeFile(join(root, 'nested', 'cover.png'), Buffer.alloc(256, 2)),
    writeFile(join(root, 'manifest.json'), '{"ok":true}\n', 'utf-8'),
  ])
  return root
}

function createBaselineResult(overrides: Partial<PerformanceBaselineResult> = {}): PerformanceBaselineResult {
  const result: PerformanceBaselineResult = {
    generatedAt: '2026-05-24T00:00:00.000Z',
    buildRan: false,
    rendererAssets: {
      assetDir: '/tmp/assets',
      fileCount: 2,
      totalBytes: 100,
      totalGzipBytes: 90,
      groups: {
        js: { count: 1, totalBytes: 40, totalGzipBytes: 35, largest: null },
        css: { count: 1, totalBytes: 10, totalGzipBytes: 9, largest: null },
        font: { count: 0, totalBytes: 0, totalGzipBytes: 0, largest: null },
        image: { count: 0, totalBytes: 0, totalGzipBytes: 0, largest: null },
        other: { count: 0, totalBytes: 50, totalGzipBytes: 46, largest: null },
      },
      largestFiles: [],
    },
    workbenchProjectDetail: {
      results: [
        { chapterCount: 500, durationMs: 10, tocItems: 505, treeItems: 520, selectedChapter: 250 },
        { chapterCount: 1000, durationMs: 20, tocItems: 1010, treeItems: 1030, selectedChapter: 500 },
        { chapterCount: 2000, durationMs: 40, tocItems: 2020, treeItems: 2050, selectedChapter: 1000 },
      ],
    },
    agentStreamingReducer: {
      eventCount: 8000,
      deltaCount: 7900,
      outputCharacters: 120000,
      durationMs: 15,
      messageCount: 2,
      partCount: 4,
    },
    budgets: {
      renderer: {
        totalAssetBytes: 200,
        totalJavaScriptBytes: 100,
        totalCssBytes: 100,
        totalFontBytes: 100,
        totalImageBytes: 100,
      },
      workbenchProjectDetailMs: {
        500: 100,
        1000: 100,
        2000: 100,
      },
      agentStreamingReducerMs: 100,
    },
  }

  return { ...result, ...overrides }
}

describe('performance baseline', () => {
  test('collects renderer assets by group and keeps largest files', async () => {
    const assetDir = await createAssetFixture()

    const metrics = await collectRendererAssetMetrics(assetDir)

    expect(metrics.fileCount).toBe(5)
    expect(metrics.groups.js.count).toBe(1)
    expect(metrics.groups.css.count).toBe(1)
    expect(metrics.groups.font.count).toBe(1)
    expect(metrics.groups.image.count).toBe(1)
    expect(metrics.groups.other.count).toBe(1)
    expect(metrics.groups.image.largest?.path).toContain('cover.png')
    expect(metrics.largestFiles[0]?.path).toContain('cover.png')
  })

  test('evaluates budget warnings without making warning policy implicit', () => {
    const result = createBaselineResult({
      rendererAssets: {
        ...createBaselineResult().rendererAssets,
        totalBytes: 250,
      },
    })

    const checks = evaluatePerformanceBudgets(result)

    expect(checks.find((check) => check.id === 'renderer.total-assets')?.status).toBe('warn')
    expect(checks.find((check) => check.id === 'renderer.total-js')?.status).toBe('pass')
  })

  test('creates a long Agent stream with start, deltas, tool events, and completion', () => {
    const events = createAgentStreamingBenchmarkEvents(2400)

    expect(events[0]?.type).toBe('run.started')
    expect(events.at(-1)?.type).toBe('run.completed')
    expect(events.filter((event) => event.type === 'message.delta')).toHaveLength(2400)
    expect(events.some((event) => event.type === 'tool.started')).toBe(true)
    expect(events.some((event) => event.type === 'reasoning.delta')).toBe(true)
  })

  test('prints budget update guidance in the human report', () => {
    const result = createBaselineResult()
    const report = formatPerformanceReport(result, evaluatePerformanceBudgets(result))

    expect(report).toContain('DEFAULT_BUDGETS')
    expect(report).toContain('bun --no-cache run perf:baseline')
    expect(report).toContain('Workbench Project Detail')
    expect(report).toContain('Agent Streaming Reducer')
  })
})
