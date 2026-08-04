import { describe, expect, it } from 'vitest'
import { resolveCharacterProfileStageBadge } from './character-profile-stage'

describe('resolveCharacterProfileStageBadge', () => {
  it('stub → 待完善，需关注', () => {
    const badge = resolveCharacterProfileStageBadge('stub')
    expect(badge.label).toBe('待完善')
    expect(badge.needsAttention).toBe(true)
  })

  it('sketch → 完善中，需关注', () => {
    const badge = resolveCharacterProfileStageBadge('sketch')
    expect(badge.label).toBe('完善中')
    expect(badge.needsAttention).toBe(true)
  })

  it('full → 已完整，无需关注（UI 不展示徽标）', () => {
    const badge = resolveCharacterProfileStageBadge('full')
    expect(badge.label).toBe('已完整')
    expect(badge.needsAttention).toBe(false)
  })

  it('缺阶段（旧档）按 full 兼容', () => {
    const badge = resolveCharacterProfileStageBadge(undefined)
    expect(badge.needsAttention).toBe(false)
  })
})
