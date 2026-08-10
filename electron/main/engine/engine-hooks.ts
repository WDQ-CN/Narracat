// 章节字数提示 / 任务书系统词硬门的判据本体（挂载见 pi-engine-hooks.ts）。
//
// 前身是引擎侧 shell 钩子（`agent-core/narracat/hooks/scripts/check-chapter-wordcount.sh`
// 与 `check-brief-lint.sh`），由 claude-sdk 的 PostToolUse hook 承载；pi 无 hook 概念，判据
// 逐字移植进本库后 shell 版整目录删除——**本库自此是唯一实现，不存在需要对齐的第二份**。
// 想看被移植前的原版去 git 历史（tag `last-claude-sdk` 之前）。
//
// 纯函数纪律：零 IO（不 readFile、不做任何系统调用），`now` 参数缺省
// `Date.now()` 是唯一例外；零第三方依赖。

const CHAPTER_MANUSCRIPT_PATH_REGEX = /manuscript\/(vol-[0-9]+\/)?ch-?[0-9]+\.md$/
const BRIEF_STAGING_PATH_REGEX = /\.narracat\/staging\/ch-[^/]*\.brief\.md$/
// 系统词表（原 check-brief-lint.sh 的 FORBIDDEN ERE 逐字移植；shell 版已删，此处是唯一一份）
const BRIEF_FORBIDDEN_PATTERN =
  /novel_[a-z_]+|craft_pack_hints|style_directive|through_line_anchor|previous_chapter_briefs|ending_snippet|payoff_beat|storyline_focus|foreshadowing_touch|foreshadowing_due|word_count_range|chapter_outline|style_examples|reference_path|pack_id|pack_path|manuscript_path|outline_path|semantic_context|state_changes|planned_state_changes|heartbeat_moment|continuation_hook|emotional_tone|character_cards|opening_snippet|core_foreshadowing|core_experience|current_arc_tension|current_antagonist_agent|mechanism_note|arc_summaries|matched_triggers|key_events|world_rules|derived_relationships|character_relationships|\b(canon|tentative|open)\b|[A-Z]-[A-Z0-9]+(-[A-Z0-9]+)*/
const BRIEF_MARKER_FRESH_MS = 5 * 60_000
const DEFAULT_WORD_MIN = 1800
const DEFAULT_WORD_MAX = 4000

export interface ChapterWordcountArgs {
  filePath: string
  content: string
  wordsPerChapter?: number
}

/**
 * PostToolUse(Write) 章节字数提示：仅对 manuscript/(vol-VV/)?ch-NNN.md 生效。
 * 对齐 .sh 的 `tr -d '[:space:]' | wc -m`：按去除空白后的字符数计数（非 byte 长度）。
 */
export function checkChapterWordcount(args: ChapterWordcountArgs): string | undefined {
  const { filePath, content, wordsPerChapter } = args

  if (!CHAPTER_MANUSCRIPT_PATH_REGEX.test(filePath)) {
    return undefined
  }

  let min = DEFAULT_WORD_MIN
  let max = DEFAULT_WORD_MAX
  if (typeof wordsPerChapter === 'number' && wordsPerChapter > 0) {
    min = Math.floor((wordsPerChapter * 7) / 10)
    max = Math.floor((wordsPerChapter * 3) / 2)
  }

  const words = Array.from(content.replace(/\s/g, '')).length

  if (words < min) {
    return `章节字数 ${words} 低于目标区间下限 ${min}（${filePath}）。可能需要补写。`
  }
  if (words > max) {
    return `章节字数 ${words} 高于目标区间上限 ${max}（${filePath}）。可能需要精简。`
  }
  return undefined
}

export interface BriefLintState {
  warnedAt: Map<string, number>
}

export function createBriefLintState(): BriefLintState {
  return { warnedAt: new Map() }
}

export interface BriefLintArgs {
  filePath: string
  content: string
  state: BriefLintState
  now?: number
}

export type BriefLintResult =
  | { verdict: 'clean' }
  | { verdict: 'block'; feedback: string }
  | { verdict: 'warn_pass'; feedback: string }

/**
 * PostToolUse(Write) 任务书系统词硬门：仅对 .narracat/staging/ch-*.brief.md 生效。
 *
 * marker 载体从 .sh 版的 marker 文件改为进程内 state（BriefLintState.warnedAt）：
 * 跨 run 残留问题随进程内 state 消失（进程重启即清零）；5 分钟新鲜窗保留 = 同轮
 * 打回重写放行语义（防死锁）不变——同一路径在 5 分钟内二次命中视为「模型刚被打回、
 * 正在重写」，放行但要求模型自附警示；超过 5 分钟视为跨轮残留，按首次重新拦截。
 */
