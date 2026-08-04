/**
 * 角色结构化状态只读快照（A4×D2 片1，spec §6.2 角色页三区之①②）。
 *
 * 数据口径：
 * - 状态卡当前值 = 引擎物化的 character_cards.card_json（App 不复刻折叠语义）；
 * - 时间线 = facts 原始行的展示层维度分组（spec §3.2 机械归属规则）；
 * - source 标注拿不准时按 'extracted'（待确认）兜底，诚实方向（spec §9）。
 */

export type CharacterFactSource = 'extracted' | 'authored'

export interface CharacterStateValue {
  value: string
  source: CharacterFactSource
  /** 该值入账事实的发生章（event_chapter ?? from_chapter）；0=初始；对不上事实时 null */
  chapter: number | null
  /** 入账事实 id（facts.id，UUID）——endorse/correct/retract 锚点；反查不到事实时 null（不开编辑入口） */
  factId: string | null
  /** secret 谓词事实的「本人已知晓」标记；非 secret 事实恒为 null（UI 不显示开关） */
  secretKnown: boolean | null
}

export interface CharacterStateCardEntry {
  /** 词表维度 key；「其他」区与 v1 回退时为原谓词名 */
  key: string
  /** 词表 display_name；「其他」区与 v1 回退时为原谓词名 */
  displayName: string
  cardinality: 'one' | 'many'
  /** one 维度恒 1 项；many 维度为全部有效项 */
  values: CharacterStateValue[]
}

export interface CharacterRelationshipEntry {
  /** 关系另一端显示名（subject "名A|名B" 拆出；拆不出时回退整个 subject） */
  otherName: string
  state: string
  chapter: number | null
  source: CharacterFactSource
}

export interface CharacterTimelineEvent {
  /** facts.id（UUID）——correct/retract/endorse 的 target_fact_id 锚点 */
  factId: string
  value: string
  /** event_chapter ?? from_chapter；0=初始状态入账 */
  chapter: number
  source: CharacterFactSource
  /** 已失效行（one 维度=被更新值顶替的演进史，正常展示；many 维度=已移除，弱化划线展示） */
  invalidated: boolean
  /** 失效起始章（仅 many 维度用于「已失去」提示） */
  invalidatedAtChapter: number | null
  /**
   * 从未生效行——被作者 correct/retract 打掉的错误记录，非自然演变（引擎 spec §3.3）：
   * invalidated_at_chapter <= 自身生效章。'corrected'=有取代者（invalidated_by 非空）；
   * 'retracted'=单纯作废（invalidated_by 空）；null=正常事件（含自然演变而失效的行）。
   */
  revoked: 'corrected' | 'retracted' | null
  /** secret 谓词事实的「本人已知晓」标记；非 secret 事实恒为 null（UI 不显示开关） */
  secretKnown: boolean | null
}

export interface CharacterTimelineGroup {
  key: string
  displayName: string
  cardinality: 'one' | 'many'
  /** 按发生章升序 */
  events: CharacterTimelineEvent[]
}

/**
 * 实体 json（出生证）里的身份摘要——新书 md 不再写性别/年龄行（spec §3.4），从 json 补显示。
 * 实体 json 存在且 uid 匹配即返回（字段可全空），供出生证编辑入口判定；json 缺失/uid 不匹配为 null。
 */
export interface CharacterIdentitySummary {
  gender: string | null
  age: string | null
  aliases: string[]
}

/** 词表维度定义（编辑控件用：enum 渲染值域下拉、free 渲染文本输入）；引擎 SSOT 在 state-vocabulary.json */
export interface CharacterStateDimensionInfo {
  key: string
  displayName: string
  cardinality: 'one' | 'many'
  valueType: 'enum' | 'free'
  /** enum 维度的值域梯子；free 维度为空数组 */
  values: string[]
}

export interface CharacterStateSnapshot {
  /** memory.db 可读且 novel_id 在；false 时面板整体不渲染 */
  available: boolean
  hasVocabulary: boolean
  /** character_cards.as_of_chapter；无卡时 null */
  asOfChapter: number | null
  /**
   * 本书最新完成章（MAX(chapter_summaries.chapter)，与引擎角色卡 asOf 同一口径）；无完成章为 0。
   * 编辑生效章的默认值（spec §3.3「默认=最新完成章」）——不依赖该角色是否已有角色卡：
   * 书写到第 20 章而角色尚无状态记录时，钦定默认仍须是 20 而非 0（否则静默改写全书初始设定）。
   */
  latestCompletedChapter: number
  identity: CharacterIdentitySummary | null
  /** 词表维度定义（无词表时空数组）；维度锚定编辑（直改/补录）只对在列维度开放 */
  dimensions: CharacterStateDimensionInfo[]
  card: CharacterStateCardEntry[]
  relationships: CharacterRelationshipEntry[]
  timeline: CharacterTimelineGroup[]
}
