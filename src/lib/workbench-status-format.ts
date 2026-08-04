import type {
  NovelStatusForeshadowingState,
  NovelStatusForeshadowingType,
} from '@shared/types/novel'

export function formatWordCount(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0 字'
  if (total >= 10000) return `${(total / 10000).toFixed(1)} 万字`
  return `${total} 字`
}

export function formatStatusTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

export function resolveNextActionLabel(chapter: number | null): string {
  return chapter !== null ? `第 ${chapter} 章` : '已规划完成'
}

const foreshadowingStateLabels: Record<NovelStatusForeshadowingState, string> = {
  registered: '已登记',
  planted: '已埋设',
  developing: '推进中',
  revealed: '已揭示',
}

export function resolveForeshadowingStateLabel(state: NovelStatusForeshadowingState): string {
  return foreshadowingStateLabels[state]
}

const foreshadowingTypeLabels: Record<NovelStatusForeshadowingType, string> = {
  small: '小',
  medium: '中',
  major: '大',
}

export function resolveForeshadowingTypeLabel(type: NovelStatusForeshadowingType): string {
  return foreshadowingTypeLabels[type]
}
