import { readFile, stat } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { join } from 'node:path'
import { estimateSkillTokens } from '@shared/lib/skill-budget'
import versionLock from '../../../agent-core/narracat-agent-core.lock.json'
import type {
  NarraCatAgentCoreDiagnostics,
  NarraCatAgentCoreVersionLock,
  NarraCatContractCheck,
} from '@shared/types/narracat'

// 契约校验（阶段2切片④确立，拆旧刀5 收口）：`narracat.manifest.json` = NarraCat 自有契约 SSOT，
// 是本文件的唯一校验对象（name/version + 五类全量清单）。plugin.json 工件已随 claude-sdk 退役（4.0.159）。

export const NARRACAT_AGENT_CORE_VERSION_LOCK = versionLock as NarraCatAgentCoreVersionLock
const EXPECTED_VERSION = NARRACAT_AGENT_CORE_VERSION_LOCK.version

/** 引擎内置 subagent id 单一来源（App 层 `Task(narracat:x)` 名单等消费方从这里 import，不再各自硬编码） */
export const NARRACAT_ENGINE_AGENT_IDS = [
  'outline-architect',
  'chapter-writer',
  'continuity-editor',
  'world-curator',
  'memory-keeper',
] as const

const REQUIRED_COMMANDS = ['init', 'setup', 'world', 'plan', 'reference', 'write', 'review', 'rewrite', 'revise-premise', 'status', 'sync-chapter-memory']
const REQUIRED_AGENTS = [...NARRACAT_ENGINE_AGENT_IDS]
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
const REQUIRED_MCP_RUNTIME_PACKAGES = [
  join('@modelcontextprotocol', 'sdk'),
  'better-sqlite3',
  'sqlite-vec',
  join('@huggingface', 'transformers'),
]

/** narracat.manifest.json：自有契约清单 */
interface Manifest {
  name?: string
  version?: string
  commands?: unknown
  agents?: unknown
  skills?: unknown
  schemas?: unknown
  templates?: unknown
}

async function isFile(path: string): Promise<boolean> {
  try {
    const fileStat = await stat(path)
    return fileStat.isFile()
  } catch {
    return false
  }
}

function check(id: string, label: string, ok: boolean, detail?: string): NarraCatContractCheck {
  return detail ? { id, label, ok, detail } : { id, label, ok }
}

function extractFrontmatter(content: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  return match ? match[1] : null
}

/** 读 SKILL.md 的护栏元数据：token 体量（预加载护栏）+ frontmatter triggers（按需触发点双写来源）+ mount-agents（适配 Agent 绑定）；读失败时降级 */
async function readSkillMeta(path: string): Promise<{ tokens: number; triggers: string[]; mountAgents: string[] }> {
  try {
    const content = await readFile(path, 'utf-8')
    const tokens = estimateSkillTokens(content)
    const frontmatter = extractFrontmatter(content)
    let triggers: string[] = []
    let mountAgents: string[] = []
    if (frontmatter) {
      const parsed = parseYaml(frontmatter) as Record<string, unknown> | null
      const raw = parsed?.triggers
      if (Array.isArray(raw)) triggers = raw.filter((item): item is string => typeof item === 'string')
      // mount-agents: [agent-id, ...] 声明该 Skill 适配挂载的 Agent；只在这些 Agent 的挂载入口出现。
      // 缺省/非数组 = 不绑定任何 Agent（内部 Skill），不进任何 Agent 的可挂载集。
      const rawMountAgents = parsed?.['mount-agents']
      if (Array.isArray(rawMountAgents)) {
        mountAgents = rawMountAgents.filter((item): item is string => typeof item === 'string')
      }
    }
    return { tokens, triggers, mountAgents }
  } catch {
    return { tokens: 0, triggers: [], mountAgents: [] }
  }
}

/** 读 agent 文件 frontmatter 的 skills 列表（SSOT）；缺失或非法时返回空数组 */
async function readAgentSkills(path: string): Promise<string[]> {
  try {
    const frontmatter = extractFrontmatter(await readFile(path, 'utf-8'))
    if (!frontmatter) return []
    const parsed = parseYaml(frontmatter) as Record<string, unknown> | null
    const skills = parsed?.skills
    return Array.isArray(skills) ? skills.filter((skill): skill is string => typeof skill === 'string') : []
  } catch {
    return []
  }
}

