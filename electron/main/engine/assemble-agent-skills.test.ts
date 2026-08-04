import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assembleAgentSkills, renderOnDemandTriggerPrompt } from './assemble-agent-skills'
import type { AgentSkillMount } from '@shared/types/skill-mount'

async function makeAgentCore(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narracat-assemble-'))
  await mkdir(join(root, 'agents'), { recursive: true })

  await writeFile(
    join(root, 'agents', 'outline-architect.md'),
    [
      '---',
      'name: outline-architect',
      'description: Plans outlines.',
      'model: opus',
      'tools:',
      '  - Read',
      '  - Glob',
      'skills:',
      '  - novel-structure',
      '---',
      '',
      '你是大纲架构师。',
    ].join('\n'),
    'utf-8',
  )

  await writeFile(
    join(root, 'agents', 'chapter-writer.md'),
    ['---', 'name: chapter-writer', 'description: Writes chapters.', 'tools: Read, Write', '---', '', '你是章节写手。'].join('\n'),
    'utf-8',
  )

  // 正文引用 ${CLAUDE_PLUGIN_ROOT}/...（如 world-curator 引契约）；组装时须展开为真实 agentCorePath
  await writeFile(
    join(root, 'agents', 'world-curator.md'),
    [
      '---',
      'name: world-curator',
      'description: Curates world bible.',
      'tools: Read',
      '---',
      '',
      '你是世界观策展人。',
      '对照 `${CLAUDE_PLUGIN_ROOT}/docs/contracts/world-guided.md` 查缺。',
    ].join('\n'),
    'utf-8',
  )

  // 一个带触发点声明的按需型 Skill（#260 规范）
  await mkdir(join(root, 'skills', 'sample-craft'), { recursive: true })
  await writeFile(
    join(root, 'skills', 'sample-craft', 'SKILL.md'),
    ['---', 'name: sample-craft', 'mount-mode: on-demand', 'triggers:', '  - 进行深度风格审读', '---', '', '正文。'].join('\n'),
    'utf-8',
  )

  return root
}

const DEFAULTS = {
  'outline-architect': ['novel-structure'],
  'chapter-writer': [] as string[],
  'world-curator': [] as string[],
}

// Agent Core 当前实际存在的 skill 全集（对应 diagnostics.availableSkills）；
// 未列入者视为已删除/改名的 stale，应被 assemble 过滤、不进 SDK definition.skills。
const AVAILABLE = ['novel-structure', 'sample-craft']

