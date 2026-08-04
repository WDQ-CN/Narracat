import { AgentProcessRow } from './AgentProcessRow'
import { getReasoningTitle } from './AgentPartView'
import { getToolPhrase } from './tool-phrase'
import { cn } from '@/lib/cn'
import type { AgentMessagePart, AgentPartStatus } from '@shared/types/agent'

export type AgentProcessPart = Extract<AgentMessagePart, { type: 'reasoning' | 'tool-call' | 'data' }>

interface ProcessSummary {
  title: string
  status: AgentPartStatus
}

export function isAgentProcessPart(part: AgentMessagePart): part is AgentProcessPart {
  return part.type === 'reasoning' || part.type === 'tool-call' || part.type === 'data'
}

export function AgentProcessStream({
  parts,
  defaultOpen = false,
  collapseKey,
}: {
  parts: AgentProcessPart[]
  defaultOpen?: boolean
  collapseKey?: string
}) {
  const summary = summarizeProcessStream(parts)

  return (
    <div
      data-agent-process-stream="true"
      aria-live={summary.status === 'running' ? 'polite' : undefined}
      className="min-w-0 max-w-full py-1 text-xs"
    >
      <AgentProcessRow
        title={summary.title}
        status={summary.status}
        detail={<ProcessDetail parts={parts} />}
        defaultOpen={defaultOpen}
        collapseKey={collapseKey}
      />
    </div>
  )
}

function summarizeProcessStream(parts: AgentProcessPart[]): ProcessSummary {
  const completedCount = countCompletedParts(parts)
  const runningPart = findLastPart(parts, (part) => part.status === 'running')
  if (runningPart) {
    return {
      title: `执行过程：${getRunningSummary(runningPart)} · 已完成 ${completedCount} 项`,
      status: 'running',
    }
  }

  // 工具级失败是 LLM 自愈型瞬时噪声（换工具/重试后继续），不把整组执行过程标红——
  // 红色保留给 run 级终态失败（由独立的 error part 渲染）。这里只如实标注跳过次数。
  const skippedCount = parts.filter((part) => part.status === 'failed').length
  return {
    title:
      skippedCount > 0
        ? `执行过程已完成 · ${completedCount} 项（自动调整 ${skippedCount} 次）`
        : `执行过程已完成 · ${completedCount} 项`,
    status: 'complete',
  }
}

function ProcessDetail({ parts }: { parts: AgentProcessPart[] }) {
  return (
    <ol className="space-y-1">
      {parts.map((part) => {
        const skipped = part.status === 'failed'
        const detail = getSkippedDetail(part)

        return (
          <li key={part.id} className="min-w-0">
            <div className="flex min-w-0 items-start gap-2">
              <span
                className={cn(
                  'mt-0.5 shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] leading-none',
                  skipped ? 'bg-warning/10 text-warning' : 'bg-active text-hint-foreground'
                )}
              >
                {getStatusLabel(part.status)}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{getProcessTitle(part)}</span>
            </div>
            {detail && (
              <div className="mt-1 ml-10 whitespace-pre-wrap break-words text-muted-foreground/80 [overflow-wrap:anywhere]">
                {detail}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function findLastPart<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item !== undefined && predicate(item)) return item
  }
  return undefined
}

function countCompletedParts(parts: AgentProcessPart[]): number {
  return parts.filter((part) => part.status === 'complete').length
}

function getRunningSummary(part: AgentProcessPart): string {
  if (part.type === 'reasoning') return '正在整理思路...'
  if (part.type === 'tool-call') return getToolPhrase(part.toolName, part.input).loadingLabel
  return `正在${part.title}...`
}

function getSkippedDetail(part: AgentProcessPart): string | undefined {
  if (part.type === 'tool-call' && part.status === 'failed') return compactProcessText(part.error ?? '')
  return undefined
}

function getProcessTitle(part: AgentProcessPart): string {
  if (part.type === 'reasoning') return getReasoningTitle(part.status)
  if (part.type === 'tool-call') {
    const phrase = getToolPhrase(part.toolName, part.input)
    return part.status === 'running' ? phrase.loadingLabel : phrase.label
  }
  return part.title
}

function getStatusLabel(status: AgentPartStatus): string {
  if (status === 'running') return '进行中'
  // 工具级错误在执行过程中是可自愈的瞬时事件，标「已跳过」而非「失败」。
  if (status === 'failed') return '已跳过'
  return '完成'
}

function compactProcessText(text: string): string {
  return text.replace(/(^|[\s("'`=])\/[^\s"'`<>]+/g, (match, prefix: string) => {
    const rawPath = match.slice(prefix.length)
    const trailing = rawPath.match(/[),.;:]+$/)?.[0] ?? ''
    const path = trailing ? rawPath.slice(0, -trailing.length) : rawPath
    const name = path.split('/').pop()
    return name ? `${prefix}${name}${trailing}` : match
  })
}
