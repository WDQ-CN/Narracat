/**
 * memory worker 的消息处理核（纯逻辑，DI runTool）：worker 入口只做 parentPort 接线，
 * 便于在 bun test 里不触 utilityProcess/sqlite 测协议行为。
 */
import type { MemoryToolCallResult, MemoryWorkerOutbound } from '@shared/types/memory-rpc'

export interface MemoryWorkerRuntimeDeps {
  runTool(name: string, args: Record<string, unknown>): Promise<MemoryToolCallResult>
}

function parseInbound(raw: unknown): { id: number; tool: string; args: Record<string, unknown> } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const msg = raw as Record<string, unknown>
  if (msg.type !== 'tool-call') return null
  if (typeof msg.id !== 'number' || typeof msg.tool !== 'string') return null
  const args = typeof msg.args === 'object' && msg.args !== null ? (msg.args as Record<string, unknown>) : {}
  return { id: msg.id, tool: msg.tool, args }
}

export function createMemoryWorkerRuntime(deps: MemoryWorkerRuntimeDeps): {
  handleMessage(raw: unknown): Promise<MemoryWorkerOutbound | null>
} {
  return {
    async handleMessage(raw) {
      const inbound = parseInbound(raw)
      if (!inbound) return null
      try {
        const result = await deps.runTool(inbound.tool, inbound.args)
        return { type: 'tool-result', id: inbound.id, text: result.text, isError: result.isError }
      } catch (error) {
        return { type: 'tool-failure', id: inbound.id, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
