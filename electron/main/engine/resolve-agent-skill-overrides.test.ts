import { describe, expect, test } from 'bun:test'
import { resolveAgentSkillOverrides } from './resolve-agent-skill-overrides'

const FIXTURE_AGENT_CORE = '/agent-core'

describe('resolveAgentSkillOverrides（作者调整注入）', () => {
  test('无 userDataPath → agents undefined', async () => {
    const result = await resolveAgentSkillOverrides({ agentCorePath: FIXTURE_AGENT_CORE })
    expect(result.agents).toBeUndefined()
  })

  test('存量全空 → agents undefined（纯默认不组装）', async () => {
    const result = await resolveAgentSkillOverrides(
      { agentCorePath: FIXTURE_AGENT_CORE, userDataPath: '/tmp/whatever' },
      { listRequests: async () => [], readProseOverrides: async () => ({}) },
    )
    expect(result.agents).toBeUndefined()
  })

  test('有要求 → 按 agent 分组喂进 assemble', async () => {
    let seen: Record<string, string[]> | undefined
    await resolveAgentSkillOverrides(
      { agentCorePath: FIXTURE_AGENT_CORE, userDataPath: '/tmp/whatever' },
      {
        listRequests: async () => [
          { id: 'a', agentId: 'chapter-writer', text: '第一条', createdAt: '2026-08-07T00:00:00.000Z' },
          { id: 'b', agentId: 'chapter-writer', text: '第二条', createdAt: '2026-08-07T00:00:01.000Z' },
        ],
        readProseOverrides: async () => ({}),
        assemble: async (args) => {
          seen = args.authorRequestsByAgent
          return { 'chapter-writer': { description: 'd', prompt: 'p' } }
        },
      },
    )
    expect(seen).toEqual({ 'chapter-writer': ['第一条', '第二条'] })
  })

  test('读存量抛错 → 降级 undefined，绝不阻断 run', async () => {
    const result = await resolveAgentSkillOverrides(
      { agentCorePath: FIXTURE_AGENT_CORE, userDataPath: '/tmp/whatever' },
      {
        listRequests: async () => {
          throw new Error('boom')
        },
      },
    )
    expect(result.agents).toBeUndefined()
  })
})
