/**
 * runtime 组合点（拆旧刀5 后单底座）：pi 是唯一 Agent runtime，进程内单例复用。
 * 保留函数形态（per-run 调用点不变）；config 参数已无消费——claude-sdk 全链退役后
 * `agentRuntime` 字段随之退役（旧 config 含该字段时归一化容忍忽略）。
 * 换 runtime 时代的会话失效由 runtimeId 掺进 sessionFingerprint 承担（切片⑦），旧 SDK 会话
 * 续聊自动提示开新对话，该机制保留。
 */
import { createPiAdapter } from './adapters/pi/index.ts'
import type { AgentRuntimeAdapter } from './types.ts'

let adapter: AgentRuntimeAdapter | undefined

export function resolveAgentRuntime(_config?: unknown): AgentRuntimeAdapter {
  if (!adapter) adapter = createPiAdapter()
  return adapter
}
