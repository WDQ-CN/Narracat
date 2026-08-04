/**
 * 立项卡字段两档分流（ADR-0029）。第一档 = 无下游依赖的纯描述字段，可 App 直写保存；
 * 其余（引擎字段 / 风格 / 世界规则本体 / 受控枚举）归第二档，须经 Agent 评估级联。
 * Fail-safe：白名单之外一律第二档。world_rules 的 note 第一档编辑因 value/note 同行、
 * 交互特殊，本切片暂不开放，故 world_rules 整卡不入白名单。
 * App 与主进程共享本文件；isSecondTierEvaluableField 仅供渲染端消费（判断「编辑→评估」
 * 入口），主进程只用 isFirstTierField，无对应守卫。
 */
const FIRST_TIER_FIELDS: Record<string, ReadonlySet<string>> = {
  genre_contract: new Set(['subgenre', 'reader_expectation', 'surprise_point', 'emotional_tone']),
  golden_finger: new Set(['ability', 'limit', 'growth', 'sustains_conflict']),
  protagonist_desire: new Set(['cost', 'bottom_line']),
}

/** prose 卡（无子字段 key）整卡归第一档：仅 core_hook（antagonistic_force / central_dramatic_question 是第二档）。 */
const FIRST_TIER_PROSE_CARDS: ReadonlySet<string> = new Set(['core_hook'])

export function isFirstTierField(cardKey: string, fieldKey: string): boolean {
  if (FIRST_TIER_PROSE_CARDS.has(cardKey)) return true
  return FIRST_TIER_FIELDS[cardKey]?.has(fieldKey) ?? false
}

/**
 * 第二档「评估后保存」可行字段（ADR-0029）：非第一档、且不是 world_rules。
 * 第二档字段不经 App 直写——编辑捕获的是「修改意图」，交 /revise-premise 评估级联影响、
 * 作者确认后才落库。world_rules 的 value/note 同行、交互特殊，本期后置（仍走「重新讨论」）。
 * 仅渲染端判定是否出「编辑→评估」入口；主进程无对应守卫（第二档不走 submitPremiseFieldEdit 直写）。
 */
export function isSecondTierEvaluableField(cardKey: string, fieldKey: string): boolean {
  if (cardKey === 'world_rules') return false
  return !isFirstTierField(cardKey, fieldKey)
}