export function lintBriefForSystemWords(args: BriefLintArgs): BriefLintResult {
  const { filePath, content, state, now = Date.now() } = args

  if (!BRIEF_STAGING_PATH_REGEX.test(filePath)) {
    return { verdict: 'clean' }
  }

  const lines = content.split('\n')
  const hits: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (BRIEF_FORBIDDEN_PATTERN.test(lines[i])) {
      hits.push(`${i + 1}:${lines[i]}`)
      if (hits.length >= 10) break
    }
  }

  if (hits.length === 0) {
    state.warnedAt.delete(filePath)
    return { verdict: 'clean' }
  }

  const hitsText = hits.join('\n')
  const warnedAt = state.warnedAt.get(filePath)
  if (warnedAt !== undefined && now - warnedAt < BRIEF_MARKER_FRESH_MS) {
    state.warnedAt.delete(filePath)
    return {
      verdict: 'warn_pass',
      feedback: `任务书仍含系统词（已放行，请在完成输出附警示）：${hitsText}`,
    }
  }

  state.warnedAt.set(filePath, now)
  return {
    verdict: 'block',
    feedback: `任务书里出现了系统词，写手不该读到这些。把下列命中处翻成自然语言后重新 Write 同一路径：${hitsText}`,
  }
}

// 写手出稿门 / memory-keeper 回执门的判据本体（前身同样是已删除的引擎 shell 钩子
// check-chapter-writer-output.sh 与 check-memory-keeper-receipt.sh，正则/文案/判据顺序逐字
// 移植，语义对照现由本目录 engine-hooks.test.ts 承担）。IO（找文件/读 state.yaml/读
// context-pack）由 engine-subagent-gates.ts 的壳负责，本节两函数保持零 IO。

const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g
const HAS_CJK_REGEX = /[一-鿿]/
const FANG_QUOTE_SEGMENT_REGEX = /「([^」\n]{1,120})」/g
const ASCII_DOUBLE_QUOTE_SEGMENT_REGEX = /"([^"\n]{1,120})"/g
const ASCII_SINGLE_QUOTE_SEGMENT_REGEX = /(?<![A-Za-z])'([^'\n]{1,120})'(?![A-Za-z])/g
const DIALOGUE_SEGMENT_REGEX = /“([^”]{1,800})”/g
// 与 .sh 内嵌 python 段 168 行逐字对齐：低对话/低张力场景词表。
const LOW_DIALOGUE_SCENE_REGEX =
  /独处|低对话|对白占比应很低|对话占比应很低|减少对话|无对峙|无外部冲突|潜入|追逐|战斗|打斗|缠斗|厮杀|格斗|搏斗|对打|动作戏|清点|整理|情绪消化|环境负重|低张力|缓章|蒙太奇|快进|时间跳跃|闪回|回忆|赶路|独白/
// 与 .sh 内嵌 python 段 173 行逐字对齐：多人互动场景词表。
const MULTI_PERSON_SCENE_REGEX = /对峙|争执|互怼|谈判|审问|相遇|见面|同处|两人|三人|众人|群像|拉扯|抢白|寒暄|质问/

function hasCjk(text: string): boolean {
  return HAS_CJK_REGEX.test(text)
}

function matchAllGroups(text: string, regex: RegExp): string[] {
  return Array.from(text.matchAll(regex), (m) => m[1] ?? '')
}

function visibleLength(text: string): number {
  return text.replace(/\s+/g, '').length
}

/** 对齐 python flatten_text：字符串原样/数组逐项拼接/对象取 values 递归，其他类型空串。 */
function flattenPackText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(flattenPackText).join('\n')
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).map(flattenPackText).join('\n')
  return ''
}

export interface ChapterWriterOutputArgs {
  chapter: number
  /** 正文文件相对路径（展示用）；IO 壳未找到文件时传 undefined。 */
  manuscriptPath?: string
  manuscriptText?: string
  wordsPerChapter?: number
  /** .narracat/context-packs/ch-NNN.json 原文；文件不存在或损坏时可缺省/传非法 JSON，判据静默降级。 */
  contextPackJson?: string
}

/**
 * SubagentStop(chapter-writer) 出稿检查判据：文件存在性 → 非空 → 字数区间 → 引号规范 →
 * 对白占比诊断，顺序与 .sh 一致。文件缺失/为空两支各自单独返回（对齐 .sh 提前 exit 0，
 * 不叠加后续判据）；其余判据互不排斥，命中的全部累积进返回数组。
 */
