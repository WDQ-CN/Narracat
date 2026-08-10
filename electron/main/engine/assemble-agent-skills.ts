// assembleAgentSkills：把「作者的 persona 覆盖 + 作者写的要求」组装成运行时 `agents` option 覆盖。
//
// 历史：本文件原先负责 Skill 挂载体系的组装（官方挂/卸叠加、按需触发、definition.skills eager 注入）。
// 该体系已整体退役（spec 2026-08-07 §6.1）——UI 上不再有任何挂/卸入口，且 pi 底座下 definition.skills
// 无消费者（pi-session.ts 的 getSkills 恒返空）。现在只做两件事：
//   ① 把作者的散文块覆盖应用进 agent prompt（parseAgentFile 内完成，同时移除标记）；
//   ② 把作者写的要求追加到 prompt 末尾。
//
// 只为「有作者要求，或有散文覆盖」的 agent 生成覆盖；两者皆无的 agent 不进 agents option
// （省解析、避免无谓改写默认行为）。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { applyProseOverrides } from '@shared/lib/prose-blocks'
import type { ProseOverrideEntry } from '@shared/types/prose-block'
import { expandEngineRoot } from './engine-path-vars.ts'

/** 运行时中立的子 agent 定义：description/prompt 必填全量组装，tools/model 可选。 */
export interface AssembledAgentDefinition {
  description: string
  prompt: string
  tools?: string[]
  model?: string
}

export interface AssembleAgentSkillsArgs {
  agentCorePath: string
  /** 要遍历的 agent id 集合（引擎内置 agent 的封闭集，由调用方传入） */
  agentIds: string[]
  /** 作者对各 Agent 写的要求正文，agent id → 正文数组（按作者写下的先后顺序） */
  authorRequestsByAgent?: Record<string, string[]>
  /** 作者对引擎散文块的覆盖存量（prose-overrides.json）。缺省视作无覆盖。 */
  proseOverrides?: Record<string, ProseOverrideEntry>
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


export async function parseAgentFile(
  agentCorePath: string,
  agentId: string,
  proseOverrides?: Record<string, ProseOverrideEntry>,
): Promise<ParsedAgentFile | null> {
  try {
    const content = await readFile(join(agentCorePath, 'agents', `${agentId}.md`), 'utf-8')
    const { frontmatter, body } = extractFrontmatter(content)
    const parsed = (frontmatter ? (parseYaml(frontmatter) as Record<string, unknown> | null) : null) ?? {}

    const description = typeof parsed.description === 'string' ? parsed.description : ''
    // 散文覆盖 + 移除标记。注意：即使没有任何 override 也必须过这一步——标记服务于作者与守卫，
    // 模型不该看到 HTML 注释。applyProseOverrides 是纯函数不抛，故无需额外兜底。
    const applied = applyProseOverrides(expandEngineRoot(body.trim(), agentCorePath), proseOverrides ?? {})
    const prompt = applied.text
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

/**
 * 组装一个 agent 的定义覆盖；返回 null 表示无需覆盖。
 * 仅当有作者要求、或有散文覆盖时才生成（两者皆无 → 相对默认无任何实质变化）。
 */
async function assembleOne(
  agentCorePath: string,
  agentId: string,
  authorRequests: string[],
  proseOverrides: Record<string, ProseOverrideEntry>,
): Promise<AssembledAgentDefinition | null> {
  const requests = authorRequests.map((text) => text.trim()).filter(Boolean)
  // 有散文覆盖时也必须生成覆盖——否则 pi 会走 engine-agent-registry 的默认路径，作者的调整落空。
  //
  // 这里刻意是**全局**判定（只要 proseOverrides 里存在任一块的覆盖，就为全部 agentId 生成覆盖），
  // 不是「这个 agentId 自己的块有没有被覆盖」。原因：resolveAgentSkillOverrides 只把 assembleAgentSkills
  // 的产物（Record<agentId, AssembledAgentDefinition>）传给运行时 agents option，engine-agent-registry.ts
  // 的 proseOverrides 形参在生产路径上从未被传值（pi/index.ts 只传 overrides）——它的默认回退分支能
  // 正确应用散文覆盖这件事，完全靠「凡有覆盖，全部 5 个 agent 都在这里生成覆盖、因而没人会走到那条
  // 默认分支」这条全局判定兜住。若改成按 agentId 判定，未被覆盖的那些 agent 会从这里的 `if` 提前
  // return null（因为 requests 也可能是空的），engine-agent-registry.ts 的默认分支才会第一次被真正
  // 触达，而它的 proseOverrides 形参又没人传，作者对该 agent 的散文覆盖会静默失效。
  const hasProseOverrides = Object.keys(proseOverrides).length > 0
  if (requests.length === 0 && !hasProseOverrides) return null

  const parsed = await parseAgentFile(agentCorePath, agentId, proseOverrides)
  if (!parsed) return null

  let prompt = parsed.prompt
  if (requests.length > 0) {
    // 追加在 prompt 末尾：近因位置对弱模型的服从度更好。编号让「有几条要求」对模型可数。
    const lines = requests.map((text, index) => `${index + 1}. ${text}`).join('\n')
    prompt = `${prompt}\n\n## 作者对你的要求（写作时必须遵守）\n\n${lines}`
  }

  const definition: AssembledAgentDefinition = {
    description: parsed.description,
    prompt,
  }
  if (parsed.model) definition.model = parsed.model
  if (parsed.tools) definition.tools = parsed.tools

  return definition
}

/**
 * 组装所有「有作者要求或有散文覆盖」的 agent 为 `agents` option（Record<agentId, AssembledAgentDefinition>）。
 * 两者皆无的 agent 不进结果。
 */
export async function assembleAgentSkills({
  agentCorePath,
  agentIds,
  authorRequestsByAgent = {},
  proseOverrides = {},
}: AssembleAgentSkillsArgs): Promise<Record<string, AssembledAgentDefinition>> {
  const agents: Record<string, AssembledAgentDefinition> = {}

  for (const agentId of agentIds) {
    const definition = await assembleOne(
      agentCorePath,
      agentId,
      authorRequestsByAgent[agentId] ?? [],
      proseOverrides,
    )
    if (definition) agents[agentId] = definition
  }

  return agents
}
