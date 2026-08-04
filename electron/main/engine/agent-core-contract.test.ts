import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { NARRACAT_AGENT_CORE_VERSION_LOCK, readNarraCatAgentCoreDiagnostics } from './agent-core-contract'

const REQUIRED_COMMANDS = ['init', 'setup', 'world', 'plan', 'reference', 'write', 'review', 'rewrite', 'revise-premise', 'status', 'sync-chapter-memory']
const REQUIRED_AGENTS = ['outline-architect', 'chapter-writer', 'continuity-editor', 'world-curator', 'memory-keeper']
const REQUIRED_SKILLS = [
  'novel-memory-integration',
  'novel-reference-analysis-method',
  'novel-structure',
  'novel-style-reference',
  'novel-web-craft',
]
const REQUIRED_SCHEMAS = [
  'writing-context-pack',
  'review-report',
  'memory-extraction',
  'outline-structure',
  'cascade-impact-report',
  'foreshadowing-system',
]
const REQUIRED_TEMPLATES = [
  'character-template',
  'premise-template',
  'relationships-template',
  'world-setting-template',
]

async function makeAgentCoreRoot(name: string): Promise<string> {
  const root = join(tmpdir(), `narracat-agent-core-${name}-${Date.now()}`)
  await mkdir(join(root, 'commands'), { recursive: true })
  await mkdir(join(root, 'agents'), { recursive: true })
  await mkdir(join(root, 'skills'), { recursive: true })
  await mkdir(join(root, 'schemas'), { recursive: true })
  await mkdir(join(root, 'templates'), { recursive: true })
  await mkdir(join(root, 'mcp-server', 'dist'), { recursive: true })
  return root
}

/** 写引擎自有清单 narracat.manifest.json（可覆写各类清单以模拟缺项/多余项场景） */
async function writeManifest(
  root: string,
  overrides: Partial<{
    name: string
    version: string
    commands: string[]
    agents: string[]
    skills: string[]
    schemas: string[]
    templates: string[]
  }> = {},
): Promise<void> {
  await writeFile(
    join(root, 'narracat.manifest.json'),
    JSON.stringify({
      name: 'narracat',
      version: NARRACAT_AGENT_CORE_VERSION_LOCK.version,
      commands: REQUIRED_COMMANDS,
      agents: REQUIRED_AGENTS,
      skills: REQUIRED_SKILLS,
      schemas: REQUIRED_SCHEMAS,
      templates: REQUIRED_TEMPLATES,
      ...overrides,
    }),
    'utf-8',
  )
}

