import { getNarratorAddressLabel, getPremiseCardTitleLabel, getPremiseCertaintyLabel } from '@shared/lib/schema-field-labels'

/**
 * 立项卡数据契约（ADR-0019，schemas/premise-cards.json）→ 视图模型 / 人读 markdown，
 * 由 App 从 DTO（bible/premise-cards.json）渲染。九卡 + 每条确定度三态归引擎所有，
 * premise.md 降为引擎机械渲染的只读视图；App 消费结构化契约，不解析 premise.md 反推。
 *
 * 本模块提供单一视图模型 buildPremiseCardViews / summarizePremiseOpenness，供卡片组件
 * （PremiseCardsView）与复制文档（renderPremiseCardsMarkdown）共用，确保浏览与复制一致。
 * 字段全部按存在性渲染，缺卡 / 未标注安静降级，不报错（ADR-0019 缺卡降级处理）。
 */

export type PremiseCardKey =
  | 'genre_contract'
  | 'core_hook'
  | 'golden_finger'
  | 'protagonist_desire'
  | 'antagonistic_force'
  | 'central_dramatic_question'
  | 'world_rules'
  | 'narrator_voice'

export type PremiseCertainty = 'canon' | 'tentative' | 'open'

export interface PremiseFieldData {
  key?: string
  value?: string
  certainty?: string
  note?: string
}

export interface PremiseCardData {
  card?: string
  fields?: PremiseFieldData[]
}

export interface PremiseCardsData {
  cards?: PremiseCardData[]
}

/** 八张实体卡的固定渲染顺序（第 9「留白声明」由各条确定度自动汇总，不入数据契约）。 */
const PREMISE_CARD_ORDER: PremiseCardKey[] = [
  'genre_contract',
  'core_hook',
  'golden_finger',
  'protagonist_desire',
  'antagonistic_force',
  'central_dramatic_question',
  'world_rules',
  'narrator_voice',
]

/** 单段卡：无子字段标签，直接呈现 value 段落（通常一条）。 */
const PROSE_CARDS = new Set<PremiseCardKey>(['core_hook', 'antagonistic_force', 'central_dramatic_question'])

/**
 * 子字段卡 / 叙述声音卡的 field.key → 中文标签（人读视图渲染用）。
 * 与 agent-core writers.ts 的 premise.md 渲染标签对齐；key 不在 ajv 枚举（自由字符串），
 * 故不进对照测试，未知 key 降级为原值（不裸露英文进用户通道由确定度/卡名枚举守住）。
 */
