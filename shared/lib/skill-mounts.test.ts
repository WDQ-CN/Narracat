import { describe, expect, test } from 'bun:test'
import { resolveEffectiveMounts, resolveEffectiveMountViews } from './skill-mounts'
import type { AgentSkillMount } from '@shared/types/skill-mount'

describe('resolveEffectiveMounts', () => {
  test('empty overlay yields pure Agent Core default (all preload)', () => {
    const result = resolveEffectiveMounts({
      agentId: 'outline-architect',
      defaultSkills: ['novel-structure'],
      userMounts: [],
    })

    expect(result).toEqual({ agentId: 'outline-architect', preload: ['novel-structure'], onDemand: [] })
  })

  test('merges default + user preload mount and dedupes', () => {
    const userMounts: AgentSkillMount[] = [
      { agentId: 'outline-architect', skillId: 'sample-craft', mode: 'preload', state: 'mounted' },
      // duplicate of a default — must not appear twice
      { agentId: 'outline-architect', skillId: 'novel-structure', mode: 'preload', state: 'mounted' },
    ]

    const result = resolveEffectiveMounts({
      agentId: 'outline-architect',
      defaultSkills: ['novel-structure'],
      userMounts,
    })

    expect(result.preload).toEqual(['novel-structure', 'sample-craft'])
    expect(result.onDemand).toEqual([])
  })

  test('only affects the selected agent, ignoring other agents overlays', () => {
    const userMounts: AgentSkillMount[] = [
      { agentId: 'chapter-writer', skillId: 'sample-craft', mode: 'preload', state: 'mounted' },
    ]

    const result = resolveEffectiveMounts({
      agentId: 'world-curator',
      defaultSkills: [],
      userMounts,
    })

    expect(result).toEqual({ agentId: 'world-curator', preload: [], onDemand: [] })
  })

  test('default skills appear with default origin; user additions with user origin', () => {
    const views = resolveEffectiveMountViews({
      agentId: 'outline-architect',
      defaultSkills: ['novel-structure'],
      userMounts: [{ agentId: 'outline-architect', skillId: 'sample-craft', mode: 'preload', state: 'mounted' }],
    })

    expect(views).toEqual([
      { skillId: 'novel-structure', mode: 'preload', origin: 'default' },
      { skillId: 'sample-craft', mode: 'preload', origin: 'user' },
    ])
  })

  test('dedupes repeated default skills', () => {
    const result = resolveEffectiveMounts({
      agentId: 'a',
      defaultSkills: ['s1', 's1', 's2'],
      userMounts: [],
    })
    expect(result.preload).toEqual(['s1', 's2'])
  })

  test('official default skill is locked: unmount overlay is ignored, stays preloaded', () => {
    const result = resolveEffectiveMounts({
      agentId: 'outline-architect',
      defaultSkills: ['novel-structure'],
      userMounts: [
        { agentId: 'outline-architect', skillId: 'novel-structure', mode: 'preload', state: 'unmounted' },
      ],
    })

    // 官方默认不可卸：针对它的 unmounted 叠加被忽略，始终留在 preload（消解 F2 的关键不变量）
    expect(result.preload).toEqual(['novel-structure'])
    expect(result.onDemand).toEqual([])
  })

  test('unmounting a user-mounted skill removes it from the effective set', () => {
    // 用户先挂 sample-craft，又记录 unmounted（覆盖自己的挂载）
    const result = resolveEffectiveMounts({
      agentId: 'chapter-writer',
      defaultSkills: [],
      userMounts: [
        { agentId: 'chapter-writer', skillId: 'sample-craft', mode: 'preload', state: 'unmounted' },
      ],
    })

    expect(result.preload).toEqual([])
  })

  test('reset (no user overlay) returns the pure Agent Core default', () => {
    // 恢复默认 = 清空该 Agent 的用户叠加，等价于空 userMounts
    const result = resolveEffectiveMounts({
      agentId: 'outline-architect',
      defaultSkills: ['novel-structure'],
      userMounts: [],
    })

    expect(result.preload).toEqual(['novel-structure'])
  })

  test('official default skill is locked: mode-change overlay is ignored', () => {
    const views = resolveEffectiveMountViews({
      agentId: 'outline-architect',
      defaultSkills: ['novel-structure'],
      userMounts: [
        // 用户试图把官方默认预加载项改挂为按需——锁定，无效
        { agentId: 'outline-architect', skillId: 'novel-structure', mode: 'on-demand', state: 'mounted' },
      ],
    })

    // 官方默认锁定：保持 preload / default，忽略改 mode 叠加
    expect(views).toEqual([{ skillId: 'novel-structure', mode: 'preload', origin: 'default' }])
  })

  test('classifies preload and on-demand mounts into separate buckets', () => {
    const result = resolveEffectiveMounts({
      agentId: 'chapter-writer',
      defaultSkills: [],
      userMounts: [
        { agentId: 'chapter-writer', skillId: 'novel-structure', mode: 'preload', state: 'mounted' },
        { agentId: 'chapter-writer', skillId: 'sample-craft', mode: 'on-demand', state: 'mounted' },
      ],
    })

    expect(result.preload).toEqual(['novel-structure'])
    expect(result.onDemand).toEqual(['sample-craft'])
  })

  test('last user overlay for a skill wins', () => {
    const result = resolveEffectiveMounts({
      agentId: 'a',
      defaultSkills: [],
      userMounts: [
        { agentId: 'a', skillId: 's1', mode: 'preload', state: 'mounted' },
        { agentId: 'a', skillId: 's1', mode: 'preload', state: 'unmounted' },
      ],
    })

    expect(result.preload).toEqual([])
  })
})
