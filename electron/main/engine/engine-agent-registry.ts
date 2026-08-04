import { NARRACAT_ENGINE_AGENT_IDS } from './agent-core-contract.ts'
import { parseAgentFile } from './assemble-agent-skills.ts'

export interface EngineAgentDefinition {
  description: string
  prompt: string
  tools?: string[]
  model?: string
}

// override 字段校验：description/prompt 必须非空 string 才接受覆盖，tools 必须 string[]、model 必须 string；
// 形状非法整条丢弃回落引擎默认（console.warn），与 resolveSkillOverrides 的 fail-soft 降级语义对齐。
function readOverride(value: unknown): EngineAgentDefinition | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.description !== 'string' || !record.description || typeof record.prompt !== 'string' || !record.prompt) return null
  const definition: EngineAgentDefinition = { description: record.description, prompt: record.prompt }
  if (Array.isArray(record.tools) && record.tools.every((t): t is string => typeof t === 'string')) definition.tools = record.tools
  if (typeof record.model === 'string' && record.model.trim()) definition.model = record.model.trim()
  return definition
}

/**
 * 引擎 agent 注册表：pi Task 工具消费的 subagent 定义来源。
 *
 * overrides 是 `assembleAgentSkills` 的全量组装产物（含用户 Skill inline 后的 prompt / model / tools），
 * 对齐 SDK `agents` option 的覆盖语义——同名整体覆盖，非字段合并；`skills` 字段在 pi 侧无消费者
 * （SDK eager 通道），忽略即可。
 */
export async function resolveEngineAgentDefinitions({
  agentCorePath,
  overrides,
}: {
  agentCorePath: string
  overrides?: Record<string, unknown>
}): Promise<Record<string, EngineAgentDefinition>> {
  const registry: Record<string, EngineAgentDefinition> = {}
  for (const agentId of NARRACAT_ENGINE_AGENT_IDS) {
    const override = overrides?.[agentId] !== undefined ? readOverride(overrides[agentId]) : null
    if (overrides?.[agentId] !== undefined && !override) {
      console.warn(`[narracat] agent override 形状非法，回落引擎默认：${agentId}`)
    }
    if (override) {
      registry[agentId] = override
      continue
    }
    const parsed = await parseAgentFile(agentCorePath, agentId)
    if (!parsed) {
      // 静默跳过会让派发端只看到「没这个 agent」，查不到是文件缺失还是 frontmatter 坏了——
      // 留一条警示（仍 fail-soft 不中断，其余 agent 照常进注册表）。
      console.warn(`[narracat] 引擎 agent 文件缺失或 frontmatter 不完整，未进注册表：${agentId}`)
      continue
    }
    registry[agentId] = {
      description: parsed.description,
      prompt: parsed.prompt,
      ...(parsed.tools ? { tools: parsed.tools } : {}),
      ...(parsed.model ? { model: parsed.model } : {}),
    }
  }
  return registry
}
