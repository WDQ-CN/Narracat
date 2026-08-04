import { beforeEach, describe, expect, test } from 'bun:test'
import {
  readResultNotificationProjection,
  rememberResultNotificationProjection,
  resetResultNotificationProjectionForTest,
} from './result-notification-projection'

describe('result notification projection', () => {
  beforeEach(() => {
    resetResultNotificationProjectionForTest()
  })

  test('keeps the last successful projection across route remounts', () => {
    expect(readResultNotificationProjection()).toBeNull()

    const payload = {
      notifications: [],
      totalCount: 3,
      unreadCount: 2,
    }
    rememberResultNotificationProjection(payload)

    expect(readResultNotificationProjection()).toBe(payload)
  })
})
