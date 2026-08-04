/**
 * schema-field-labels —— 数据层机器字段 → 人读中文标签映射（ADR-0016 横切地基）
 *
 * 落实 ADR-0016「机器字段不入用户通道」：schema 枚举、机器主键、确定度标记不以原始
 * 文本进入用户通道，统一在此映射为人读徽标 / 序号，供大纲浏览、立项卡、审校报告、
 * 状态面板等产物浏览复用。
 *
 * SSOT 分层：枚举*定义*权威在 agent-core schema（schemas/outline-structure.json /
 * review-report.json）；人话*中文标签*归本表。两侧用 schema-field-labels.test.ts 的
 * 对照测试防漂移（schema 枚举值集 ↔ App 映射 key 集 一一对应）+ 运行时未知值降级兜底。
 *
 * 纯函数、无副作用、不读文件、不依赖 node —— 可被 renderer 安全打包。
 */

// ── OutlineStructure 枚举（schemas/outline-structure.json） ──────────────────

/** storyline.type —— 故事线类型 */
const STORYLINE_TYPE_LABELS: Record<string, string> = {
  main: '主线',
  growth: '成长线',
  romance: '感情线',
  faction: '势力线',
  mystery: '悬疑线',
  rivalry: '宿敌线',
  world: '世界线',
  other: '其他',
}

/** storyline.status —— 故事线状态（缺省 active） */
const STORYLINE_STATUS_LABELS: Record<string, string> = {
  active: '活跃',
  dormant: '蛰伏',
  resolved: '已收束',
}

/** foreshadowing_registry.type —— 伏笔量级（兑现范围：arc 内 / 本卷 / 跨卷） */
const FORESHADOWING_TYPE_LABELS: Record<string, string> = {
  small: '小伏笔',
  medium: '中伏笔',
  major: '大伏笔',
}

/** volume.dilemma_milestone —— 困境层级里程碑 */
const DILEMMA_MILESTONE_LABELS: Record<string, string> = {
  ability: '能力',
  choice: '抉择',
  value: '价值',
  identity: '身份',
  existential: '存在',
}

/** arc.payoff_beats —— 爽点类型 */
const PAYOFF_BEAT_LABELS: Record<string, string> = {
  face_slap: '打脸',
  level_up: '升级',
  windfall: '机缘',
  fame: '扬名',
  reveal: '反转',
  reunion: '重逢',
  counterattack: '逆袭',
  sweet: '发糖',
}

/** chapter_outline.foreshadowing_touch.action —— 伏笔动作 */
const FORESHADOWING_ACTION_LABELS: Record<string, string> = {
  plant: '埋设',
  develop: '推进',
  reveal: '揭示',
}

/** chapter_outline.payoff_intensity —— 本章爽点兑现强度 */
const PAYOFF_INTENSITY_LABELS: Record<string, string> = {
  small: '小',
  medium: '中',
  large: '大',
}

/** chapter_outline.end_hook —— 章末钩类型（与引擎渲染层 END_HOOK_LABEL 同源） */
const END_HOOK_LABELS: Record<string, string> = {
  suspense: '悬念',
  danger: '危机',
  emotional: '情绪',
  none: '无钩',
}

/** chapter_outline.state_changes[].operation —— 计划状态变更操作（与引擎渲染层同源：set=变为/add=获得/remove=失去） */
const STATE_CHANGE_OPERATION_LABELS: Record<string, string> = {
  set: '变为',
  add: '获得',
  remove: '失去',
}

// ── ReviewReport 枚举（schemas/review-report.json） ──────────────────────────

/** issue.severity —— 审校问题级别 */
const REVIEW_SEVERITY_LABELS: Record<string, string> = {
  blocker: '硬伤',
  note: '存疑',
}

// ── PremiseCards 枚举（schemas/premise-cards.json，ADR-0019） ─────────────────

/** premise_card.card —— 八张实体立项卡的卡名（第 9「留白声明」由各条确定度自动汇总，不入枚举） */
const PREMISE_CARD_TITLE_LABELS: Record<string, string> = {
  genre_contract: '题材读者契约',
  core_hook: '核心钩子',
  golden_finger: '金手指与爽点引擎',
  protagonist_desire: '主角欲望与代价',
  antagonistic_force: '对抗力量',
  central_dramatic_question: '中心戏剧问题',
  world_rules: '世界规则可冲突性',
  narrator_voice: '叙述声音',
}

/**
 * premise_field.certainty —— 立项卡每条确定度三态。
 * schema 枚举（SSOT），未标注（省略）视为 canon。supersede #243 定案 3：从 App 硬编码
 * 方括号文本解析改为 schema 枚举映射 + 对照测试防漂移。
 */
const PREMISE_CERTAINTY_LABELS: Record<string, string> = {
  canon: '已定',
  tentative: '暂定',
  open: '未确定',
}

