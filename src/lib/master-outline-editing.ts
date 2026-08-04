import { buildRevisePremiseEvaluationPrompt } from './premise-impact-evaluation'
import { ENGINE_FIELDS } from '@shared/lib/outline-structure'

/**
 * 书级大纲（master-outline）编辑分档（ADR-0029 + spec 2026-07-12）。
 * 五个引擎字段与立项卡是同一份信息的两个视图（引擎 PREMISE_ENGINE_FACT_MAP 双向同步），
 * 立项卡侧已判第二档 → 大纲页编辑它们必须走同一条 /revise-premise 评估管道，
 * 否则宪法分裂（同一信息两处档位不同）。stakes_progression 大纲独有，无立项卡锚点，
 * 走 freeform 评估 + novel_update_outline_book_field 落盘（PR2）。
 */
export const MASTER_OUTLINE_ENGINE_FIELD_LABELS: Record<string, string> = Object.fromEntries(ENGINE_FIELDS)

interface PremiseAnchor {
  cardTitle: string
  /** prose 卡整卡即一段内容时为空串（与 PremiseCardsView 的 field label 约定一致） */
  fieldLabel: string
}

const ENGINE_FIELD_PREMISE_ANCHORS: Record<string, PremiseAnchor> = {
  central_dramatic_question: { cardTitle: '中心戏剧问题', fieldLabel: '' },
  protagonist_core_desire: { cardTitle: '主角欲望与代价', fieldLabel: '表层想要' },
  protagonist_core_lack: { cardTitle: '主角欲望与代价', fieldLabel: '深层需要' },
  antagonistic_force: { cardTitle: '对抗力量', fieldLabel: '' },
}

export function getMasterOutlineEnginePremiseAnchor(fieldKey: string): PremiseAnchor | null {
  return ENGINE_FIELD_PREMISE_ANCHORS[fieldKey] ?? null
}

/**
 * stakes_progression 无立项卡锚点，走独立 freeform 评估通路：Agent 评估级联影响 → 用户二次确认 →
 * Agent 用 novel_update_outline_book_field 落盘（PR2）。prompt 面向 Agent，用引擎口径「赌注递增曲线」
 * 无妨；UI 展示层一律用标签表（MASTER_OUTLINE_ENGINE_FIELD_LABELS），不出现这个字段名。
 */
export function buildStakesProgressionEvaluationPrompt(input: { oldValue: string; newValue: string }): string {
  return [
    '我要修改全书大纲的「赌注递增曲线」。',
    `当前内容：${input.oldValue}`,
    `改为：${input.newValue}`,
    '新值我已确定，无需再讨论。请评估这次改动对既有卷/arc 规划与已写章节的级联影响，',
    '把影响清单摆给我二次确认；我确认后再用 novel_update_outline_book_field 落盘',
    '（target=stakes_progression，expected_old_value 传当前内容原文），取消则不要做任何修改。',
    '注意：已生成的章纲与正文不会自动重排，请在影响清单里讲清这条边界。',
  ].join('\n')
}

export function buildMasterOutlineEngineFieldPrompt(input: {
  fieldKey: string
  oldValue: string
  newValue: string
}): string {
  const anchor = getMasterOutlineEnginePremiseAnchor(input.fieldKey)
  if (!anchor) throw new Error(`字段 ${input.fieldKey} 没有立项卡锚点，不能走 revise-premise 通路`)
  return buildRevisePremiseEvaluationPrompt({
    cardTitle: anchor.cardTitle,
    fieldLabel: anchor.fieldLabel,
    oldValue: input.oldValue,
    newValue: input.newValue,
  })
}
