import type { ResultNotificationList } from '@shared/types/notifications'

let lastGoodProjection: ResultNotificationList | null = null

export function readResultNotificationProjection(): ResultNotificationList | null {
  return lastGoodProjection
}

export function rememberResultNotificationProjection(payload: ResultNotificationList): void {
  lastGoodProjection = payload
}

export function resetResultNotificationProjectionForTest(): void {
  lastGoodProjection = null
}
