/**
 * pi 引擎钩子扩展单测（阶段2切片④ Task 5）：tool_result 事件承载 checkChapterWordcount /
 * lintBriefForSystemWords 两条纯函数钩子。合成事件风格仿 pi-tool-guard.test.ts；BriefLintState
 * 必须在同一 extension 实例（同一 run）内跨多次调用存活——不能每次调用重建，否则「5 分钟内二次
 * 命中放行」防死锁语义失效（Task 4 评审 ⚠️#1）。readWordsPerChapter 必须真读
 * `.narracat/config.yaml` 传入 checkChapterWordcount（Task 4 评审 ⚠️#2）。
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TextContent } from '@mariozechner/pi-ai'
import { createPiEngineHooksExtension } from './pi-engine-hooks.ts'

function makeCwd(): string {
  return mkdtempSync(join(tmpdir(), 'pi-engine-hooks-'))
}

function writeConfig(cwd: string, yaml: string) {
  const dir = join(cwd, '.narracat')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.yaml'), yaml)
}

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'tool_result' as const,
    toolCallId: 'tc1',
    toolName: 'write' as const,
    input: {},
    content: [{ type: 'text', text: 'ok' }] as TextContent[],
    isError: false,
    details: undefined,
    ...overrides,
  }
}

async function fireToolResult(
  extension: ReturnType<typeof createPiEngineHooksExtension>,
  event: ReturnType<typeof baseEvent>,
) {
  const handlers = extension.handlers.get('tool_result')
  expect(handlers).toBeDefined()
  expect(handlers).toHaveLength(1)
  return handlers![0](event as never, {} as never)
}

describe('createPiEngineHooksExtension', () => {
  test('toolName !== write → 不触碰，返回 undefined', async () => {
    const cwd = makeCwd()
    const ext = createPiEngineHooksExtension({ cwd })
    const result = await fireToolResult(
      ext,
      baseEvent({ toolName: 'read', input: { path: join(cwd, 'manuscript', 'ch-001.md') } }),
    )
    expect(result).toBeUndefined()
  })

  test('write 章节路径 + 短内容 → content 追加字数提示，isError 未置', async () => {
    const cwd = makeCwd()
    mkdirSync(join(cwd, 'manuscript'), { recursive: true })
    const ext = createPiEngineHooksExtension({ cwd })
    const shortContent = '字'.repeat(100)
    const result = await fireToolResult(
      ext,
      baseEvent({ input: { path: join(cwd, 'manuscript', 'ch-001.md'), content: shortContent } }),
    )
    expect(result).toBeDefined()
    expect(result!.isError).toBeUndefined()
    expect(result!.content).toHaveLength(2)
    expect((result!.content![0] as TextContent).text).toBe('ok')
    expect((result!.content![1] as TextContent).text).toContain('低于目标区间下限')
    expect((result!.content![1] as TextContent).text).toContain('1800')
  })

  test('config.yaml 存在时按 words_per_chapter 换算区间（3000 → 2100/4500）', async () => {
    const cwd = makeCwd()
    mkdirSync(join(cwd, 'manuscript'), { recursive: true })
    writeConfig(cwd, 'words_per_chapter: 3000\n')
    const ext = createPiEngineHooksExtension({ cwd })
    // 2000 字：≥ 默认下限 1800（若未读到 config 会被判"通过"），< 换算下限 2100（读到 config 才会命中）。
    const content = '字'.repeat(2000)
    const result = await fireToolResult(
      ext,
      baseEvent({ input: { path: join(cwd, 'manuscript', 'ch-001.md'), content } }),
    )
    expect(result).toBeDefined()
    expect((result!.content![1] as TextContent).text).toContain('2100')
  })

  test('config.yaml 缺失 → 缺省区间不抛', async () => {
    const cwd = makeCwd()
    mkdirSync(join(cwd, 'manuscript'), { recursive: true })
    const ext = createPiEngineHooksExtension({ cwd })
    const content = '字'.repeat(2000)
    const result = await fireToolResult(
      ext,
      baseEvent({ input: { path: join(cwd, 'manuscript', 'ch-001.md'), content } }),
    )
    expect(result).toBeUndefined()
  })

  test('config.yaml 损坏（非法 YAML）→ 缺省区间不抛', async () => {
    const cwd = makeCwd()
    mkdirSync(join(cwd, 'manuscript'), { recursive: true })
    writeConfig(cwd, '::: not valid yaml :::\n  bad indent\nfoo')
    const ext = createPiEngineHooksExtension({ cwd })
    const content = '字'.repeat(2000)
    const result = await fireToolResult(
      ext,
      baseEvent({ input: { path: join(cwd, 'manuscript', 'ch-001.md'), content } }),
    )
    expect(result).toBeUndefined()
  })

  test('write staging brief 含系统词 → block（isError:true + 打回文案）', async () => {
    const cwd = makeCwd()
    mkdirSync(join(cwd, '.narracat', 'staging'), { recursive: true })
    const ext = createPiEngineHooksExtension({ cwd })
    const result = await fireToolResult(
      ext,
      baseEvent({
        input: { path: join(cwd, '.narracat', 'staging', 'ch-001.brief.md'), content: 'novel_search_memory 命中' },
      }),
    )
    expect(result?.isError).toBe(true)
    expect((result!.content![0] as TextContent).text).toContain('系统词')
  })

  test('⚠️ 同一 extension 两次调用同路径命中：第二次 warn_pass 放行（跨调用 state 须存活在闭包内）', async () => {
    const cwd = makeCwd()
    mkdirSync(join(cwd, '.narracat', 'staging'), { recursive: true })
    const ext = createPiEngineHooksExtension({ cwd })
    const path = join(cwd, '.narracat', 'staging', 'ch-002.brief.md')
    const first = await fireToolResult(ext, baseEvent({ input: { path, content: 'novel_search_memory 第一次' } }))
    expect(first?.isError).toBe(true)

    const second = await fireToolResult(ext, baseEvent({ input: { path, content: 'novel_search_memory 第二次' } }))
    expect(second?.isError).toBeUndefined()
    expect((second!.content![1] as TextContent).text).toContain('已放行')
  })

  test('相对路径以 cwd 解析：manuscript/ch-001.md 命中章节字数规则', async () => {
    const cwd = makeCwd()
    mkdirSync(join(cwd, 'manuscript'), { recursive: true })
    const ext = createPiEngineHooksExtension({ cwd })
    const content = '字'.repeat(100)
    const result = await fireToolResult(ext, baseEvent({ input: { path: 'manuscript/ch-001.md', content } }))
    expect(result).toBeDefined()
    expect((result!.content![1] as TextContent).text).toContain('低于目标区间下限')
  })

  test('handler 内部抛错（畸形 event.content 非数组）→ fail-open 返回 undefined，不抛', async () => {
    const cwd = makeCwd()
    mkdirSync(join(cwd, 'manuscript'), { recursive: true })
    const ext = createPiEngineHooksExtension({ cwd })
    const content = '字'.repeat(100)
    const malformed = baseEvent({
      input: { path: join(cwd, 'manuscript', 'ch-001.md'), content },
      content: undefined,
    })
    const result = await fireToolResult(ext, malformed)
    expect(result).toBeUndefined()
  })

  test('input.path/content 非 string → 不触碰，返回 undefined', async () => {
    const cwd = makeCwd()
    const ext = createPiEngineHooksExtension({ cwd })
    const result = await fireToolResult(ext, baseEvent({ input: { path: 42, content: 'x' } }))
    expect(result).toBeUndefined()
  })

  test('cwd 目录本身不存在也不抛（readWordsPerChapter 静默失败）', async () => {
    const cwd = makeCwd()
    rmSync(cwd, { recursive: true, force: true })
    const ext = createPiEngineHooksExtension({ cwd })
    const content = '字'.repeat(100)
    const result = await fireToolResult(
      ext,
      baseEvent({ input: { path: join(cwd, 'manuscript', 'ch-001.md'), content } }),
    )
    expect(result).toBeDefined()
    expect((result!.content![1] as TextContent).text).toContain('1800')
  })
})
