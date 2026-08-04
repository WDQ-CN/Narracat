import type { CapabilityPackSummary } from '@shared/types/capability-pack'

/** 卡类型 → 结果语言标签（spec §7 R6：用户侧一律用结果语言，卡类型/消费方只留内部实现层） */
export const CARD_TYPE_LABELS: Record<'persona' | 'craft' | 'structure' | 'benchmark', string> = {
  persona: '写作声音',
  craft: '写作手法',
  structure: '剧作方法',
  benchmark: '对标标准',
}

/** 卡数汇总为结果语言文案；benchmark 仅计数 >0 才纳入（多数包无对标卡） */
export function summarizeCardTypeCounts(counts: CapabilityPackSummary['cardTypeCounts']): string {
  const parts = [
    `${CARD_TYPE_LABELS.persona} ${counts.persona}`,
    `${CARD_TYPE_LABELS.craft} ${counts.craft}`,
    `${CARD_TYPE_LABELS.structure} ${counts.structure}`,
  ]
  if (counts.benchmark > 0) parts.push(`${CARD_TYPE_LABELS.benchmark} ${counts.benchmark}`)
  return parts.join(' · ')
}
