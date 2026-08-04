import { describe, expect, test } from 'bun:test'
import { buildPendingSyncWriteWarning } from './pending-memory-sync-gate'

describe('buildPendingSyncWriteWarning', () => {
  const map = { '3': { savedAt: 't', reasons: ['实体名'] }, '1': { savedAt: 't', reasons: [] } }

  test('write-next + 有待同步章 → 返回按章号升序的确认文案', () => {
    const warning = buildPendingSyncWriteWarning('write-next', map)
    expect(warning).toContain('第 1、3 章')
    expect(warning).toContain('尚未同步记忆')
  })

  test('非 write-next 命令不拦', () => {
    expect(buildPendingSyncWriteWarning('review', map)).toBeNull()
    expect(buildPendingSyncWriteWarning(undefined, map)).toBeNull()
  })

  test('无待同步章不拦', () => {
    expect(buildPendingSyncWriteWarning('write-next', {})).toBeNull()
  })
})
