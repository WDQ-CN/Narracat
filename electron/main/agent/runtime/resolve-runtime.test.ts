import { describe, expect, test } from 'bun:test'
import { resolveAgentRuntime } from './resolve-runtime.ts'

describe('resolveAgentRuntime', () => {
  test('单底座（拆旧刀5）：恒解析 pi', () => {
    expect(resolveAgentRuntime({}).id).toBe('pi')
    expect(resolveAgentRuntime(undefined).id).toBe('pi')
  })

  test('adapter 进程内单例复用', () => {
    expect(resolveAgentRuntime({})).toBe(resolveAgentRuntime({}))
  })
})
