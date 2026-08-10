// 引擎散文块：agents/*.md 里用 HTML 注释框出的可编辑段落。
//
// 选注释而非「## 标题白名单」或物理拆文件的理由（spec §4）：块 id 与标题解耦（官方改标题不打断
// 用户存量）、可框任意粒度、引擎文件仍是单文件纯 markdown（任何 harness 可直接读）、未标记的
// 一律不可编辑（安全默认）。
//
// 本模块是纯函数、无 IO、**不抛异常**：任何畸形输入都降级为「少解析出一个块」，绝不阻断组装。

import type { ProseBlock, ProseBlockStatus, ProseOverrideEntry } from '@shared/types/prose-block'

/** 块 id 值域：kebab-case。守卫脚本与 store 共用同一语义。 */
export const PROSE_BLOCK_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

const OPEN_RE = /<!--\s*narracat:prose\b([\s\S]*?)-->/g
const CLOSE_RE = /<!--\s*\/narracat:prose\s*-->/g
const ATTR_RE = /(\w+)="([^"]*)"/g

function readAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTR_RE.exec(raw)) !== null) attrs[match[1]] = match[2]
  return attrs
}

/**
 * 解析出全部合法块。畸形块（未闭合 / 嵌套 / id 缺失或非法 / 重复 id）静默丢弃。
 * 重复 id 保留第一个——CI 守卫会拦住重复，运行时只需不崩。
 */
export function parseProseBlocks(text: string): ProseBlock[] {
  const blocks: ProseBlock[] = []
  const seen = new Set<string>()

  OPEN_RE.lastIndex = 0
  const opens: { start: number; bodyStart: number; attrs: Record<string, string> }[] = []
  let openMatch: RegExpExecArray | null
  while ((openMatch = OPEN_RE.exec(text)) !== null) {
    opens.push({
      start: openMatch.index,
      bodyStart: openMatch.index + openMatch[0].length,
      attrs: readAttrs(openMatch[1]),
    })
  }

  for (let i = 0; i < opens.length; i += 1) {
    const open = opens[i]
    CLOSE_RE.lastIndex = open.bodyStart
    const closeMatch = CLOSE_RE.exec(text)
    if (!closeMatch) continue // 未闭合 → 丢弃

    // 闭标记之前又出现下一个开标记 → 本块嵌套/畸形，丢弃本块，让下一个开标记自己去配对
    const next = opens[i + 1]
    if (next && next.start < closeMatch.index) continue

    const id = open.attrs.id?.trim() ?? ''
    if (!id || !PROSE_BLOCK_ID_RE.test(id) || seen.has(id)) continue
    seen.add(id)

    const title = open.attrs.title?.trim() || id
    const hint = open.attrs.hint?.trim()
    const block: ProseBlock = {
      id,
      title,
      body: text.slice(open.bodyStart, closeMatch.index).trim(),
      start: open.start,
      end: closeMatch.index + closeMatch[0].length,
    }
    if (hint) block.hint = hint
    blocks.push(block)
  }

  return blocks
}

/**
 * 把用户覆盖应用进引擎原文，**并总是移除全部标记**——标记服务于作者与守卫，模型不该看到。
 * 故纯默认路径（无任何 override）也必须过本函数。
 *
 * 空串 override 合法：语义是「删掉这条官方规则」，计入 applied 而非 skipped。
 */
export function applyProseOverrides(
  text: string,
  overrides: Record<string, ProseOverrideEntry>,
): { text: string; applied: string[]; skipped: { id: string; reason: 'not-found' }[] } {
  const blocks = parseProseBlocks(text)
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const applied: string[] = []
  const skipped: { id: string; reason: 'not-found' }[] = []

  for (const id of Object.keys(overrides)) {
    if (!byId.has(id)) skipped.push({ id, reason: 'not-found' })
  }

  // 按 start 倒序重写，避免下标位移
  let out = text
  for (const block of [...blocks].sort((a, b) => b.start - a.start)) {
    const override = overrides[block.id]
    let replacement = block.body
    if (override) {
      replacement = override.text.trim()
      applied.push(block.id)
    }
    out = `${out.slice(0, block.start)}${replacement}${out.slice(block.end)}`
  }

  return { text: out, applied: applied.reverse(), skipped }
}

/** 某块的当前状态：块没了 → missing；官方原文变过 → official-updated；否则 clean。 */
export function resolveBlockStatus(
  block: ProseBlock | undefined,
  override: ProseOverrideEntry | undefined,
): ProseBlockStatus {
  if (!override) return 'clean'
  if (!block) return 'missing'
  return block.body === override.baseText ? 'clean' : 'official-updated'
}
