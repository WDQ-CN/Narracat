// assembleAgentSkills：把「有效挂载」组装成 SDK `query({ agents })` 的 AssembledAgentDefinition 覆盖。
//
// SDK 行为 spike 结论（claude-agent-sdk@0.2.112，sdk.d.ts 静态核验 + grill #259 记录到 #258）：
// - `AssembledAgentDefinition` 是完整结构：`description` / `prompt` 必填，`skills?: string[]` 是 eager 预加载，
//   无「只补 skills、其余继承 plugin frontmatter」的部分覆盖语义。
// - 故动态给 subagent 加 skill，必须由 App **全量组装 AssembledAgentDefinition**：解析 agent `.md` 的
//   frontmatter（description / model / tools）+ body（prompt）→ 完整定义 → 叠加有效 skills。
// - `agents` option 与 `plugins:[{type:'local'}]` 同名 agent 的交互（覆盖/合并）官方无文档（截至
//   sdk@0.2.112 的 sdk.d.ts 对 agents option 仍只说「programmatically define custom subagents」、
//   未声明同名 precedence）；本实现按「同名 AssembledAgentDefinition 覆盖 plugin frontmatter 默认」假设组装
//   （全量复刻 description/model/tools 与文件一致，仅在 skills / prompt 上叠加）。
//
//   ✅ 已真机验证（2026-06-26 · 带 API key 的 `query()` spike，deepseek anthropic-compat 端点 · #258 收口）：
//   上面「覆盖 vs 合并」「skills 是否 eager」三问全部定性——
//   ① agents option 的 `skills` 字段【独立 eager 注入】生效：override 一个与 plugin 同名的 chapter-writer、
//      给 skills:[novel-structure]（chapter-writer 的 plugin frontmatter 并无此 skill），subagent 上下文
//      全文加载了 novel-structure（逐字复述其原句确证）。
//   ② 同名是【覆盖】非合并：同一 probe 里，原 plugin frontmatter 的 novel-web-craft 不再在 subagent 上下文。
//   ③ 故 prompt/tools/model 【必须】由 App 全量组装——覆盖语义下不复刻就会丢 plugin frontmatter 默认；本实现
//      「全量复刻 description/model/tools/prompt + 叠加 skills」是必需且正确的（不是冗余防御）。
//   生产含义：App 把 preload（含 novel-web-craft）复刻进 override.skills，覆盖 + eager 下薄核心 SKILL.md 仍注入
//   subagent（另一 probe：skills:[novel-web-craft] 时 subagent 逐字复述出 SKILL.md 红线），override 路径无丢失
//   隐患。附带确认：references/ 不随 skills 全量注入——subagent 上下文只有 pack_id 指针、无 pack 正文（渐进
//   式披露成立，pack 由写手按 reference_path 用 Read 工具按需加载）。
//
// 只为「有效挂载与默认不一致」的 agent 生成覆盖；默认即满足的 agent 不进 agents option（省解析、
// 避免无谓改写 plugin 默认行为）。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { AgentSkillMount, EffectiveAgentMounts } from '@shared/types/skill-mount'
import { resolveEffectiveMounts } from '@shared/lib/skill-mounts'

/** 运行时中立的子 agent 定义（拆旧刀4，原借 SDK AgentDefinition 类型）：description/prompt 必填
 * 全量组装，tools/model/skills 可选。与 SDK AgentDefinition 结构等价子集——skills 是 SDK eager
 * 预加载通道字段（实测不触发，正文靠 inline），pi 侧无消费者、忽略即可。 */
export interface AssembledAgentDefinition {
  description: string
  prompt: string
  tools?: string[]
  model?: string
  skills?: string[]
}

export interface AssembleAgentSkillsArgs {
  agentCorePath: string
  /** Agent Core 默认 skills（diagnostics.agentSkills），agent id → skill 名数组 */
  defaultSkillsByAgent: Record<string, string[]>
  /**
   * Agent Core 当前实际存在的 skill 全集（diagnostics.availableSkills，扫 skills/ 目录得到）。
   * 用于过滤 userData 残留的、已被 Agent Core 删除/改名的 stale 挂载——stale skillId 若原样写进
   * definition.skills，会让 SDK run 因找不到 skill 失败（且发生在本组装的 try/catch 之外）。
   */
  availableSkills: string[]
  /** 用户挂载叠加（SkillMountStore） */
  userMounts: AgentSkillMount[]
  /**
   * 用户自定义 Skill（ADR-0020 第四类，#295）挂载名单，agent id → 名数组，来自 user-skills.json 存量。
   * 阶段2切片④（2026-07-31）：这些名**不再**合入 definition.skills（没有 `.claude/skills/` 文件背书
   * 的名字不登记；文件搬运链已退役）——此字段仅用于扩展需要组装的 agent id 集合（一个 Agent 可能只挂了
   * 用户 Skill、无任何官方默认，仍需被遍历到）。真正生效靠 userSkillBodiesByAgent 的 inline。
   */
  userSkillNamesByAgent?: Record<string, string[]>
  /**
   * 用户自定义 Skill 的 SKILL.md 正文（已剥 frontmatter），agent id → [{ name, body }]。
   * 退路 A（#295 修复，现为唯一注入通道）：把正文**直接拼进该 Agent 的 prompt**，保证写作指令一定在
   * 上下文——不依赖 SDK 对 definition.skills 的 eager 预加载（实测不触发）。缺省视作无正文。
   */
  userSkillBodiesByAgent?: Record<string, { name: string; body: string }[]>
}

