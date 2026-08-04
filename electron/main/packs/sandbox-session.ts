import type { AgentRuntimeAdapter } from '../agent/runtime/types.ts'

export type SandboxSessionOutcome =
  | { outcome: 'success'; sessionId?: string }
  | { outcome: 'max-turns'; sessionId?: string }
  | { outcome: 'error'; error: string; sessionId?: string }

/**
 * 运行时中立的沙盒会话循环（拆旧刀2）：学习/向导两会话面共用，替代各自消费 SDK 原始消息形状。
 * - 文本段落语义：message.delta 进缓冲，tool.started 与终态前 flush 成整段交给 onText——对齐 SDK
 *   「按 assistant 消息整块透出」的既有观感，pi 的 token 级 delta 不会碎成气泡。
 * - sessionId 经 adapter.readSessionId 中立捕获（SDK=system:init，pi=首发合成会话消息）。
 * - 终态：run.completed→success；run.failed reason==='max-turns'→max-turns（截断不是死刑，
 *   sessionId 保留可续）；其余 run.failed→error 透传人话文案。
 * - SDK「非 success result 之后迭代器额外 throw」的差异由「终态即 return」天然规避。
 */
export async function runSandboxSessionLoop(args: {
  adapter: AgentRuntimeAdapter
  prompt: string
  options: unknown
  onText?: (text: string) => void
}): Promise<SandboxSessionOutcome> {
  const ctx = {
    runId: 'sandbox-session',
    messageId: 'sandbox-session-assistant',
    createdAt: new Date().toISOString(),
  }
  let sessionId: string | undefined
  let buffer = ''
  const flush = () => {
    const text = buffer.trim()
    buffer = ''
    if (text) args.onText?.(text)
  }
  const withSession = <T extends object>(value: T): T & { sessionId?: string } => ({
    ...value,
    ...(sessionId ? { sessionId } : {}),
  })

  for await (const raw of args.adapter.startRun({ prompt: args.prompt, options: args.options })) {
    sessionId = args.adapter.readSessionId(raw) ?? sessionId
    for (const event of args.adapter.mapMessage(raw, ctx)) {
      if (event.type === 'message.delta') {
        buffer += event.text
      } else if (event.type === 'tool.started') {
        flush()
      } else if (event.type === 'run.completed') {
        flush()
        return withSession({ outcome: 'success' as const })
      } else if (event.type === 'run.failed') {
        flush()
        if (event.reason === 'max-turns') return withSession({ outcome: 'max-turns' as const })
        return withSession({ outcome: 'error' as const, error: event.error })
      }
    }
  }

  return withSession({ outcome: 'error' as const, error: '会话没有正常收尾，请重试。' })
}
