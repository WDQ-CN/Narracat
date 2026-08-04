/**
 * Pi 引擎钩子扩展（阶段2切片④ Task 5）：把 Task 4 的两条纯函数钩子（章节字数提示 /
 * 任务书系统词硬门）接到 pi 的 tool_result 事件——SDK 路径由 shell PostToolUse hook 承载，
 * pi 无 hook 概念，用同一手工构造合成 Extension 的先例（见 pi-tool-guard.ts）改挂 tool_result。
 *
 * BriefLintState 在本函数闭包内创建一次：`createPiEngineHooksExtension` 每次 run 只调一次
 * （index.ts buildPiRunOptions 装配处），extension 实例本身在整个 run 生命周期内存活，闭包内
 * 的 state 因此跨同一 run 的多次 tool_result 调用保持——「5 分钟内二次命中放行」防死锁语义
 * （lintBriefForSystemWords 的 warnedAt 新鲜窗）依赖这点，若每次调用都新建 state 会失效。
 */
import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { createSyntheticSourceInfo } from '@mariozechner/pi-coding-agent'
import type { Extension, ToolResultEvent } from '@mariozechner/pi-coding-agent'
import { parse as parseYaml } from 'yaml'
import { checkChapterWordcount, createBriefLintState, lintBriefForSystemWords } from '../../../../engine/engine-hooks.ts'

/**
 * pi 包 exports 里没有 `ToolResultEventResult`（只在内部 core/extensions/types.d.ts，不经根
 * barrel 重导出，@mariozechner/pi-coding-agent 目前的 dist 版本使然），照 runner.js emitToolResult
 * 的合并逻辑（只认 content/details/isError 三个可选字段）在此本地声明等价形状。
 */
type PiToolResultEventResult = {
  content?: ToolResultEvent['content']
  details?: unknown
  isError?: boolean
}

/**
 * 读 `<cwd>/.narracat/config.yaml` 的 `words_per_chapter`：pi write 落盘前只经路径展开，不回读
 * 磁盘拿项目配置，钩子本身也不该假设配置一定存在——任何失败（文件不存在 / YAML 损坏 / 字段缺失
 * 或非正整数）都静默退回 undefined，让 checkChapterWordcount 落回内置缺省区间，不阻断 run。
 */
function readWordsPerChapter(cwd: string): number | undefined {
  try {
    const raw = readFileSync(join(cwd, '.narracat', 'config.yaml'), 'utf-8')
    const parsed = parseYaml(raw) as Record<string, unknown> | null | undefined
    const value = parsed?.words_per_chapter
    return typeof value === 'number' && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

export interface CreatePiEngineHooksExtensionArgs {
  cwd: string
}

export function createPiEngineHooksExtension({ cwd }: CreatePiEngineHooksExtensionArgs): Extension {
  const briefLintState = createBriefLintState()

  async function onToolResult(event: ToolResultEvent): Promise<PiToolResultEventResult | undefined> {
    try {
      if (event.toolName !== 'write' || event.isError) return undefined
      const input = event.input as Record<string, unknown>
      const rawPath = input.path
      const content = input.content
      if (typeof rawPath !== 'string' || typeof content !== 'string') return undefined
      const filePath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath)

      // 硬门优先：brief-lint 命中即打回（isError=true，content 换成反馈文案，等价 shell 版
      // exit 2 stderr）；字数提示是软提示，两者互斥（brief 路径本就不会同时撞章节路径正则）。
      const lint = lintBriefForSystemWords({ filePath, content, state: briefLintState })
      if (lint.verdict === 'block') {
        return { isError: true, content: [{ type: 'text', text: lint.feedback }] }
      }
      if (lint.verdict === 'warn_pass') {
        return { content: [...event.content, { type: 'text', text: lint.feedback }] }
      }

      const hint = checkChapterWordcount({ filePath, content, wordsPerChapter: readWordsPerChapter(cwd) })
      if (hint) {
        return { content: [...event.content, { type: 'text', text: hint }] }
      }
      return undefined
    } catch (error) {
      console.warn('[narracat] pi 引擎钩子异常（fail-open 不阻断 run）：', error)
      return undefined
    }
  }

  const hooksPath = '<narracat:pi-engine-hooks>'
  const handlers = new Map<string, Array<(...args: unknown[]) => Promise<unknown>>>()
  handlers.set('tool_result', [async (event) => onToolResult(event as ToolResultEvent)])
  return {
    path: hooksPath,
    resolvedPath: hooksPath,
    sourceInfo: createSyntheticSourceInfo(hooksPath, { source: 'narracat' }),
    handlers,
    tools: new Map(),
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  }
}
