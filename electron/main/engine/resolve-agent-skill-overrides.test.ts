import { describe, expect, spyOn, test } from 'bun:test'
import type { AgentDefinition } from '../agent/runtime/adapters/claude-sdk/index.ts'
import type { AgentSkillMount, UserSkill } from '@shared/types/skill-mount'
import { resolveAgentSkillOverrides } from './resolve-agent-skill-overrides'

const ARGS = { agentCorePath: '/agent-core', skillMountStorePath: '/store.json' }

const PRELOAD_MOUNT: AgentSkillMount = {
  agentId: 'chapter-writer',
  skillId: 'sample-craft',
  mode: 'preload',
  state: 'mounted',
}

function makeUserSkill(overrides: Partial<UserSkill> = {}): UserSkill {
  return {
    id: 'user-1',
    agentId: 'chapter-writer',
    name: 'dialogue-pack',
    description: '对话范例库。',
    sourcePath: '/src',
    hasScripts: false,
    mountedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveAgentSkillOverrides', () => {
  test('no user overlay short-circuits to undefined agents (pure plugin defaults stand)', async () => {
    let assembled = false
    const { agents } = await resolveAgentSkillOverrides(ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
      listMounts: async () => [],
      assemble: async () => {
        assembled = true
        return {}
      },
    })

    expect(agents).toBeUndefined()
    // 空叠加直接短路，不应进入组装
    expect(assembled).toBe(false)
  })

  test('overlay assembling into agents returns the agents record', async () => {
    const definition: AgentDefinition = { description: 'd', prompt: 'p', skills: ['sample-craft'] }
    const { agents } = await resolveAgentSkillOverrides(ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
      listMounts: async () => [PRELOAD_MOUNT],
      assemble: async () => ({ 'chapter-writer': definition }),
    })

    expect(agents).toEqual({ 'chapter-writer': definition })
  })

  test('overlay that assembles to an empty record degrades to undefined agents', async () => {
    const { agents } = await resolveAgentSkillOverrides(ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
      listMounts: async () => [PRELOAD_MOUNT],
      assemble: async () => ({}),
    })

    expect(agents).toBeUndefined()
  })

  test('diagnostics failure degrades to undefined instead of throwing', async () => {
    const { agents } = await resolveAgentSkillOverrides(ARGS, {
      readDiagnostics: async () => {
        throw new Error('diagnostics blew up')
      },
      listMounts: async () => [PRELOAD_MOUNT],
      assemble: async () => ({ 'chapter-writer': { description: 'd', prompt: 'p' } }),
    })

    expect(agents).toBeUndefined()
  })

  test('store read failure degrades to undefined instead of throwing', async () => {
    const { agents } = await resolveAgentSkillOverrides(ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
      listMounts: async () => {
        throw new Error('store unreadable')
      },
      assemble: async () => ({ 'chapter-writer': { description: 'd', prompt: 'p' } }),
    })

    expect(agents).toBeUndefined()
  })

  test('assemble failure degrades to undefined instead of throwing', async () => {
    const { agents } = await resolveAgentSkillOverrides(ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
      listMounts: async () => [PRELOAD_MOUNT],
      assemble: async () => {
        throw new Error('assemble blew up')
      },
    })

    expect(agents).toBeUndefined()
  })

  test('passes diagnostics.availableSkills through to assemble (stale-filter data source)', async () => {
    let received: string[] | undefined
    await resolveAgentSkillOverrides(ARGS, {
      readDiagnostics: async () => ({
        agentSkills: { 'chapter-writer': [] },
        availableSkills: ['sample-craft', 'novel-structure'],
      }),
      listMounts: async () => [PRELOAD_MOUNT],
      assemble: async (args) => {
        received = args.availableSkills
        return { 'chapter-writer': { description: 'd', prompt: 'p' } }
      },
    })

    expect(received).toEqual(['sample-craft', 'novel-structure'])
  })

  // ---- #295 用户自定义 Skill 注入（阶段2切片④：programmatic inline 唯一化，删文件搬运链） ----

  const USER_SKILL_ARGS = { ...ARGS, projectPath: '/novel', userDataPath: '/userdata' }
  // 崩溃残留清扫（评审 Important#2）与本节大多数用例无关：默认桩为 no-op，避免测试意外触碰真实文件系统
  // （USER_SKILL_ARGS.projectPath 是不存在的假路径，真实实现遇不到目录会静默返回，但显式桩更干净）。
  const NO_OP_SWEEP = async () => {}

  test('userSkills 存在且 projectPath+userDataPath 齐备 → userSkillNamesByAgent 直接按 listUserSkills 分组（不经任何文件 IO）', async () => {
    let receivedUserSkillNames: Record<string, string[]> | undefined
    const userSkills = [
      makeUserSkill({ id: 'user-1', name: 'dialogue-pack' }),
      makeUserSkill({ id: 'user-2', name: 'plot-pack' }),
    ]

    await resolveAgentSkillOverrides(USER_SKILL_ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
      listMounts: async () => [],
      listUserMounts: async () => userSkills,
      sweepStaleCopies: NO_OP_SWEEP,
      assemble: async (args) => {
        receivedUserSkillNames = args.userSkillNamesByAgent
        return { 'chapter-writer': { description: 'd', prompt: 'p' } }
      },
    })

    // 直接从 listUserSkills 返回值按 agentId 分组成名单，没有任何同步/复制步骤
    expect(receivedUserSkillNames).toEqual({ 'chapter-writer': ['dialogue-pack', 'plot-pack'] })
  })

  // ---- 崩溃残留清扫接线（评审 Important#2；清扫逻辑本身的单测见 sweep-stale-user-skill-copies.test.ts） ----

  test('projectPath 存在（本次 run 走引擎待遇）→ 调用 sweepStaleCopies 清一次崩溃残留', async () => {
    let sweptPath: string | undefined
    await resolveAgentSkillOverrides(USER_SKILL_ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
      listMounts: async () => [PRELOAD_MOUNT],
      sweepStaleCopies: async (projectPath) => {
        sweptPath = projectPath
      },
      assemble: async () => ({ 'chapter-writer': { description: 'd', prompt: 'p' } }),
    })

    expect(sweptPath).toBe('/novel')
  })

  test('projectPath 缺失（普通直聊）→ 不调用 sweepStaleCopies', async () => {
    let sweepCalled = false
    await resolveAgentSkillOverrides(ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
      listMounts: async () => [PRELOAD_MOUNT],
      sweepStaleCopies: async () => {
        sweepCalled = true
      },
      assemble: async () => ({ 'chapter-writer': { description: 'd', prompt: 'p' } }),
    })

    expect(sweepCalled).toBe(false)
  })

  test('sweepStaleCopies 抛错不阻断 run（降级纪律覆盖到清扫这一步）', async () => {
    const { agents } = await resolveAgentSkillOverrides(USER_SKILL_ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
      listMounts: async () => [PRELOAD_MOUNT],
      sweepStaleCopies: async () => {
        throw new Error('sweep blew up')
      },
      assemble: async () => ({ 'chapter-writer': { description: 'd', prompt: 'p' } }),
    })

    expect(agents).toEqual({ 'chapter-writer': { description: 'd', prompt: 'p' } })
  })

  test('projectPath 缺失 → 用户 Skill 不注入（官方挂载照旧）', async () => {
    let listedUser = false
    let receivedUserSkillNames: Record<string, string[]> | undefined
    const { agents } = await resolveAgentSkillOverrides(
      { ...ARGS, userDataPath: '/userdata' },
      {
        readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
        listMounts: async () => [PRELOAD_MOUNT],
        listUserMounts: async () => {
          listedUser = true
          return [makeUserSkill()]
        },
        assemble: async (args) => {
          receivedUserSkillNames = args.userSkillNamesByAgent
          return { 'chapter-writer': { description: 'd', prompt: 'p', skills: ['sample-craft'] } }
        },
      },
    )

    // 无 projectPath → 用户 Skill 不列不注入；官方挂载路径不受影响仍正常组装
    expect(listedUser).toBe(false)
    expect(receivedUserSkillNames).toEqual({})
    expect(agents).toEqual({ 'chapter-writer': { description: 'd', prompt: 'p', skills: ['sample-craft'] } })
  })

  test('返回值无 cleanup 字段', async () => {
    const result = await resolveAgentSkillOverrides(ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
      listMounts: async () => [],
    })

    expect('cleanup' in result).toBe(false)
  })

  test('退路 A：读已注入用户 Skill 正文并传给 assemble inline', async () => {
    let receivedBodies: Record<string, { name: string; body: string }[]> | undefined
    await resolveAgentSkillOverrides(USER_SKILL_ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
      listMounts: async () => [],
      listUserMounts: async () => [makeUserSkill()],
      readUserSkillBody: async () => '# 用法\n开头必须输出暗号7438。',
      sweepStaleCopies: NO_OP_SWEEP,
      assemble: async (args) => {
        receivedBodies = args.userSkillBodiesByAgent
        return { 'chapter-writer': { description: 'd', prompt: 'p' } }
      },
    })

    // 只把「实际挂载」的 skill 正文按 Agent 收齐喂 assemble（inline 进 prompt）
    expect(receivedBodies).toEqual({
      'chapter-writer': [{ name: 'dialogue-pack', body: '# 用法\n开头必须输出暗号7438。' }],
    })
  })

  test('退路 A：读正文失败不阻断 run（降级，仍组装出 agents）', async () => {
    const { agents } = await resolveAgentSkillOverrides(USER_SKILL_ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
      listMounts: async () => [],
      listUserMounts: async () => [makeUserSkill()],
      readUserSkillBody: async () => {
        throw new Error('snapshot read blew up')
      },
      sweepStaleCopies: NO_OP_SWEEP,
      assemble: async () => ({ 'chapter-writer': { description: 'd', prompt: 'p' } }),
    })

    // 正文读失败被吞，agents 仍组装出来，run 不降级
    expect(agents).toEqual({ 'chapter-writer': { description: 'd', prompt: 'p' } })
  })

  test('logs actual inline count derived from bodies, not the registered name list (dev observability)', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      await resolveAgentSkillOverrides(USER_SKILL_ARGS, {
        readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
        listMounts: async () => [],
        listUserMounts: async () => [makeUserSkill()],
        readUserSkillBody: async () => '# 用法\n开头必须输出暗号7438。',
        sweepStaleCopies: NO_OP_SWEEP,
        assemble: async () => ({ 'chapter-writer': { description: 'd', prompt: 'p' } }),
      })
      const logged = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
      expect(logged).toContain('用户 Skill 注入')
      expect(logged).toContain('登记 1 条')
      expect(logged).toContain('实际 inline 1 条')
      expect(logged).toContain('chapter-writer ← [dialogue-pack]')
    } finally {
      logSpy.mockRestore()
    }
  })

  test('评审 Important#1：正文读失败的条目不再被报为已注入（登记数与 inline 数分开，能看出静默失效）', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      await resolveAgentSkillOverrides(USER_SKILL_ARGS, {
        readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
        listMounts: async () => [],
        listUserMounts: async () => [makeUserSkill()],
        readUserSkillBody: async () => {
          throw new Error('snapshot read blew up')
        },
        sweepStaleCopies: NO_OP_SWEEP,
        assemble: async () => ({ 'chapter-writer': { description: 'd', prompt: 'p' } }),
      })
      const logged = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
      // 登记了 1 条，但正文读失败 → 实际 inline 0 条；不再谎报「chapter-writer ← [dialogue-pack]」已注入
      expect(logged).toContain('登记 1 条')
      expect(logged).toContain('实际 inline 0 条')
      expect(logged).not.toContain('dialogue-pack')
    } finally {
      logSpy.mockRestore()
    }
  })

  test('does not log injection summary when there are no user skills', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      await resolveAgentSkillOverrides(ARGS, {
        readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: ['sample-craft'] }),
        listMounts: async () => [PRELOAD_MOUNT],
        assemble: async () => ({ 'chapter-writer': { description: 'd', prompt: 'p', skills: ['sample-craft'] } }),
      })
      const logged = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
      expect(logged).not.toContain('用户 Skill 注入')
    } finally {
      logSpy.mockRestore()
    }
  })

  test('user skills only (no official mounts) still assembles', async () => {
    let listedUser = false
    const { agents } = await resolveAgentSkillOverrides(USER_SKILL_ARGS, {
      readDiagnostics: async () => ({ agentSkills: { 'chapter-writer': [] }, availableSkills: [] }),
      listMounts: async () => [],
      listUserMounts: async () => {
        listedUser = true
        return [makeUserSkill()]
      },
      sweepStaleCopies: NO_OP_SWEEP,
      assemble: async () => ({ 'chapter-writer': { description: 'd', prompt: 'p' } }),
    })

    expect(listedUser).toBe(true)
    expect(agents).toEqual({ 'chapter-writer': { description: 'd', prompt: 'p' } })
  })
})