const PREMISE_FIELD_LABELS: Record<string, string> = {
  // 题材读者契约
  subgenre: '细分题材',
  reader_expectation: '读者默认期待',
  surprise_point: '本书超预期点',
  emotional_tone: '情绪基调',
  // 金手指与爽点引擎
  ability: '能力',
  limit: '限制',
  growth: '成长性',
  feedback_loop: '反馈回路',
  sustains_conflict: '为何不消灭冲突',
  // 主角欲望与代价
  surface_want: '表层想要',
  deep_need: '深层需要',
  cost: '付出代价',
  bottom_line: '底线',
  // 叙述声音
  archetype: '腔调原型',
  tone: '基调',
  pacing: '节奏',
  ornamentation: '修辞密度',
  digression: '插叙/议论',
  address: '叙述人称',
  style_keywords: '风格关键词',
  reference_inspiration: '参考来源',
  reference_example: '范例片段',
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPremiseCardKey(value: unknown): value is PremiseCardKey {
  return typeof value === 'string' && (PREMISE_CARD_ORDER as string[]).includes(value)
}

/** 规整确定度：空 / 未标注视为 canon；其余原样保留（未知值由 getPremiseCertaintyLabel 降级）。 */
function normalizeCertainty(raw?: string): string {
  const value = (raw ?? '').trim()
  return value === '' ? 'canon' : value
}

export interface PremiseFieldView {
  /** 原始 cards_json 字段 key（如 surface_want）；就地编辑乐观锁定位用，非人读标签 */
  key: string
  /** 人读字段标签；prose 卡 / world_rules 为空串（直接呈现 value） */
  label: string
  value: string
  /** world_rules 的冲突描述 / reference_example 的机制注解 */
  note?: string
  certaintyLabel: string
  isTentative: boolean
  isOpen: boolean
  /** 该字段在原始 cards_json 卡内 fields 数组的位置（编辑定位用，非过滤后视图位置） */
  sourceIndex: number
}

export interface PremiseCardView {
  key: PremiseCardKey
  /** 1-based 卡序号（按固定顺序，不随缺卡变化） */
  index: number
  title: string
  isProse: boolean
  fields: PremiseFieldView[]
  /** 该卡是否含暂定 / 留白项（卡头标记用） */
  hasGap: boolean
}

function buildFieldView(cardKey: PremiseCardKey, field: PremiseFieldData, sourceIndex: number): PremiseFieldView | null {
  if (!nonEmpty(field.value)) return null
  const certainty = normalizeCertainty(field.certainty)
  const usesLabel = !PROSE_CARDS.has(cardKey) && cardKey !== 'world_rules'
  const rawLabel = nonEmpty(field.key) ? (PREMISE_FIELD_LABELS[field.key] ?? field.key) : ''
  // 叙述人称 address 的 value 是受控英文枚举（纪律：enum 英文，中文归渲染层）——翻成人读徽标，
  // 不裸露 third_limited；其余字段 value 原样。未知值（含存量自由文本）降级为原值。
  const value =
    cardKey === 'narrator_voice' && field.key === 'address'
      ? getNarratorAddressLabel(field.value.trim())
      : field.value.trim()

  return {
    key: nonEmpty(field.key) ? field.key : '',
    label: usesLabel ? rawLabel : '',
    value,
    note: nonEmpty(field.note) ? field.note.trim() : undefined,
    certaintyLabel: getPremiseCertaintyLabel(certainty),
    isTentative: certainty === 'tentative',
    isOpen: certainty === 'open',
    sourceIndex,
  }
}

/** 按固定顺序构建八张实体卡的视图；缺卡 / 无有效字段的卡安静跳过。 */
export function buildPremiseCardViews(data: PremiseCardsData | null | undefined): PremiseCardView[] {
  const byCard = new Map<PremiseCardKey, PremiseFieldData[]>()
  for (const card of data?.cards ?? []) {
    if (isPremiseCardKey(card.card) && Array.isArray(card.fields)) byCard.set(card.card, card.fields)
  }

  const views: PremiseCardView[] = []
  PREMISE_CARD_ORDER.forEach((cardKey, orderIndex) => {
    const fields = byCard.get(cardKey)
    if (!fields) return
    const fieldViews = fields
      .map((field, sourceIndex) => buildFieldView(cardKey, field, sourceIndex))
      .filter((v): v is PremiseFieldView => v !== null)
    if (fieldViews.length === 0) return
    views.push({
      key: cardKey,
      index: orderIndex + 1,
      title: getPremiseCardTitleLabel(cardKey),
      isProse: PROSE_CARDS.has(cardKey),
      fields: fieldViews,
      hasGap: fieldViews.some((f) => f.isTentative || f.isOpen),
    })
  })
  return views
}

export interface PremiseOpennessRef {
  /** 「卡名·字段标签」人读引用；无字段标签时退化为卡名 */
  cardTitle: string
  fieldLabel: string
}

export interface PremiseOpennessSummary {
  tentative: PremiseOpennessRef[]
  open: PremiseOpennessRef[]
}

/** 第 9 卡「留白声明」：从八张卡各条确定度自动汇总暂定 / 留白项（不手写）。 */
export function summarizePremiseOpenness(data: PremiseCardsData | null | undefined): PremiseOpennessSummary {
  const tentative: PremiseOpennessRef[] = []
  const open: PremiseOpennessRef[] = []
  for (const card of buildPremiseCardViews(data)) {
    card.fields.forEach((field, fieldIndex) => {
      if (!field.isTentative && !field.isOpen) return
      const ref: PremiseOpennessRef = {
        cardTitle: card.title,
        fieldLabel: field.label || (card.isProse ? '' : `第 ${fieldIndex + 1} 项`),
      }
      if (field.isTentative) tentative.push(ref)
      else open.push(ref)
    })
  }
  return { tentative, open }
}

/** 留白引用 → 「卡名·字段」人读文本（无字段标签时退化为卡名）。 */
export function formatPremiseOpennessRef(ref: PremiseOpennessRef): string {
  return ref.fieldLabel ? `${ref.cardTitle}·${ref.fieldLabel}` : ref.cardTitle
}

/** canon 不标注（避免裸露），暂定 / 留白以中文徽标后缀人读呈现。 */
function certaintySuffix(field: PremiseFieldView): string {
  return field.isTentative || field.isOpen ? `（${field.certaintyLabel}）` : ''
}

/**
 * 立项卡 DTO → 人读 markdown，供复制文档（与卡片视图同源，不复制 .json 原文，ADR-0018）。
 * 九卡按固定序，缺卡跳过；第 9「留白声明」由确定度自动汇总。
 */
export function renderPremiseCardsMarkdown(data: PremiseCardsData | null | undefined): string {
  const cards = buildPremiseCardViews(data)
  if (cards.length === 0) return '# 立项卡\n\n立项卡数据契约缺失或为空。'

  const lines: string[] = ['# 立项卡', '']
  for (const card of cards) {
    lines.push(`## ${card.index} ${card.title}`, '')
    for (const field of card.fields) {
      const suffix = certaintySuffix(field)
      if (card.key === 'world_rules') {
        const conflict = field.note ? ` —— ${field.note}` : ''
        lines.push(`- ${field.value}${conflict}${suffix}`)
      } else if (card.isProse) {
        lines.push(`${field.value}${suffix}`, '')
      } else {
        const note = field.note ? `（${field.note}）` : ''
        const label = field.label ? `${field.label}：` : ''
        lines.push(`- ${label}${field.value}${note}${suffix}`)
      }
    }
    if (!card.isProse) lines.push('')
  }

  const { tentative, open } = summarizePremiseOpenness(data)
  lines.push('## 9 留白声明', '')
  if (tentative.length === 0 && open.length === 0) {
    lines.push('（九卡均已定，暂无暂定或未确定项）', '')
  } else {
    if (tentative.length > 0) lines.push(`- 暂定：${tentative.map(formatPremiseOpennessRef).join('、')}`)
    if (open.length > 0) lines.push(`- 未确定：${open.map(formatPremiseOpennessRef).join('、')}`)
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}