async function readManifest(agentCorePath: string): Promise<{ manifest?: Manifest; error?: string }> {
  const manifestPath = join(agentCorePath, 'narracat.manifest.json')
  try {
    const raw = await readFile(manifestPath, 'utf-8')
    const parsed = JSON.parse(raw) as Manifest
    return { manifest: parsed }
  } catch (error) {
    return { error: `缺少或无法读取 NarraCat Agent Core 自有清单: ${manifestPath} (${(error as Error).message})` }
  }
}


/** 清单归一：raw 是全 string 数组则采用（declared=true），否则退回 App 底线清单（declared=false，manifest 未声明或格式非法） */
function manifestList(raw: unknown, fallback: string[]): { list: string[]; declared: boolean } {
  if (Array.isArray(raw) && raw.every((item): item is string => typeof item === 'string')) {
    return { list: raw, declared: true }
  }
  return { list: fallback, declared: false }
}

export async function readNarraCatAgentCoreDiagnostics(agentCorePath: string): Promise<NarraCatAgentCoreDiagnostics> {
  const checks: NarraCatContractCheck[] = []
  const errors: string[] = []

  // ── 主校验：narracat.manifest.json（自有契约 SSOT）───────────────────────
  const { manifest, error } = await readManifest(agentCorePath)

  checks.push(check('manifest', 'NarraCat Agent Core 自有清单', Boolean(manifest), join(agentCorePath, 'narracat.manifest.json')))
  if (error) errors.push(error)

  if (manifest?.name !== 'narracat') {
    checks.push(check('manifest-name', 'Manifest name is narracat', false, manifest?.name ?? 'missing'))
    errors.push(`narracat.manifest.json name 应为 narracat，实际为 ${manifest?.name ?? 'missing'}。`)
  } else {
    checks.push(check('manifest-name', 'Manifest name is narracat', true, manifest.name))
  }

  if (manifest?.version !== EXPECTED_VERSION) {
    checks.push(check('agent-core-version', `Agent Core version is ${EXPECTED_VERSION}`, false, manifest?.version ?? 'missing'))
    errors.push(`NarraCat Agent Core version 应为 ${EXPECTED_VERSION}，实际为 ${manifest?.version ?? 'missing'}。`)
  } else {
    checks.push(check('agent-core-version', `Agent Core version is ${EXPECTED_VERSION}`, true, manifest.version))
  }

  const { list: commandList, declared: commandsDeclared } = manifestList(manifest?.commands, REQUIRED_COMMANDS)
  if (!commandsDeclared) errors.push('narracat.manifest.json 未声明 commands 清单（或格式非法）')
  for (const command of REQUIRED_COMMANDS) {
    if (!commandList.includes(command)) errors.push(`manifest 未声明必需 command: ${command}`)
  }
  for (const command of commandList) {
    const path = join(agentCorePath, 'commands', `${command}.md`)
    const ok = await isFile(path)
    checks.push(check(`command-${command}`, `Command /narracat:${command}`, ok, path))
    if (!ok) errors.push(`缺少 command 文件或不是 regular file: ${path}`)
  }

  const { list: agentList, declared: agentsDeclared } = manifestList(manifest?.agents, REQUIRED_AGENTS)
  if (!agentsDeclared) errors.push('narracat.manifest.json 未声明 agents 清单（或格式非法）')
  for (const agent of REQUIRED_AGENTS) {
    if (!agentList.includes(agent)) errors.push(`manifest 未声明必需 agent: ${agent}`)
  }

  const agentSkills: Record<string, string[]> = {}
  for (const agent of agentList) {
    const path = join(agentCorePath, 'agents', `${agent}.md`)
    const ok = await isFile(path)
    checks.push(check(`agent-${agent}`, `Agent ${agent}`, ok, path))
    if (!ok) errors.push(`缺少 agent 文件或不是 regular file: ${path}`)
    agentSkills[agent] = ok ? await readAgentSkills(path) : []
  }

  const { list: skillList, declared: skillsDeclared } = manifestList(manifest?.skills, REQUIRED_SKILLS)
  if (!skillsDeclared) errors.push('narracat.manifest.json 未声明 skills 清单（或格式非法）')
  for (const skill of REQUIRED_SKILLS) {
    if (!skillList.includes(skill)) errors.push(`manifest 未声明必需 skill: ${skill}`)
  }

  const availableSkills: string[] = []
  const skillTokenEstimates: Record<string, number> = {}
  const skillTriggers: Record<string, string[]> = {}
  // 每个 Agent 一个空桶（即便无人声明也产出空集），消费方可一律按 agentId 取
  const mountableSkillsByAgent: Record<string, string[]> = {}
  for (const agent of agentList) mountableSkillsByAgent[agent] = []
  for (const skill of skillList) {
    const path = join(agentCorePath, 'skills', skill, 'SKILL.md')
    const ok = await isFile(path)
    checks.push(check(`skill-${skill}`, `Skill ${skill}`, ok, path))
    if (!ok) errors.push(`缺少 skill 文件或不是 regular file: ${path}`)
    if (ok) {
      availableSkills.push(skill)
      const { tokens, triggers, mountAgents } = await readSkillMeta(path)
      skillTokenEstimates[skill] = tokens
      if (triggers.length > 0) skillTriggers[skill] = triggers
      // (Skill × Agent) 绑定：该 Skill 进它声明的每个已知 Agent 的可挂载集；未知 agentId 忽略。
      for (const agentId of mountAgents) {
        if (mountableSkillsByAgent[agentId]) mountableSkillsByAgent[agentId].push(skill)
      }
    }
  }

  const { list: schemaList, declared: schemasDeclared } = manifestList(manifest?.schemas, REQUIRED_SCHEMAS)
  if (!schemasDeclared) errors.push('narracat.manifest.json 未声明 schemas 清单（或格式非法）')
  for (const schema of REQUIRED_SCHEMAS) {
    if (!schemaList.includes(schema)) errors.push(`manifest 未声明必需 schema: ${schema}`)
  }
  for (const schema of schemaList) {
    const path = join(agentCorePath, 'schemas', `${schema}.json`)
    const ok = await isFile(path)
    checks.push(check(`schema-${schema}`, `Schema ${schema}`, ok, path))
    if (!ok) errors.push(`缺少 schema 文件或不是 regular file: ${path}`)
  }

  const { list: templateList, declared: templatesDeclared } = manifestList(manifest?.templates, REQUIRED_TEMPLATES)
  if (!templatesDeclared) errors.push('narracat.manifest.json 未声明 templates 清单（或格式非法）')
  for (const template of REQUIRED_TEMPLATES) {
    if (!templateList.includes(template)) errors.push(`manifest 未声明必需 template: ${template}`)
  }
  for (const template of templateList) {
    const path = join(agentCorePath, 'templates', `${template}.md`)
    const ok = await isFile(path)
    checks.push(check(`template-${template}`, `Template ${template}`, ok, path))
    if (!ok) errors.push(`缺少 template 文件或不是 regular file: ${path}`)
  }

  const mcpPath = join(agentCorePath, 'mcp-server', 'dist', 'index.js')
  const mcpOk = await isFile(mcpPath)
  checks.push(check('mcp-server', 'NovelMemory MCP server build', mcpOk, mcpPath))
  if (!mcpOk) errors.push(`缺少 NovelMemory MCP server build 或不是 regular file: ${mcpPath}`)

  if (await isFile(join(agentCorePath, 'mcp-server', 'package.json'))) {
    for (const packagePath of REQUIRED_MCP_RUNTIME_PACKAGES) {
      const path = join(agentCorePath, 'mcp-server', 'node_modules', packagePath, 'package.json')
      const ok = await isFile(path)
      checks.push(check(`mcp-runtime-${packagePath.replace(/[\\/]/g, '-')}`, `MCP runtime dependency ${packagePath}`, ok, path))
      if (!ok) errors.push(`缺少 NovelMemory MCP server 运行依赖: ${path}`)
    }
  }


  return {
    status: errors.length === 0 ? 'ready' : 'invalid',
    agentCorePath,
    name: manifest?.name,
    version: manifest?.version,
    expectedVersion: EXPECTED_VERSION,
    versionLock: NARRACAT_AGENT_CORE_VERSION_LOCK,
    checks,
    errors,
    agentSkills,
    availableSkills,
    mountableSkillsByAgent,
    skillTokenEstimates,
    skillTriggers,
  }
}
