import { describe, expect, test } from 'bun:test'
import { usePlannedStateRefresh } from './planned-state-refresh'

describe('usePlannedStateRefresh', () => {
  test('初始 version 为 0', () => {
    usePlannedStateRefresh.setState({ version: 0 })
    expect(usePlannedStateRefresh.getState().version).toBe(0)
  })

  test('bump() 递增 version，可连续调用多次', () => {
    usePlannedStateRefresh.setState({ version: 0 })
    usePlannedStateRefresh.getState().bump()
    expect(usePlannedStateRefresh.getState().version).toBe(1)
    usePlannedStateRefresh.getState().bump()
    usePlannedStateRefresh.getState().bump()
    expect(usePlannedStateRefresh.getState().version).toBe(3)
  })
})