export function judgeChapterWriterOutput(args: ChapterWriterOutputArgs): string[] {
  const { chapter, manuscriptPath, manuscriptText, wordsPerChapter, contextPackJson } = args
  const nnn = String(chapter).padStart(3, '0')

  if (!manuscriptPath) {
    return [`第 ${chapter} 章正文文件未找到（期望路径 manuscript/vol-VV/ch-${nnn}.md）。需要重新生成本章正文。`]
  }

  const rawText = manuscriptText ?? ''
  const words = Array.from(rawText.replace(/\s/g, '')).length
  if (words === 0) {
    return [`第 ${chapter} 章正文文件为空（${manuscriptPath}）。需要重新生成本章正文。`]
  }

  const messages: string[] = []

  let min = DEFAULT_WORD_MIN
  let max = DEFAULT_WORD_MAX
  if (typeof wordsPerChapter === 'number' && wordsPerChapter > 0) {
    min = Math.floor((wordsPerChapter * 7) / 10)
    max = Math.floor((wordsPerChapter * 3) / 2)
  }
  if (words < min) {
    messages.push(`第 ${chapter} 章字数 ${words} 低于目标区间下限 ${min}（${manuscriptPath}）。需要补写到目标区间。`)
  } else if (words > max) {
    messages.push(`第 ${chapter} 章字数 ${words} 高于目标区间上限 ${max}（${manuscriptPath}）。可适当精简。`)
  }

  const body = rawText.replace(HTML_COMMENT_REGEX, '')

  const leftQuotes = body.split('“').length - 1
  const rightQuotes = body.split('”').length - 1
  if (leftQuotes !== rightQuotes) {
    messages.push(
      `第 ${chapter} 章中文双引号不成对（左 ${leftQuotes} / 右 ${rightQuotes}）。人物对白应使用成对的 “……”。`,
    )
  }

  const fangSegments = matchAllGroups(body, FANG_QUOTE_SEGMENT_REGEX)
  if (fangSegments.some(hasCjk)) {
    messages.push(`第 ${chapter} 章检测到方角引号「」疑似用于对白。正文人物对白统一改为中文弯双引号 “……”。`)
  }

  const asciiDouble = matchAllGroups(body, ASCII_DOUBLE_QUOTE_SEGMENT_REGEX)
  const asciiSingle = matchAllGroups(body, ASCII_SINGLE_QUOTE_SEGMENT_REGEX)
  if (asciiDouble.some(hasCjk) || asciiSingle.some(hasCjk)) {
    messages.push(
      `第 ${chapter} 章检测到 ASCII 引号疑似用于对白。人物对白统一使用中文弯双引号 “……”，对白内引用用 ‘……’。`,
    )
  }

  const dialogueSegments = matchAllGroups(body, DIALOGUE_SEGMENT_REGEX)
  const visibleTotal = visibleLength(body)
  const visibleDialogue = dialogueSegments.reduce((sum, segment) => sum + visibleLength(segment), 0)
  const dialogueRatio = visibleTotal > 0 ? visibleDialogue / visibleTotal : 0

  let pack: Record<string, unknown> = {}
  if (contextPackJson) {
    try {
      const parsed: unknown = JSON.parse(contextPackJson)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        pack = parsed as Record<string, unknown>
      }
    } catch {
      pack = {}
    }
  }
  const outlineText = [
    flattenPackText(pack.chapter_outline),
    flattenPackText(pack.style_directive),
    flattenPackText(pack.warnings),
  ].join('\n')
  const cards = pack.character_cards
  let characterCount = 0
  if (Array.isArray(cards)) characterCount = cards.length
  else if (cards && typeof cards === 'object') characterCount = Object.keys(cards).length

  const lowDialogueScene = LOW_DIALOGUE_SCENE_REGEX.test(outlineText)
  const multiPersonScene = characterCount >= 2 || MULTI_PERSON_SCENE_REGEX.test(outlineText)

  if (visibleTotal > 0 && dialogueRatio < 0.12 && multiPersonScene && !lowDialogueScene) {
    messages.push(
      `第 ${chapter} 章疑似普通多人互动章但现场对白偏少（仅作诊断，不要求按比例补齐）。建议把关键冲突改成对白、动作、沉默、打断或误解来发生，避免旁白替人物解释。`,
    )
  }

  return messages
}

/**
 * SubagentStop(memory-keeper) 回执检查判据：回执文本缺省/空白 → 提示；非空 → []。
 * 对齐 .sh 的 `[[ ! -s "$RECEIPT" ]]`，但把「空白字符构成的非零字节文件」也视为未完成
 * （更贴近「回执应当承载数据」的语义，IO 壳读不到文件时同样传 undefined 命中这支）。
 */
export function judgeMemoryKeeperReceipt(args: { chapter: number; receiptText?: string }): string[] {
  const { chapter, receiptText } = args
  if (!receiptText || receiptText.trim().length === 0) {
    const nnn = String(chapter).padStart(3, '0')
    return [
      `第 ${chapter} 章入库回执未找到（.narracat/receipts/ch-${nnn}.json）。本章入库未完成，需要 memory-keeper 重新提交本章数据。`,
    ]
  }
  return []
}
