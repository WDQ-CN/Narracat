/**
 * 章纲（ch-NNN.json）字段两档分流（ADR-0029）。第一档 = 无下游依赖的纯描述顶层字段，
 * 可 App 直写 + 机械重渲；其余（受控枚举 payoff_beat / 引用 storyline_focus·pov·scenes.characters /
 * 伏笔 foreshadowing_touch / scenes 嵌套）归第二档，须经 Agent 评估（B2b）。
 * Fail-safe：白名单之外一律第二档。App 与主进程共享本文件，各自单测锁定同一字段集防漂移。
 */
const FIRST_TIER_CHAPTER_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'value_shift',
  'emotional_stakes',
  'dramatic_focus',
  'ending_note',
  'positioning',
])

/** 新格式（beat 骨架）中允许按元素直改的纯描述数组字段；增删元素仍属第二档。 */
const FIRST_TIER_CHAPTER_ARRAY_FIELDS: ReadonlySet<string> = new Set(['beats', 'must_deliver'])

export function isFirstTierChapterField(fieldKey: string): boolean {
  return FIRST_TIER_CHAPTER_FIELDS.has(fieldKey)
}

export function isFirstTierChapterArrayField(fieldKey: string): boolean {
  return FIRST_TIER_CHAPTER_ARRAY_FIELDS.has(fieldKey)
}
