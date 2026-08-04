import type { CharacterProfileStage } from '@shared/types/novel'

/**
 * 角色档案完善度阶段的人读标签（渐进生长 stub→sketch→full，ADR-0015）。
 * 机器枚举不外露：UI 只展示中文标签。full 不展示徽标（已完整无需提示）。
 */
const STAGE_LABELS: Record<CharacterProfileStage, string> = {
  stub: '待完善',
  sketch: '完善中',
  full: '已完整',
}

const STAGE_HINTS: Record<CharacterProfileStage, string> = {
  stub: '写作期就地建档，关键维度尚未补全',
  sketch: '关键维度已成形，仍可继续深化',
  full: '角色档案已完整',
}

export interface CharacterProfileStageBadge {
  label: string
  hint: string
  /** full 阶段无需提示，UI 可不展示徽标。 */
  needsAttention: boolean
}

/**
 * 解析角色档案完善度徽标。缺阶段（旧档）按 full。
 * needsAttention 在 stub / sketch 为 true——UI 据此决定是否给「补充此项」入口。
 */
export function resolveCharacterProfileStageBadge(
  stage: CharacterProfileStage | undefined,
): CharacterProfileStageBadge {
  const resolved: CharacterProfileStage = stage ?? 'full'
  return {
    label: STAGE_LABELS[resolved],
    hint: STAGE_HINTS[resolved],
    needsAttention: resolved !== 'full',
  }
}