describe('assembleAgentSkills', () => {
  test('no user overlay yields no agents override (plugin defaults stand)', async () => {
    const agentCorePath = await makeAgentCore()
    const agents = await assembleAgentSkills({
      agentCorePath,
      defaultSkillsByAgent: DEFAULTS,
      availableSkills: AVAILABLE,
      userMounts: [],
    })
    expect(agents).toEqual({})
  })

  test('preload mount injects the skill into the SDK Agent skills field as a full definition', async () => {
    const agentCorePath = await makeAgentCore()
    const userMounts: AgentSkillMount[] = [
      { agentId: 'chapter-writer', skillId: 'sample-craft', mode: 'preload', state: 'mounted' },
    ]

    const agents = await assembleAgentSkills({ agentCorePath, defaultSkillsByAgent: DEFAULTS, availableSkills: AVAILABLE, userMounts })

    expect(Object.keys(agents)).toEqual(['chapter-writer'])
    const writer = agents['chapter-writer']
    expect(writer.skills).toEqual(['sample-craft'])
    // 全量组装：description + prompt + tools 与文件一致
    expect(writer.description).toBe('Writes chapters.')
    expect(writer.prompt).toBe('你是章节写手。')
    expect(writer.tools).toEqual(['Read', 'Write'])
  })

  test('退路 A：用户 Skill 正文 inline 进 agent prompt，且名字不再进 skills 字段', async () => {
    const agentCorePath = await makeAgentCore()

    const agents = await assembleAgentSkills({
      agentCorePath,
      defaultSkillsByAgent: DEFAULTS,
      availableSkills: AVAILABLE,
      userMounts: [],
      userSkillNamesByAgent: { 'chapter-writer': ['web-novel-writer'] },
      userSkillBodiesByAgent: {
        'chapter-writer': [{ name: 'web-novel-writer', body: '# 写作规范\n正文开头必须输出暗号7438。' }],
      },
    })

    const writer = agents['chapter-writer']
    // 阶段2切片④：用户 Skill 名不再登记进 SDK definition.skills（没有 .claude/skills/ 文件背书）
    expect(writer.skills).toBeUndefined()
    // 退路 A：原 agent 正文 + 已挂载技能段 + skill 名 + 正文内容，全在 prompt 里（唯一生效通道）
    expect(writer.prompt).toContain('你是章节写手。')
    expect(writer.prompt).toContain('## 已挂载技能')
    expect(writer.prompt).toContain('### web-novel-writer')
    expect(writer.prompt).toContain('正文开头必须输出暗号7438。')
  })

  test('退路 A：空正文无实质变化，不产生覆盖（不留悬空段标题）', async () => {
    const agentCorePath = await makeAgentCore()

    const agents = await assembleAgentSkills({
      agentCorePath,
      defaultSkillsByAgent: DEFAULTS,
      availableSkills: AVAILABLE,
      userMounts: [],
      userSkillNamesByAgent: { 'chapter-writer': ['empty-pack'] },
      userSkillBodiesByAgent: { 'chapter-writer': [{ name: 'empty-pack', body: '   ' }] },
    })

    // 空正文不 inline、名字不进 skills → 该 Agent 无任何实质变化，不产出覆盖
    expect(agents['chapter-writer']).toBeUndefined()
  })

  test('agent matching its default is not overridden', async () => {
    const agentCorePath = await makeAgentCore()
    const userMounts: AgentSkillMount[] = [
      { agentId: 'chapter-writer', skillId: 'sample-craft', mode: 'preload', state: 'mounted' },
    ]

    const agents = await assembleAgentSkills({ agentCorePath, defaultSkillsByAgent: DEFAULTS, availableSkills: AVAILABLE, userMounts })
    // outline-architect default (novel-structure) unchanged → not in override set
    expect(agents['outline-architect']).toBeUndefined()
  })

  test('parses array tools and single-line model, preserving them on the definition', async () => {
    const agentCorePath = await makeAgentCore()
    const userMounts: AgentSkillMount[] = [
      { agentId: 'outline-architect', skillId: 'sample-craft', mode: 'preload', state: 'mounted' },
    ]

    const agents = await assembleAgentSkills({ agentCorePath, defaultSkillsByAgent: DEFAULTS, availableSkills: AVAILABLE, userMounts })
    const architect = agents['outline-architect']
    expect(architect.model).toBe('opus')
    expect(architect.tools).toEqual(['Read', 'Glob'])
    expect(architect.skills).toEqual(['novel-structure', 'sample-craft'])
  })

  test('on-demand mount keeps Skill tool, injects trigger prompt, and does NOT enter skills field', async () => {
    const agentCorePath = await makeAgentCore()
    const userMounts: AgentSkillMount[] = [
      { agentId: 'chapter-writer', skillId: 'sample-craft', mode: 'on-demand', state: 'mounted' },
    ]

    const agents = await assembleAgentSkills({ agentCorePath, defaultSkillsByAgent: DEFAULTS, availableSkills: AVAILABLE, userMounts })
    const writer = agents['chapter-writer']

    // 不 eager 注入 SKILL.md → 不进 skills 字段
    expect(writer.skills).toBeUndefined()
    // 保留 Skill 工具（原 tools 是 Read, Write 的 allowlist，组装时补 Skill）
    expect(writer.tools).toContain('Skill')
    expect(writer.tools).toContain('Read')
    // 触发点双写之消费方侧：从 SKILL.md frontmatter triggers 渲染进 prompt
    expect(writer.prompt).toContain('按需技能触发点')
    expect(writer.prompt).toContain('进行深度风格审读')
    expect(writer.prompt).toContain('sample-craft')
  })

  test('expands ${CLAUDE_PLUGIN_ROOT} in the assembled prompt to the real agentCorePath', async () => {
    const agentCorePath = await makeAgentCore()
    const userMounts: AgentSkillMount[] = [
      { agentId: 'world-curator', skillId: 'sample-craft', mode: 'preload', state: 'mounted' },
    ]

    const agents = await assembleAgentSkills({ agentCorePath, defaultSkillsByAgent: DEFAULTS, availableSkills: AVAILABLE, userMounts })
    const curator = agents['world-curator']

    // 组装出的 prompt 里 ${CLAUDE_PLUGIN_ROOT} 必须已展开为真实路径，否则子 Agent Read 到坏路径
    expect(curator.prompt).toContain(`${agentCorePath}/docs/contracts/world-guided.md`)
    expect(curator.prompt).not.toContain('${CLAUDE_PLUGIN_ROOT}')
  })

  test('mixing preload and on-demand routes each by mode', async () => {
    const agentCorePath = await makeAgentCore()
    const userMounts: AgentSkillMount[] = [
      { agentId: 'chapter-writer', skillId: 'novel-structure', mode: 'preload', state: 'mounted' },
      { agentId: 'chapter-writer', skillId: 'sample-craft', mode: 'on-demand', state: 'mounted' },
    ]

    const agents = await assembleAgentSkills({ agentCorePath, defaultSkillsByAgent: DEFAULTS, availableSkills: AVAILABLE, userMounts })
    const writer = agents['chapter-writer']

    expect(writer.skills).toEqual(['novel-structure'])
    expect(writer.prompt).toContain('sample-craft')
    expect(writer.prompt).not.toContain('novel-structure时')
  })

  test('stale skillId not in availableSkills is filtered out of the SDK skills field', async () => {
    const agentCorePath = await makeAgentCore()
    const userMounts: AgentSkillMount[] = [
      { agentId: 'chapter-writer', skillId: 'sample-craft', mode: 'preload', state: 'mounted' },
      { agentId: 'chapter-writer', skillId: 'deleted-skill', mode: 'preload', state: 'mounted' },
    ]

    const agents = await assembleAgentSkills({ agentCorePath, defaultSkillsByAgent: DEFAULTS, availableSkills: AVAILABLE, userMounts })
    const writer = agents['chapter-writer']

    // deleted-skill 不在 availableSkills → 被过滤；只剩有效的 sample-craft 进 skills 字段
    expect(writer.skills).toEqual(['sample-craft'])
  })

  test('a mount whose skill no longer exists yields no override (degrades to default)', async () => {
    const agentCorePath = await makeAgentCore()
    const userMounts: AgentSkillMount[] = [
      { agentId: 'chapter-writer', skillId: 'ghost-skill', mode: 'preload', state: 'mounted' },
    ]

    const agents = await assembleAgentSkills({ agentCorePath, defaultSkillsByAgent: DEFAULTS, availableSkills: AVAILABLE, userMounts })

    // ghost-skill 被过滤 → chapter-writer 有效集 = 默认（空）→ 不进 agents 覆盖
    expect(agents['chapter-writer']).toBeUndefined()
  })

  test('stale on-demand mount is filtered: yields no override', async () => {
    const agentCorePath = await makeAgentCore()
    const userMounts: AgentSkillMount[] = [
      { agentId: 'chapter-writer', skillId: 'ghost-skill', mode: 'on-demand', state: 'mounted' },
    ]

    const agents = await assembleAgentSkills({ agentCorePath, defaultSkillsByAgent: DEFAULTS, availableSkills: AVAILABLE, userMounts })

    // 按需挂载的 stale skill 同样被过滤 → 无有效挂载差异 → 不覆盖
    expect(agents['chapter-writer']).toBeUndefined()
  })

  // ---- 用户自定义 Skill 正文 inline（阶段2切片④：名字不再进 skills 字段，退役文件搬运链） ----

  test('user skill body inline on an agent with no official default produces an override (skills field absent)', async () => {
    const agentCorePath = await makeAgentCore()
    const agents = await assembleAgentSkills({
      agentCorePath,
      defaultSkillsByAgent: DEFAULTS,
      availableSkills: AVAILABLE,
      userMounts: [],
      userSkillNamesByAgent: { 'chapter-writer': ['dialogue-pack'] },
      userSkillBodiesByAgent: { 'chapter-writer': [{ name: 'dialogue-pack', body: '对话范例正文。' }] },
    })

    // chapter-writer 官方默认空，仅靠用户 Skill 正文也要产出覆盖；skills 字段不含用户名（不再登记）
    const writer = agents['chapter-writer']
    expect(writer.skills).toBeUndefined()
    expect(writer.prompt).toContain('对话范例正文。')
    expect(writer.description).toBe('Writes chapters.')
  })

  test('user skill body inline coexists with the official locked default skill field (name not merged in)', async () => {
    const agentCorePath = await makeAgentCore()
    const agents = await assembleAgentSkills({
      agentCorePath,
      defaultSkillsByAgent: DEFAULTS,
      availableSkills: AVAILABLE,
      userMounts: [],
      userSkillNamesByAgent: { 'outline-architect': ['plot-pack'] },
      userSkillBodiesByAgent: { 'outline-architect': [{ name: 'plot-pack', body: '情节范例正文。' }] },
    })

    // outline-architect 默认锁定 novel-structure：skills 字段只保留官方默认，用户名不进
    const architect = agents['outline-architect']
    expect(architect.skills).toEqual(['novel-structure'])
    expect(architect.prompt).toContain('情节范例正文。')
  })

  test('user skill inline body is not subject to the stale availableSkills filter (different name space)', async () => {
    const agentCorePath = await makeAgentCore()
    const agents = await assembleAgentSkills({
      agentCorePath,
      defaultSkillsByAgent: DEFAULTS,
      // 用户 Skill 名故意不在 availableSkills 里（它来自 user-skills.json，非 Agent Core skills/）
      availableSkills: AVAILABLE,
      userMounts: [],
      userSkillNamesByAgent: { 'chapter-writer': ['user-only-pack'] },
      userSkillBodiesByAgent: { 'chapter-writer': [{ name: 'user-only-pack', body: '专属范例正文。' }] },
    })

    const writer = agents['chapter-writer']
    expect(writer.prompt).toContain('专属范例正文。')
    expect(writer.skills).toBeUndefined()
  })

  test('user skill inline + official preload mount + on-demand all compose on one agent', async () => {
    const agentCorePath = await makeAgentCore()
    const userMounts: AgentSkillMount[] = [
      { agentId: 'chapter-writer', skillId: 'novel-structure', mode: 'preload', state: 'mounted' },
      { agentId: 'chapter-writer', skillId: 'sample-craft', mode: 'on-demand', state: 'mounted' },
    ]

    const agents = await assembleAgentSkills({
      agentCorePath,
      defaultSkillsByAgent: DEFAULTS,
      availableSkills: AVAILABLE,
      userMounts,
      userSkillNamesByAgent: { 'chapter-writer': ['dialogue-pack'] },
      userSkillBodiesByAgent: { 'chapter-writer': [{ name: 'dialogue-pack', body: '对话范例正文。' }] },
    })

    const writer = agents['chapter-writer']
    // preload 官方 novel-structure 进 skills；用户 Skill 只走 prompt inline，不进 skills；on-demand sample-craft 仅进 prompt
    expect(writer.skills).toEqual(['novel-structure'])
    expect(writer.prompt).toContain('sample-craft')
    expect(writer.prompt).toContain('对话范例正文。')
  })

  test('user skill body sharing a name with an official preload skill does not affect the skills field', async () => {
    const agentCorePath = await makeAgentCore()
    const agents = await assembleAgentSkills({
      agentCorePath,
      defaultSkillsByAgent: DEFAULTS,
      availableSkills: AVAILABLE,
      userMounts: [],
      // 与官方默认同名（边角，撞名本应被挂载侧拒绝；组装侧不再对 skills 字段去重——名字本就不进该字段）
      userSkillNamesByAgent: { 'outline-architect': ['novel-structure'] },
      userSkillBodiesByAgent: { 'outline-architect': [{ name: 'novel-structure', body: '用户版结构说明。' }] },
    })

    // skills 字段仍只有官方默认，不因同名用户 Skill 产生重复或覆盖
    expect(agents['outline-architect'].skills).toEqual(['novel-structure'])
    expect(agents['outline-architect'].prompt).toContain('用户版结构说明。')
  })

  test('empty userSkillNamesByAgent leaves pure-default agents un-overridden', async () => {
    const agentCorePath = await makeAgentCore()
    const agents = await assembleAgentSkills({
      agentCorePath,
      defaultSkillsByAgent: DEFAULTS,
      availableSkills: AVAILABLE,
      userMounts: [],
      userSkillNamesByAgent: {},
    })

    expect(agents).toEqual({})
  })
})

describe('renderOnDemandTriggerPrompt', () => {
  test('empty map renders nothing', () => {
    expect(renderOnDemandTriggerPrompt({})).toBe('')
  })

  test('renders declared triggers per skill', () => {
    const prompt = renderOnDemandTriggerPrompt({ 'sample-craft': ['进行深度风格审读'] })
    expect(prompt).toContain('sample-craft')
    expect(prompt).toContain('进行深度风格审读')
    expect(prompt).toContain('按需技能触发点')
  })

  test('falls back to a generic line when a skill has no declared triggers', () => {
    const prompt = renderOnDemandTriggerPrompt({ mystery: [] })
    expect(prompt).toContain('mystery')
    expect(prompt).toContain('相关的场景')
  })
})
