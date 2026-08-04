#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

import { chapterOutlinePath, volumeOutlinePath } from '../electron/main/novel/novel-layout'
import { loadNovelProjectDetail } from '../electron/main/novel/novel-project'
import { createEmptyAgentThread, reduceAgentEvent } from '../src/lib/agent-events'
import type { AgentEvent, AgentMessagePart, AgentThread } from '../shared/types/agent'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const kib = 1024
const mib = kib * kib

export const DEFAULT_BUDGETS = {
  renderer: {
    totalAssetBytes: 18 * mib,
    totalJavaScriptBytes: 3 * mib,
    totalCssBytes: 256 * kib,
    totalFontBytes: 13 * mib,
    totalImageBytes: 1536 * kib,
  },
  workbenchProjectDetailMs: {
    500: 350,
    1000: 700,
    2000: 1400,
  },
  agentStreamingReducerMs: 350,
} as const

type AssetGroup = 'js' | 'css' | 'font' | 'image' | 'other'
type BudgetStatus = 'pass' | 'warn'

export interface AssetFileMetric {
  path: string
  group: AssetGroup
  bytes: number
  gzipBytes: number
}

export interface AssetGroupMetric {
  count: number
  totalBytes: number
  totalGzipBytes: number
  largest: AssetFileMetric | null
}

export interface RendererAssetMetrics {
  assetDir: string
  fileCount: number
  totalBytes: number
  totalGzipBytes: number
  groups: Record<AssetGroup, AssetGroupMetric>
  largestFiles: AssetFileMetric[]
}

export interface WorkbenchProjectDetailBenchmark {
  chapterCount: number
  durationMs: number
  tocItems: number
  treeItems: number
  selectedChapter: number | null
}

export interface WorkbenchProjectDetailBaseline {
  results: WorkbenchProjectDetailBenchmark[]
}

export interface AgentStreamingReducerBaseline {
  eventCount: number
  deltaCount: number
  outputCharacters: number
  durationMs: number
  messageCount: number
  partCount: number
}

export interface PerformanceBaselineResult {
  generatedAt: string
  buildRan: boolean
  rendererAssets: RendererAssetMetrics
  workbenchProjectDetail: WorkbenchProjectDetailBaseline
  agentStreamingReducer: AgentStreamingReducerBaseline
  budgets: typeof DEFAULT_BUDGETS
}

export interface BudgetCheck {
  id: string
  label: string
  status: BudgetStatus
  actual: number
  budget: number
  unit: 'bytes' | 'ms'
}

interface CliOptions {
  skipBuild: boolean
  strict: boolean
  json: boolean
  help: boolean
}

function emptyAssetGroupMetric(): AssetGroupMetric {
  return {
    count: 0,
    totalBytes: 0,
    totalGzipBytes: 0,
    largest: null,
  }
}

function createAssetGroups(): Record<AssetGroup, AssetGroupMetric> {
  return {
    js: emptyAssetGroupMetric(),
    css: emptyAssetGroupMetric(),
    font: emptyAssetGroupMetric(),
    image: emptyAssetGroupMetric(),
    other: emptyAssetGroupMetric(),
  }
}

function classifyAsset(path: string): AssetGroup {
  const extension = extname(path).toLowerCase()
  if (extension === '.js') return 'js'
  if (extension === '.css') return 'css'
  if (['.ttf', '.otf', '.woff', '.woff2'].includes(extension)) return 'font'
  if (['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg', '.gif'].includes(extension)) return 'image'
  return 'other'
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) return walkFiles(path)
      if (entry.isFile()) return [path]
      return []
    }),
  )

  return files.flat()
}

