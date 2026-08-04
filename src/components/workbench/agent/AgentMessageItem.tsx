import { memo, type ReactNode } from 'react'
import { Play } from 'lucide-react'
import { AgentComposerChip } from './AgentComposerChip'
import { AgentProcessRow } from './AgentProcessRow'
import { AgentProcessStream, isAgentProcessPart, type AgentProcessPart } from './AgentProcessStream'
import { AgentPartView } from './AgentPartView'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { getAgentQuickActionChipLabel } from '@/lib/agent-commands'
import { cn } from '@/lib/cn'
import type { AgentMessage, AgentMessagePart } from '@shared/types/agent'

export const AgentMessageItem = memo(function AgentMessageItem({
  message,
  threadId,
}: {
  message: AgentMessage
  threadId?: string
}) {
  if (message.role === 'divider') {
    return <AgentConversationDivider />
  }

  if (message.role === 'user' && message.origin === 'action') {
    return <AgentTaskCard message={message} />
  }

  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isWaitingForAssistant = message.role === 'assistant' && message.status === 'running' && message.parts.length === 0

  return (
    <article
      className={cn(
        'group/message flex w-full min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_1px_auto_160px]',
        isUser ? 'justify-end' : 'justify-start'
      )}
      data-agent-message-visibility="auto"
    >
      <div
        className={cn(
          'relative min-w-0 max-w-full',
          isUser && 'max-w-[86%] rounded-bubble bg-active px-3 py-2.5',
          !isUser && !isSystem && 'w-full',
          isSystem && 'w-full rounded-card border border-dashed border-border px-2.5 py-2'
        )}
      >
        <div className={cn('min-w-0 max-w-full space-y-2', isUser && 'text-foreground')}>
          {isUser && message.command && (
            <AgentComposerChip
              label={getAgentQuickActionChipLabel(message.command)}
              tone="command"
              className="mb-1"
            />
          )}
          {isWaitingForAssistant ? <AgentWaitingState /> : renderMessageParts(message, threadId)}
        </div>
        <time
          className={cn(
            'pointer-events-none absolute top-full mt-1 whitespace-nowrap text-xs tabular text-hint-foreground opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100',
            isUser ? 'right-0' : 'left-0'
          )}
        >
          {formatTime(message.createdAt)}
        </time>
      </div>
    </article>
  )
})

function renderMessageParts(message: AgentMessage, threadId?: string): ReactNode[] {
  if (message.role !== 'assistant') {
    return message.parts.map((part) => <AgentPartView key={part.id} part={part} threadId={threadId} />)
  }

  return renderAssistantParts(message.parts, threadId)
}

function renderAssistantParts(parts: AgentMessagePart[], threadId?: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let processParts: AgentProcessPart[] = []

  const flushProcessParts = (nextPart?: AgentMessagePart) => {
    if (processParts.length === 0) return
    const groupParts = processParts
    nodes.push(
      <AgentProcessStream
        key={getProcessGroupKey(groupParts)}
        parts={groupParts}
        collapseKey={getProcessGroupCollapseKey(groupParts, nextPart)}
      />
    )
    processParts = []
  }

  for (const part of parts) {
    if (isAgentProcessPart(part)) {
      processParts = [...processParts, part]
      continue
    }

    flushProcessParts(part)
    nodes.push(<AgentPartView key={part.id} part={part} threadId={threadId} />)
  }

  flushProcessParts()
  return nodes
}

export function getProcessGroupKey(parts: AgentProcessPart[]): string {
  return `process-${parts[0]?.id ?? 'empty'}`
}

export function getProcessGroupCollapseKey(parts: AgentProcessPart[], nextPart: AgentMessagePart | undefined): string | undefined {
  const firstPart = parts[0]
  if (firstPart === undefined) return undefined
  if (nextPart?.type !== 'text') return undefined
  if (parts.some((part) => part.status !== 'complete')) return undefined
  return `${getProcessGroupKey(parts)}-after-output`
}

function AgentWaitingState() {
  return (
    <div aria-live="polite">
      <AgentProcessRow title="思考中..." status="running" />
    </div>
  )
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function AgentTaskCard({ message }: { message: AgentMessage }) {
  const label = message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim()

  return (
    <div className="flex w-full justify-center" data-agent-task-card="true">
      <div className="inline-flex max-w-[86%] items-center gap-2 rounded-full border border-border bg-active/60 px-3.5 py-1.5 text-xs font-medium text-foreground">
        <Play className="size-3 shrink-0 fill-current text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate">
          {message.command ? `${getAgentQuickActionChipLabel(message.command)}任务 · ${label}` : label}
        </span>
      </div>
    </div>
  )
}

function AgentConversationDivider() {
  return (
    <div
      className="flex w-full items-center gap-2 py-1 text-hint-foreground"
      role="separator"
      aria-label="新对话，以上内容 AI 已不再参考"
      data-agent-conversation-divider="true"
    >
      <span aria-hidden className="h-px flex-1 bg-border" />
      <IconTooltip label="新对话" description="以上内容 AI 已不再参考">
        <span className="cursor-default select-none whitespace-nowrap text-xs">· 新对话 ·</span>
      </IconTooltip>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  )
}
