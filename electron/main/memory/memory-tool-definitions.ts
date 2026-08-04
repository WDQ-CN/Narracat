/**
 * 引擎工具定义（tools.js 纯数据模块）的运行时装载：pi 自定义工具的 schema 单一来源。
 * 不 import core.js——那条链拉 handlers/transformers，主进程不该扛；tools.js 零依赖可安全 import。
 */
import { pathToFileURL } from 'node:url'
import { resolveMemoryEngineEntries } from '../engine/memory-core-entries.ts'

export interface MemoryToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const cache = new Map<string, Promise<MemoryToolDefinition[]>>()

export function loadMemoryToolDefinitions(agentCorePath: string): Promise<MemoryToolDefinition[]> {
  let cached = cache.get(agentCorePath)
  if (!cached) {
    cached = importDefinitions(agentCorePath).catch((error) => {
      cache.delete(agentCorePath)
      throw error
    })
    cache.set(agentCorePath, cached)
  }
  return cached
}

async function importDefinitions(agentCorePath: string): Promise<MemoryToolDefinition[]> {
  const { toolsEntry } = resolveMemoryEngineEntries(agentCorePath)
  const module = (await import(pathToFileURL(toolsEntry).href)) as { TOOL_DEFINITIONS?: unknown }
  const definitions = module.TOOL_DEFINITIONS
  if (!Array.isArray(definitions) || definitions.length === 0) {
    throw new Error(`引擎 ${toolsEntry} 未导出非空 TOOL_DEFINITIONS`)
  }
  return definitions as MemoryToolDefinition[]
}