export async function collectRendererAssetMetrics(
  assetDir = join(repoRoot, 'out', 'renderer', 'assets'),
): Promise<RendererAssetMetrics> {
  if (!existsSync(assetDir)) {
    throw new Error(
      `Renderer assets not found at ${relative(repoRoot, assetDir)}. Run bun --no-cache run build first, or run perf:baseline without --skip-build.`,
    )
  }

  const paths = await walkFiles(assetDir)
  if (paths.length === 0) {
    throw new Error(`Renderer assets directory is empty: ${relative(repoRoot, assetDir)}.`)
  }

  const files = await Promise.all(
    paths.map(async (path): Promise<AssetFileMetric> => {
      const content = await readFile(path)
      return {
        path: relative(repoRoot, path),
        group: classifyAsset(path),
        bytes: content.byteLength,
        gzipBytes: gzipSync(content).byteLength,
      }
    }),
  )
  const groups = createAssetGroups()

  for (const file of files) {
    const group = groups[file.group]
    group.count += 1
    group.totalBytes += file.bytes
    group.totalGzipBytes += file.gzipBytes
    if (!group.largest || file.bytes > group.largest.bytes) {
      group.largest = file
    }
  }

  return {
    assetDir,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    totalGzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0),
    groups,
    largestFiles: [...files].sort((left, right) => right.bytes - left.bytes).slice(0, 8),
  }
}

function volumeForChapter(chapter: number, chaptersPerVolume: number): number {
  return Math.floor((chapter - 1) / chaptersPerVolume) + 1
}

async function writeFixtureFile(root: string, relativePath: string, content: string): Promise<void> {
  const path = join(root, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf-8')
}

async function writeBatchedFiles(tasks: Array<() => Promise<void>>, batchSize = 100): Promise<void> {
  for (let index = 0; index < tasks.length; index += batchSize) {
    await Promise.all(tasks.slice(index, index + batchSize).map((task) => task()))
  }
}

export async function createLargeNovelProjectFixture({
  chapterCount,
  chaptersPerVolume = 100,
}: {
  chapterCount: number
  chaptersPerVolume?: number
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `narracat-perf-${chapterCount}-`))
  const volumeCount = volumeForChapter(chapterCount, chaptersPerVolume)
  const chapterToVolumeLines = Array.from({ length: chapterCount }, (_, index) => {
    const chapter = index + 1
    return `    ${chapter}: ${volumeForChapter(chapter, chaptersPerVolume)}`
  })
  const chaptersOutlined = Array.from({ length: chapterCount }, (_, index) => index + 1).join(', ')

  await Promise.all([
    writeFixtureFile(
      root,
      join('.narracat', 'config.yaml'),
      [
        'novel_id: perf-novel',
        `title: 性能基线 ${chapterCount} 章`,
        'language: zh-CN',
        'automation_level: auto',
        'target_chapter_words: null',
        'estimated_total_chapters: null',
        '',
      ].join('\n'),
    ),
    writeFixtureFile(
      root,
      join('.narracat', 'state.yaml'),
      [
        'progress:',
        '  last_completed_chapter: 0',
        '  completed_chapters: []',
        '  in_progress_chapter: null',
        `  total_chapters_planned: ${chapterCount}`,
        `  chapters_outlined: [${chaptersOutlined}]`,
        'word_count:',
        '  total: 0',
        '  by_chapter: {}',
        'checkpoint:',
        '  last_command: null',
        '  last_step: null',
        '  timestamp: null',
        'structure:',
        `  total_volumes: ${volumeCount}`,
        `  total_chapters_planned: ${chapterCount}`,
        '  chapter_to_volume:',
        ...chapterToVolumeLines,
        '',
      ].join('\n'),
    ),
    writeFixtureFile(root, join('bible', 'premise.md'), '# 核心前提\n\n性能基线项目。\n'),
    writeFixtureFile(root, join('bible', 'style-guide.md'), '# 风格指南\n\n第三人称。\n'),
    writeFixtureFile(root, join('bible', 'relationships.md'), '# 关系设定\n\n暂无。\n'),
    writeFixtureFile(root, join('bible', 'characters', '主角.md'), '# 主角\n\n目标明确。\n'),
    writeFixtureFile(root, join('bible', 'world', '世界.md'), '# 世界\n\n长篇世界。\n'),
    writeFixtureFile(root, join('outline', 'master-outline.md'), '# 全书大纲\n\n长篇测试。\n'),
  ])

  const tasks: Array<() => Promise<void>> = []
  for (let volume = 1; volume <= volumeCount; volume += 1) {
    tasks.push(() => writeFixtureFile(root, volumeOutlinePath(volume), `# 第 ${volume} 卷\n`))
  }
  for (let chapter = 1; chapter <= chapterCount; chapter += 1) {
    const volume = volumeForChapter(chapter, chaptersPerVolume)
    tasks.push(() =>
      writeFixtureFile(
        root,
        chapterOutlinePath(volume, chapter),
        `# 第${chapter}章: 性能章节 ${chapter}\n\n章节梗概。\n`,
      ),
    )
  }
  await writeBatchedFiles(tasks)

  return root
}