/**
 * 按需挂载触发提示渲染（触发点双写之消费方侧）：把每个按需 skill 声明的触发点（SKILL.md
 * frontmatter `triggers`，#260 规范）渲染成「遇到 X 场景，调用 Skill 工具加载 Y」的轻量提示，
 * 注入消费方 agent 上下文，硬化弱模型按需触发。缺触发点声明时回退到通用提示。
 */
export function renderOnDemandTriggerPrompt(triggersBySkill: Record<string, string[]>): string {
  const skillIds = Object.keys(triggersBySkill)
  if (skillIds.length === 0) return ''

  const lines: string[] = []
  for (const skillId of skillIds) {
    const triggers = triggersBySkill[skillId] ?? []
    if (triggers.length > 0) {
      for (const trigger of triggers) {
        lines.push(`- ${trigger}时，调用 Skill 工具加载 ${skillId}。`)
      }
    } else {
      lines.push(`- 遇到与「${skillId}」相关的场景时，调用 Skill 工具加载 ${skillId}。`)
    }
  }

  return ['## 按需技能触发点', '以下技能未预加载，需在对应场景按需调用：', ...lines].join('\n')
}

/** 解析 SKILL.md frontmatter 的 triggers 列表（#260 规范 SSOT）；缺失/非法返回空数组 */
async function readSkillTriggers(agentCorePath: string, skillId: string): Promise<string[]> {
  try {
    const content = await readFile(join(agentCorePath, 'skills', skillId, 'SKILL.md'), 'utf-8')
    const { frontmatter } = extractFrontmatter(content)
    if (!frontmatter) return []
    const parsed = parseYaml(frontmatter) as Record<string, unknown> | null
    return toStringArray(parsed?.triggers)
  } catch {
    return []
  }
}

function extractFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content)
  if (!match) return { frontmatter: '', body: content }
  return { frontmatter: match[1], body: match[2] }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  // tools 可写成逗号分隔的单行字符串（如 "Read, Write"）
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

export interface ParsedAgentFile {
  description: string
  prompt: string
  model?: string
  tools?: string[]
}

/**
 * 展开 agent body 里的 ${CLAUDE_PLUGIN_ROOT}（含 $CLAUDE_PLUGIN_ROOT 裸形）为真实 agentCorePath。
 *
 * 为什么 App 要在组装时展开：plugin frontmatter prompt 由 SDK plugin 运行时负责展开该变量；
 * 但 agents option 的 AssembledAgentDefinition.prompt 是 App **全量组装** 的（见本文件顶部 spike 结论），
 * 不经 plugin 运行时——若原样保留字面 ${CLAUDE_PLUGIN_ROOT}，被覆盖的 subagent（如 world-curator
 * 引用 ${CLAUDE_PLUGIN_ROOT}/docs/contracts/world-guided.md）会拿到坏路径 Read 不到契约。
 * App 这里用 createSdkOptions 同源的 agentCorePath（= env.CLAUDE_PLUGIN_ROOT）替换，保持一致。
 */
function expandPluginRoot(body: string, agentCorePath: string): string {
  return body.replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b/g, agentCorePath)
}

export async function parseAgentFile(agentCorePath: string, agentId: string): Promise<ParsedAgentFile | null> {
  try {
    const content = await readFile(join(agentCorePath, 'agents', `${agentId}.md`), 'utf-8')
    const { frontmatter, body } = extractFrontmatter(content)
    const parsed = (frontmatter ? (parseYaml(frontmatter) as Record<string, unknown> | null) : null) ?? {}

    const description = typeof parsed.description === 'string' ? parsed.description : ''
    const prompt = expandPluginRoot(body.trim(), agentCorePath)
    if (!description || !prompt) return null

    const result: ParsedAgentFile = { description, prompt }
    if (typeof parsed.model === 'string' && parsed.model.trim()) result.model = parsed.model.trim()
    const tools = toStringArray(parsed.tools)
    if (tools.length > 0) result.tools = tools
    return result
  } catch {
    return null
  }
}

/** 两个 skill 集合是否一致（顺序无关） */
function sameSkillSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every((skill) => setB.has(skill))
}

/**
 * 给定有效挂载，组装一个 agent 的 AssembledAgentDefinition 覆盖；返回 null 表示无需覆盖。
 * 仅当有效 preload 与默认 preload 不一致、或存在按需挂载、或有用户自定义 Skill 正文要 inline 时，
 * 才生成覆盖（三者都无 → 该 Agent 相对默认无任何实质变化，不必覆盖）。
 */