/**
 * narrator_voice 卡 address 字段（叙述人称）—— schema 枚举（$defs.narrator_address）→ 人读徽标。
 * cards_json 真相存英文枚举（纪律：enum 英文，中文归渲染层）；本表为立项卡浏览 / 复制的中文徽标。
 * 引擎侧另有 narratorAddressPhrase 喂写手 style_directive；两侧经对照测试与 schema 枚举绑定防漂移。
 * 未知值（含存量自由文本）降级为原值。
 */
const NARRATOR_ADDRESS_LABELS: Record<string, string> = {
  first_person: '第一人称',
  third_limited: '第三人称·限知',
  third_omniscient: '第三人称·全知',
  multi_pov: '多视角切换',
}

// ── getters：未知值降级为原值，不报错（合法枚举由对照测试保证全覆盖） ──────────

export function getStorylineTypeLabel(type: string): string {
  return STORYLINE_TYPE_LABELS[type] ?? type
}

export function getStorylineStatusLabel(status: string): string {
  return STORYLINE_STATUS_LABELS[status] ?? status
}

export function getForeshadowingTypeLabel(type: string): string {
  return FORESHADOWING_TYPE_LABELS[type] ?? type
}

export function getDilemmaMilestoneLabel(milestone: string): string {
  return DILEMMA_MILESTONE_LABELS[milestone] ?? milestone
}

export function getPayoffBeatLabel(beat: string): string {
  return PAYOFF_BEAT_LABELS[beat] ?? beat
}

export function getForeshadowingActionLabel(action: string): string {
  return FORESHADOWING_ACTION_LABELS[action] ?? action
}

export function getPayoffIntensityLabel(intensity: string): string {
  return PAYOFF_INTENSITY_LABELS[intensity] ?? intensity
}

export function getReviewSeverityLabel(severity: string): string {
  return REVIEW_SEVERITY_LABELS[severity] ?? severity
}

export function getPremiseCardTitleLabel(card: string): string {
  return PREMISE_CARD_TITLE_LABELS[card] ?? card
}

/**
 * 立项卡确定度枚举 → 徽标文案。
 * 空值 / 未标注视为 canon（已定，schema 默认）；未知非空枚举降级为原值，
 * 不升级为权威「已定」——避免把不稳定标注误标成既定事实（ADR-0016 / 不编造）。
 */
export function getPremiseCertaintyLabel(certainty: string): string {
  const key = certainty.trim()
  if (key === '') return PREMISE_CERTAINTY_LABELS.canon
  return PREMISE_CERTAINTY_LABELS[key] ?? key
}

/** 叙述人称枚举 → 人读徽标；未知值（含存量自由文本）降级为原值。 */
export function getNarratorAddressLabel(address: string): string {
  return NARRATOR_ADDRESS_LABELS[address] ?? address
}

// ── 非 ajv 枚举：App 侧约定值（不在 schema，硬编码 + 注释来源，不参与对照测试） ───

/**
 * 审校结论。
 * 来源：schemas/review-report.json —— verdict 由代码计算（任一 blocker 即 fail），机械渲染为
 *   reviews/ch-NNN-review.md 的「审修结果: PASS|FAIL」锚点行（见 CONTEXT「ReviewReport JSON 孪生」）。
 * verdict 本身不是 ajv 枚举字段，故由 App 硬编码、不进 CI 对照测试。
 */
const REVIEW_VERDICT_LABELS: Record<string, string> = {
  PASS: '通过',
  FAIL: '未通过',
}

/** 审修结果 PASS|FAIL → 徽标文案；大小写不敏感，未知值降级为原值。 */
export function getReviewVerdictLabel(verdict: string): string {
  return REVIEW_VERDICT_LABELS[verdict.trim().toUpperCase()] ?? verdict
}

// ── 机器主键：默认隐藏 + 按需人读序号（ADR-0016） ────────────────────────────

/** storyline `SL-*` / 伏笔 `F*` / arc `V01-A01` 等机器主键，默认不进用户通道。 */
const MACHINE_PRIMARY_KEY_PATTERNS: RegExp[] = [
  /^SL-/i, // storyline id, e.g. SL-revenge
  /^F[0-9-]/i, // foreshadowing id, e.g. F01 / F-CONSPIRACY-01
  /^V\d{2}-A\d{2}$/i, // arc id, e.g. V01-A02
]