async function measureAsync(task: () => Promise<void>): Promise<number> {
  const startedAt = performance.now()
  await task()
  return performance.now() - startedAt
}

export async function runWorkbenchProjectDetailBaseline(
  chapterCounts = [500, 1000, 2000],
): Promise<WorkbenchProjectDetailBaseline> {
  const results: WorkbenchProjectDetailBenchmark[] = []

  for (const chapterCount of chapterCounts) {
    const root = await createLargeNovelProjectFixture({ chapterCount })
    try {
      const selectedChapter = Math.ceil(chapterCount / 2)
      await loadNovelProjectDetail(root, selectedChapter)

      let detail = await loadNovelProjectDetail(root, selectedChapter)
      const durationMs = await measureAsync(async () => {
        detail = await loadNovelProjectDetail(root, selectedChapter)
      })

      results.push({
        chapterCount,
        durationMs,
        tocItems: detail.tocItems.length,
        treeItems: detail.treeItems.length,
        selectedChapter: detail.selectedChapter ?? null,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }

  return { results }
}

export function createAgentStreamingBenchmarkEvents(deltaCount = 8000): AgentEvent[] {
  const runId = 'perf-run'
  const threadId = 'perf-thread'
  const messageId = `assistant-${runId}`
  const createdAt = '2026-05-24T00:00:00.000Z'
  const events: AgentEvent[] = [
    {
      type: 'run.started',
      runId,
      threadId,
      command: 'freeform',
      prompt: '性能基线：生成长输出。',
      createdAt,
    },
  ]

  for (let index = 0; index < deltaCount; index += 1) {
    if (index > 0 && index % 2000 === 0) {
      const toolCallId = `tool-${index}`
      events.push(
        {
          type: 'tool.started',
          runId,
          messageId,
          toolCallId,
          toolName: 'Read',
          title: '读取章节材料',
          input: { path: `/tmp/chapter-${index}.md` },
          createdAt,
        },
        {
          type: 'tool.completed',
          runId,
          toolCallId,
          summary: '已读取。',
          result: 'ok',
          createdAt,
        },
      )
    }

    if (index > 0 && index % 1200 === 0) {
      events.push({
        type: 'reasoning.delta',
        runId,
        messageId,
        text: '分析章节节奏。',
        createdAt,
      })
    }

    events.push({
      type: 'message.delta',
      runId,
      messageId,
      text: `第${index}段剧情推进。`,
      createdAt,
    })
  }

  events.push({
    type: 'run.completed',
    runId,
    usage: { inputTokens: 1200, outputTokens: deltaCount * 4 },
    createdAt,
  })

  return events
}

function reduceEvents(events: AgentEvent[]): AgentThread {
  let thread = createEmptyAgentThread('perf-thread')
  for (const event of events) {
    thread = reduceAgentEvent(thread, event)
  }
  return thread
}

function countParts(thread: AgentThread): number {
  return thread.messages.reduce((total, message) => total + message.parts.length, 0)
}

function countOutputCharacters(thread: AgentThread): number {
  return thread.messages.reduce((messageTotal, message) => {
    return (
      messageTotal +
      message.parts.reduce((partTotal, part: AgentMessagePart) => {
        if (part.type !== 'text') return partTotal
        return partTotal + part.text.length
      }, 0)
    )
  }, 0)
}

export function runAgentStreamingReducerBaseline(deltaCount = 8000): AgentStreamingReducerBaseline {
  const events = createAgentStreamingBenchmarkEvents(deltaCount)
  reduceEvents(events)

  const startedAt = performance.now()
  const thread = reduceEvents(events)
  const durationMs = performance.now() - startedAt

  return {
    eventCount: events.length,
    deltaCount,
    outputCharacters: countOutputCharacters(thread),
    durationMs,
    messageCount: thread.messages.length,
    partCount: countParts(thread),
  }
}

function addBudgetCheck(
  checks: BudgetCheck[],
  id: string,
  label: string,
  actual: number,
  budget: number,
  unit: BudgetCheck['unit'],
): void {
  checks.push({
    id,
    label,
    actual,
    budget,
    unit,
    status: actual <= budget ? 'pass' : 'warn',
  })
}

export function evaluatePerformanceBudgets(result: PerformanceBaselineResult): BudgetCheck[] {
  const checks: BudgetCheck[] = []
  const { rendererAssets, budgets } = result

  addBudgetCheck(
    checks,
    'renderer.total-assets',
    'Renderer assets total',
    rendererAssets.totalBytes,
    budgets.renderer.totalAssetBytes,
    'bytes',
  )
  addBudgetCheck(
    checks,
    'renderer.total-js',
    'Renderer JavaScript total',
    rendererAssets.groups.js.totalBytes,
    budgets.renderer.totalJavaScriptBytes,
    'bytes',
  )
  addBudgetCheck(
    checks,
    'renderer.total-css',
    'Renderer CSS total',
    rendererAssets.groups.css.totalBytes,
    budgets.renderer.totalCssBytes,
    'bytes',
  )
  addBudgetCheck(
    checks,
    'renderer.total-font',
    'Renderer font total',
    rendererAssets.groups.font.totalBytes,
    budgets.renderer.totalFontBytes,
    'bytes',
  )
  addBudgetCheck(
    checks,
    'renderer.total-image',
    'Renderer image total',
    rendererAssets.groups.image.totalBytes,
    budgets.renderer.totalImageBytes,
    'bytes',
  )

  for (const benchmark of result.workbenchProjectDetail.results) {
    const budget =
      budgets.workbenchProjectDetailMs[
        benchmark.chapterCount as keyof typeof budgets.workbenchProjectDetailMs
      ]
    if (budget === undefined) continue
    addBudgetCheck(
      checks,
      `workbench.project-detail.${benchmark.chapterCount}`,
      `Workbench project detail ${benchmark.chapterCount} chapters`,
      benchmark.durationMs,
      budget,
      'ms',
    )
  }

  addBudgetCheck(
    checks,
    'agent.streaming-reducer',
    'Agent streaming reducer',
    result.agentStreamingReducer.durationMs,
    budgets.agentStreamingReducerMs,
    'ms',
  )

  return checks
}

export function formatBytes(bytes: number): string {
  if (bytes >= mib) return `${(bytes / mib).toFixed(2)} MiB`
  if (bytes >= kib) return `${(bytes / kib).toFixed(1)} KiB`
  return `${bytes} B`
}

function formatMs(ms: number): string {
  return `${ms.toFixed(1)} ms`
}

function formatValue(value: number, unit: BudgetCheck['unit']): string {
  return unit === 'bytes' ? formatBytes(value) : formatMs(value)
}

function formatAssetGroup(label: string, group: AssetGroupMetric): string {
  const largest = group.largest ? `, largest ${group.largest.path} ${formatBytes(group.largest.bytes)}` : ''
  return `- ${label}: ${formatBytes(group.totalBytes)} raw / ${formatBytes(group.totalGzipBytes)} gzip (${group.count} files${largest})`
}

export function formatPerformanceReport(result: PerformanceBaselineResult, checks: BudgetCheck[]): string {
  const assetPath = relative(repoRoot, result.rendererAssets.assetDir)
  const warnings = checks.filter((check) => check.status === 'warn')
  const lines = [
    '# NarraCat Performance Baseline',
    '',
    `Generated: ${result.generatedAt}`,
    `Build: ${result.buildRan ? 'completed before measurement' : 'skipped'}`,
    '',
    '## Renderer Assets',
    '',
    `Path: ${assetPath}`,
    `Total: ${formatBytes(result.rendererAssets.totalBytes)} raw / ${formatBytes(result.rendererAssets.totalGzipBytes)} gzip (${result.rendererAssets.fileCount} files)`,
    formatAssetGroup('JavaScript', result.rendererAssets.groups.js),
    formatAssetGroup('CSS', result.rendererAssets.groups.css),
    formatAssetGroup('Fonts', result.rendererAssets.groups.font),
    formatAssetGroup('Images', result.rendererAssets.groups.image),
    formatAssetGroup('Other', result.rendererAssets.groups.other),
    '',
    'Largest files:',
    ...result.rendererAssets.largestFiles.map(
      (file, index) => `${index + 1}. ${file.path}: ${formatBytes(file.bytes)} raw / ${formatBytes(file.gzipBytes)} gzip`,
    ),
    '',
    '## Workbench Project Detail',
    '',
    ...result.workbenchProjectDetail.results.map(
      (item) =>
        `- ${item.chapterCount} chapters: ${formatMs(item.durationMs)} (${item.tocItems} toc items, ${item.treeItems} tree items, selected chapter ${item.selectedChapter ?? 'none'})`,
    ),
    '',
    '## Agent Streaming Reducer',
    '',
    `- ${result.agentStreamingReducer.eventCount} events / ${result.agentStreamingReducer.deltaCount} deltas / ${result.agentStreamingReducer.outputCharacters} output chars: ${formatMs(result.agentStreamingReducer.durationMs)} (${result.agentStreamingReducer.messageCount} messages, ${result.agentStreamingReducer.partCount} parts)`,
    '',
    '## Budgets',
    '',
    ...checks.map((check) => {
      const status = check.status === 'pass' ? 'PASS' : 'WARN'
      return `- ${status} ${check.label}: ${formatValue(check.actual, check.unit)} / budget ${formatValue(check.budget, check.unit)}`
    }),
    '',
    '## Updating Budgets',
    '',
    '- Budgets live in `DEFAULT_BUDGETS` in `scripts/performance-baseline.ts`.',
    '- Update budgets only when the product tradeoff is intentional, for example a required visual asset or a measured UX improvement.',
    '- Use `bun --no-cache run perf:baseline -- --strict` in CI-like checks when warnings should fail the command.',
    '- Use `bun --no-cache run perf:baseline -- --skip-build` only after a fresh `bun --no-cache run build`.',
  ]

  if (warnings.length > 0) {
    lines.push('', `Warnings: ${warnings.length} budget check(s) exceeded.`)
  }

  return `${lines.join('\n')}\n`
}

function runCommand(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`)
  }
}

function localBin(name: string): string {
  return join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name)
}

export function runRendererBuild(): void {
  runCommand(process.execPath, ['scripts/check-node-runtime.mjs'])
  runCommand(localBin('electron-vite'), ['build'])
}

export async function runPerformanceBaseline({
  skipBuild,
}: Pick<CliOptions, 'skipBuild'>): Promise<PerformanceBaselineResult> {
  if (!skipBuild) {
    runRendererBuild()
  }

  const rendererAssets = await collectRendererAssetMetrics()
  const workbenchProjectDetail = await runWorkbenchProjectDetailBaseline()
  const agentStreamingReducer = runAgentStreamingReducerBaseline()

  return {
    generatedAt: new Date().toISOString(),
    buildRan: !skipBuild,
    rendererAssets,
    workbenchProjectDetail,
    agentStreamingReducer,
    budgets: DEFAULT_BUDGETS,
  }
}

function parseCliArgs(argv: string[]): CliOptions {
  return {
    skipBuild: argv.includes('--skip-build'),
    strict: argv.includes('--strict'),
    json: argv.includes('--json'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

function usage(): string {
  return [
    'Usage: bun --no-cache run perf:baseline -- [--skip-build] [--strict] [--json]',
    '',
    'Measures renderer bundle/assets, Workbench long-project loading, and Agent streaming reducer pressure.',
    '',
    'Options:',
    '  --skip-build   Reuse the existing out/renderer/assets directory.',
    '  --strict       Exit non-zero when any budget check warns.',
    '  --json         Print the raw result and budget checks as JSON.',
    '  --help         Show this help.',
    '',
  ].join('\n')
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }

  const result = await runPerformanceBaseline(options)
  const checks = evaluatePerformanceBudgets(result)
  const warnings = checks.filter((check) => check.status === 'warn')

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ result, checks }, null, 2)}\n`)
  } else {
    process.stdout.write(formatPerformanceReport(result, checks))
  }

  if (options.strict && warnings.length > 0) {
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