async function writeRequiredAgentCoreFiles(root: string): Promise<void> {
  await writeManifest(root)

  for (const command of REQUIRED_COMMANDS) {
    await writeFile(join(root, 'commands', `${command}.md`), `---\ndescription: ${command}\n---\n`, 'utf-8')
  }

  for (const agent of REQUIRED_AGENTS) {
    const skillsBlock = agent === 'outline-architect' ? 'skills:\n  - novel-structure\n' : ''
    await writeFile(join(root, 'agents', `${agent}.md`), `---\nname: ${agent}\n${skillsBlock}---\n`, 'utf-8')
  }

  for (const skill of REQUIRED_SKILLS) {
    await mkdir(join(root, 'skills', skill), { recursive: true })
    await writeFile(join(root, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\n---\n`, 'utf-8')
  }

  for (const schema of REQUIRED_SCHEMAS) {
    await writeFile(join(root, 'schemas', `${schema}.json`), '{"title":"schema"}\n', 'utf-8')
  }

  for (const template of REQUIRED_TEMPLATES) {
    await writeFile(join(root, 'templates', `${template}.md`), `# ${template}\n`, 'utf-8')
  }

  await writeFile(join(root, 'mcp-server', 'dist', 'index.js'), 'console.log("mcp")\n', 'utf-8')
}

describe('readNarraCatAgentCoreDiagnostics', () => {
  test('returns ready diagnostics for a complete NarraCat Agent Core at the locked version', async () => {
    const root = await makeAgentCoreRoot('ready')
    await writeRequiredAgentCoreFiles(root)

    const diagnostics = await readNarraCatAgentCoreDiagnostics(root)

    expect(diagnostics.status).toBe('ready')
    expect(diagnostics.agentCorePath).toBe(root)
    expect(diagnostics.name).toBe('narracat')
    expect(diagnostics.version).toBe(NARRACAT_AGENT_CORE_VERSION_LOCK.version)
    expect(diagnostics.expectedVersion).toBe(NARRACAT_AGENT_CORE_VERSION_LOCK.version)
    expect(diagnostics.versionLock.path).toBe('agent-core/narracat-agent-core.lock.json')
    expect(diagnostics.versionLock.checkCommand).toContain('verify:narracat-agent-core')
    expect(diagnostics.checks.some((check) => check.id === 'command-reference')).toBe(true)
    expect(diagnostics.checks.some((check) => check.id === 'skill-novel-memory-integration')).toBe(true)
    expect(diagnostics.checks.some((check) => check.id === 'skill-novel-reference-analysis-method')).toBe(true)
    expect(diagnostics.checks.some((check) => check.id === 'schema-foreshadowing-system')).toBe(true)
    expect(diagnostics.checks.some((check) => check.id === 'template-world-setting-template')).toBe(true)
    expect(diagnostics.checks.some((check) => check.id === 'skill-novel-memory')).toBe(false)
    expect(diagnostics.checks.some((check) => check.id === 'skill-novel-style')).toBe(false)
    expect(diagnostics.checks.some((check) => check.id === 'template-style-guide-template')).toBe(false)
    // adapter 工件（plugin.json）段已随 claude-sdk 退役（拆旧刀5）：checks 不再含 adapter-* / manifest-schema 条目
    expect(diagnostics.checks.some((check) => check.id.startsWith('adapter-'))).toBe(false)
    expect(diagnostics.checks.some((check) => check.id === 'manifest-schema')).toBe(false)
    expect(diagnostics.errors).toEqual([])
    expect(diagnostics.checks.every((check) => check.ok)).toBe(true)
    expect(diagnostics.agentSkills['outline-architect']).toEqual(['novel-structure'])
    expect(diagnostics.agentSkills['chapter-writer']).toEqual([])
    // 本期无官方可挂载（c）类数据：每个内置 Agent 都有键，可挂载集一律为空。
    expect(Object.keys(diagnostics.mountableSkillsByAgent).sort()).toEqual([
      'chapter-writer',
      'continuity-editor',
      'memory-keeper',
      'outline-architect',
      'world-curator',
    ])
    for (const agentId of Object.keys(diagnostics.mountableSkillsByAgent)) {
      expect(diagnostics.mountableSkillsByAgent[agentId]).toEqual([])
    }
    expect(diagnostics.availableSkills).toContain('novel-structure')
    expect(diagnostics.availableSkills).toContain('novel-memory-integration')
    expect(typeof diagnostics.skillTokenEstimates['novel-structure']).toBe('number')
    expect(diagnostics.skillTokenEstimates['novel-structure']).toBeGreaterThan(0)
    // 这些 fixture skill 未声明 triggers（非按需型）→ skillTriggers 不含它们
    expect(diagnostics.skillTriggers['novel-structure']).toBeUndefined()
  })

  test('binds mountable skills to the agents named in SKILL.md mount-agents, ignoring unknown agents', async () => {
    const root = await makeAgentCoreRoot('mount-agents')
    await writeRequiredAgentCoreFiles(root)
    // novel-style-reference 声明适配 chapter-writer + 一个不存在的 Agent → 只进 chapter-writer
    await writeFile(
      join(root, 'skills', 'novel-style-reference', 'SKILL.md'),
      '---\nname: novel-style-reference\nmount-agents:\n  - chapter-writer\n  - ghost-agent\n---\n',
      'utf-8',
    )

    const diagnostics = await readNarraCatAgentCoreDiagnostics(root)

    expect(diagnostics.mountableSkillsByAgent['chapter-writer']).toEqual(['novel-style-reference'])
    // 其余已知 Agent 的可挂载集仍为空
    expect(diagnostics.mountableSkillsByAgent['outline-architect']).toEqual([])
    expect(diagnostics.mountableSkillsByAgent['world-curator']).toEqual([])
    // 不存在的 Agent 不会被引入为新键
    expect(diagnostics.mountableSkillsByAgent['ghost-agent']).toBeUndefined()
  })

  test('returns invalid diagnostics when the self-owned manifest (narracat.manifest.json) is missing', async () => {
    const root = await makeAgentCoreRoot('missing-manifest')
    await writeRequiredAgentCoreFiles(root)
    await rm(join(root, 'narracat.manifest.json'))

    const diagnostics = await readNarraCatAgentCoreDiagnostics(root)

    expect(diagnostics.status).toBe('invalid')
    expect(diagnostics.errors.some((error) => error.includes('narracat.manifest.json'))).toBe(true)
    const manifestCheck = diagnostics.checks.find((check) => check.id === 'manifest')
    expect(manifestCheck?.ok).toBe(false)
  })

  test('reports a missing required manifest entry (commands missing write) as a dedicated error', async () => {
    const root = await makeAgentCoreRoot('manifest-missing-required-entry')
    await writeRequiredAgentCoreFiles(root)
    await writeManifest(root, { commands: REQUIRED_COMMANDS.filter((command) => command !== 'write') })

    const diagnostics = await readNarraCatAgentCoreDiagnostics(root)

    expect(diagnostics.status).toBe('invalid')
    expect(diagnostics.errors).toContain('manifest 未声明必需 command: write')
    // 未声明的必需项不再做文件探测（floor 缺席本身即失败），checks 里不应出现 command-write
    expect(diagnostics.checks.some((check) => check.id === 'command-write')).toBe(false)
  })

  test('marks a manifest-declared entry as failing when its backing file does not exist', async () => {
    const root = await makeAgentCoreRoot('manifest-declared-file-missing')
    await writeRequiredAgentCoreFiles(root)
    // manifest 声明了一个多余的 command，但没有对应的 commands/*.md 文件
    await writeManifest(root, { commands: [...REQUIRED_COMMANDS, 'ghost-command'] })

    const diagnostics = await readNarraCatAgentCoreDiagnostics(root)

    expect(diagnostics.status).toBe('invalid')
    const ghostCheck = diagnostics.checks.find((check) => check.id === 'command-ghost-command')
    expect(ghostCheck?.ok).toBe(false)
    expect(diagnostics.errors.some((error) => error.includes('ghost-command'))).toBe(true)
    // 其余必需 command 的探测不受影响
    expect(diagnostics.checks.some((check) => check.id === 'command-write' && check.ok)).toBe(true)
  })

  test('reports a self-manifest version mismatch against the version lock without hiding other checks', async () => {
    const root = await makeAgentCoreRoot('manifest-version-mismatch')
    await writeRequiredAgentCoreFiles(root)
    await writeManifest(root, { version: '3.0.0' })

    const diagnostics = await readNarraCatAgentCoreDiagnostics(root)

    expect(diagnostics.status).toBe('invalid')
    expect(diagnostics.version).toBe('3.0.0')
    expect(diagnostics.errors.some((error) => error.includes(NARRACAT_AGENT_CORE_VERSION_LOCK.version))).toBe(true)
    // 版本不一致不应隐藏其余 check：commands/agents/skills 该有的探测仍然全在
    expect(diagnostics.checks.length).toBeGreaterThan(10)
    expect(diagnostics.checks.some((check) => check.id === 'command-write' && check.ok)).toBe(true)
  })

  test('rejects a required contract path when it is a directory instead of a file', async () => {
    const root = await makeAgentCoreRoot('directory-contract-path')
    await writeRequiredAgentCoreFiles(root)
    const commandPath = join(root, 'commands', 'init.md')
    await rm(commandPath)
    await mkdir(commandPath)

    const diagnostics = await readNarraCatAgentCoreDiagnostics(root)
    const initCheck = diagnostics.checks.find((check) => check.id === 'command-init')

    expect(diagnostics.status).toBe('invalid')
    expect(initCheck?.ok).toBe(false)
    expect(diagnostics.errors.some((error) => error.includes(commandPath) || error.includes('regular file'))).toBe(true)
  })

  test('reports missing MCP server runtime dependencies when the embedded package needs install', async () => {
    const root = await makeAgentCoreRoot('missing-mcp-runtime')
    await writeRequiredAgentCoreFiles(root)
    await writeFile(
      join(root, 'mcp-server', 'package.json'),
      JSON.stringify({ name: '@narracat/mcp-server', dependencies: { 'better-sqlite3': '^12.6.2' } }),
      'utf-8',
    )

    const diagnostics = await readNarraCatAgentCoreDiagnostics(root)
    const dependencyCheck = diagnostics.checks.find((check) => check.id === 'mcp-runtime-better-sqlite3')

    expect(diagnostics.status).toBe('invalid')
    expect(dependencyCheck?.ok).toBe(false)
    expect(diagnostics.errors.some((error) => error.includes('NovelMemory MCP server 运行依赖'))).toBe(true)
  })
})