async function assembleOne(
  agentCorePath: string,
  effective: EffectiveAgentMounts,
  defaultPreload: string[],
  userSkillBodies: { name: string; body: string }[],
): Promise<AssembledAgentDefinition | null> {
  const preloadChanged = !sameSkillSet(effective.preload, defaultPreload)
  const hasOnDemand = effective.onDemand.length > 0
  const inlineBodies = userSkillBodies.filter(({ body }) => body.trim())
  const hasUserSkillBodies = inlineBodies.length > 0
  if (!preloadChanged && !hasOnDemand && !hasUserSkillBodies) return null

  const parsed = await parseAgentFile(agentCorePath, effective.agentId)
  if (!parsed) return null

  let prompt = parsed.prompt
  if (hasOnDemand) {
    // 触发点双写之消费方侧：从各按需 skill 声明的触发点（SKILL.md frontmatter triggers）渲染提示
    const triggersBySkill: Record<string, string[]> = {}
    for (const skillId of effective.onDemand) {
      triggersBySkill[skillId] = await readSkillTriggers(agentCorePath, skillId)
    }
    const triggerPrompt = renderOnDemandTriggerPrompt(triggersBySkill)
    if (triggerPrompt) prompt = `${prompt}\n\n${triggerPrompt}`
  }
  // 退路 A（#295，现为用户 Skill 唯一注入通道）：把用户挂载 Skill 的 SKILL.md 正文直接拼进 prompt
  // （见 AssembleAgentSkillsArgs.userSkillBodiesByAgent），保证写作指令一定在上下文，不赌 SDK 对
  // definition.skills 的 eager 预加载（实测不触发）。
  if (inlineBodies.length > 0) {
    const sections = inlineBodies.map(({ name, body }) => `### ${name}\n\n${body.trim()}`).join('\n\n')
    prompt = `${prompt}\n\n## 已挂载技能（作者为本 Agent 挂载，写作时必须严格遵守）\n\n${sections}`
  }

  const definition: AssembledAgentDefinition = {
    description: parsed.description,
    prompt,
  }
  if (parsed.model) definition.model = parsed.model
  if (parsed.tools) {
    // 按需挂载需保留 Skill 工具，否则 agent 无法按需调用；tools 是 allowlist 时确保含 Skill。
    definition.tools = hasOnDemand && !parsed.tools.includes('Skill') ? [...parsed.tools, 'Skill'] : parsed.tools
  }
  // 按需挂载的 skill 不进 skills 字段（不 eager 注入 SKILL.md 全文）；预加载集进。用户自定义 Skill 名
  // 不再合入本字段（阶段2切片④：没有 .claude/skills/ 文件背书的名字不登记，正文已走上面的 prompt inline）。
  if (effective.preload.length > 0) definition.skills = effective.preload

  return definition
}

/**
 * 组装所有「有效挂载与默认不一致」的 agent 为 `agents` option（Record<agentId, AssembledAgentDefinition>）。
 * 默认即满足的 agent 不进结果。
 */
export async function assembleAgentSkills({
  agentCorePath,
  defaultSkillsByAgent,
  availableSkills,
  userMounts,
  userSkillNamesByAgent = {},
  userSkillBodiesByAgent = {},
}: AssembleAgentSkillsArgs): Promise<Record<string, AssembledAgentDefinition>> {
  const agents: Record<string, AssembledAgentDefinition> = {}

  // stale 防护：只放行 Agent Core 当前实际存在的 skill。userData 里残留的、已被删除/改名的挂载
  // 在此被剔除，不进 definition.skills（不主动删 store——skill 回归即自动恢复，比写时删除安全）。
  // 注意 stale 过滤只针对官方 skill（其名空间是 Agent Core skills/ 目录）；用户自定义 Skill 名来自
  // user-skills.json 存量、根本不进 definition.skills 字段（阶段2切片④），与本过滤规则无关。
  const available = new Set(availableSkills)
  const keepKnown = (skills: string[]): string[] => skills.filter((skill) => available.has(skill))

  // 用户 Skill 可能挂在没有任何官方默认 skill 的 Agent 上（如 chapter-writer 默认空），那些 Agent
  // 不在 defaultSkillsByAgent 的有效遍历里也得组装 → 合并两侧 agent id 一起遍历。
  const agentIds = new Set([...Object.keys(defaultSkillsByAgent), ...Object.keys(userSkillNamesByAgent)])

  for (const agentId of agentIds) {
    const defaultSkills = defaultSkillsByAgent[agentId] ?? []
    const userSkillBodies = userSkillBodiesByAgent[agentId] ?? []
    const effective = resolveEffectiveMounts({ agentId, defaultSkills, userMounts })
    const known: EffectiveAgentMounts = {
      ...effective,
      preload: keepKnown(effective.preload),
      onDemand: keepKnown(effective.onDemand),
    }
    const definition = await assembleOne(agentCorePath, known, keepKnown(defaultSkills), userSkillBodies)
    if (definition) agents[agentId] = definition
  }

  return agents
}