export function isMachinePrimaryKey(value: string): boolean {
  const trimmed = value.trim()
  return MACHINE_PRIMARY_KEY_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export type MachineKeyKind = 'storyline' | 'foreshadowing' | 'arc'

/** 人读序号前缀（文案集中此处，需指认的消费方按需开启）。 */
const HUMAN_ORDINAL_PREFIXES: Record<MachineKeyKind, string> = {
  storyline: '故事线',
  foreshadowing: '伏笔',
  arc: '故事弧',
}

/**
 * 人读序号：把隐藏的机器主键替换为「故事线 2」式可指认序号。
 * 默认隐藏主键；仅需指认的消费方按 1-based 次序调用本函数（集中可配点）。
 */
export function getHumanOrdinalLabel(kind: MachineKeyKind, ordinal1Based: number): string {
  return `${HUMAN_ORDINAL_PREFIXES[kind]} ${ordinal1Based}`
}

// ── 对照测试绑定：schema 枚举字段（JSON 路径）↔ 本模块标签映射 ─────────────────

/**
 * 供 schema-field-labels.test.ts 的对照测试遍历：每条绑定声明一个 agent-core schema 内
 * 的 ajv 枚举字段（其 JSON 路径）与本模块对应的标签映射。测试断言两侧 key 集一一对应
 * （schema 新增枚举而 App 未映射、或 App 残留 schema 已删枚举 → 失败）。
 * 审校 verdict 由代码计算（非 ajv 枚举字段），不在此列。
 */
export const SCHEMA_ENUM_LABEL_BINDINGS = [
  {
    field: 'storyline.type',
    schemaFile: 'outline-structure.json',
    enumPath: ['properties', 'storylines', 'items', 'properties', 'type', 'enum'],
    labels: STORYLINE_TYPE_LABELS,
  },
  {
    field: 'storyline.status',
    schemaFile: 'outline-structure.json',
    enumPath: ['properties', 'storylines', 'items', 'properties', 'status', 'enum'],
    labels: STORYLINE_STATUS_LABELS,
  },
  {
    field: 'foreshadowing_registry.type',
    schemaFile: 'outline-structure.json',
    enumPath: ['properties', 'foreshadowing_registry', 'items', 'properties', 'type', 'enum'],
    labels: FORESHADOWING_TYPE_LABELS,
  },
  {
    field: 'volume.dilemma_milestone',
    schemaFile: 'outline-structure.json',
    enumPath: ['properties', 'volumes', 'items', 'properties', 'dilemma_milestone', 'enum'],
    labels: DILEMMA_MILESTONE_LABELS,
  },
  {
    field: 'arc.payoff_beats',
    schemaFile: 'outline-structure.json',
    enumPath: ['properties', 'volumes', 'items', 'properties', 'arc_list', 'items', 'properties', 'payoff_beats', 'items', 'enum'],
    labels: PAYOFF_BEAT_LABELS,
  },
  {
    field: 'chapter_outline.payoff_beat',
    schemaFile: 'outline-structure.json',
    enumPath: ['$defs', 'chapter_outline', 'properties', 'payoff_beat', 'enum'],
    labels: PAYOFF_BEAT_LABELS,
  },
  {
    field: 'chapter_outline.foreshadowing_touch.action',
    schemaFile: 'outline-structure.json',
    enumPath: ['$defs', 'chapter_outline', 'properties', 'foreshadowing_touch', 'items', 'properties', 'action', 'enum'],
    labels: FORESHADOWING_ACTION_LABELS,
  },
  {
    field: 'chapter_outline.payoff_intensity',
    schemaFile: 'outline-structure.json',
    enumPath: ['$defs', 'chapter_outline', 'properties', 'payoff_intensity', 'enum'],
    labels: PAYOFF_INTENSITY_LABELS,
  },
  {
    field: 'chapter_outline.end_hook',
    schemaFile: 'outline-structure.json',
    enumPath: ['$defs', 'chapter_outline', 'properties', 'end_hook', 'enum'],
    labels: END_HOOK_LABELS,
  },
  {
    field: 'chapter_outline.state_changes.operation',
    schemaFile: 'outline-structure.json',
    enumPath: ['$defs', 'chapter_outline', 'properties', 'state_changes', 'items', 'properties', 'operation', 'enum'],
    labels: STATE_CHANGE_OPERATION_LABELS,
  },
  {
    field: 'issue.severity',
    schemaFile: 'review-report.json',
    enumPath: ['properties', 'issues', 'items', 'properties', 'severity', 'enum'],
    labels: REVIEW_SEVERITY_LABELS,
  },
  {
    field: 'premise_card.card',
    schemaFile: 'premise-cards.json',
    enumPath: ['$defs', 'premise_card', 'properties', 'card', 'enum'],
    labels: PREMISE_CARD_TITLE_LABELS,
  },
  {
    field: 'premise_field.certainty',
    schemaFile: 'premise-cards.json',
    enumPath: ['$defs', 'premise_field', 'properties', 'certainty', 'enum'],
    labels: PREMISE_CERTAINTY_LABELS,
  },
  {
    field: 'narrator_voice.address',
    schemaFile: 'premise-cards.json',
    enumPath: ['$defs', 'narrator_address', 'enum'],
    labels: NARRATOR_ADDRESS_LABELS,
  },
] as const
