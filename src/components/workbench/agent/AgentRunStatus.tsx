import { CircleDashed, ListTodo, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { AgentPanelStatus } from '@/lib/agent-panel'

export function AgentRunStatus({ status }: { status: AgentPanelStatus }) {
  const Icon = status.tone === 'running' ? Loader2 : status.tone === 'queued' ? ListTodo : CircleDashed
  const label =
    status.stepCount > 0 && status.currentStepIndex
      ? `${status.currentStepIndex} / ${status.stepCount} · ${status.label}`
      : status.label

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <div
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset',
          status.tone === 'running' && 'bg-primary/10 text-primary ring-primary/30',
          status.tone === 'complete' && 'bg-success/10 text-success ring-success/30',
          status.tone === 'queued' && 'bg-warning/10 text-warning ring-warning/30',
          status.tone === 'idle' && 'bg-active text-hint-foreground ring-transparent'
        )}
      >
        <Icon className={cn('size-3', status.tone === 'running' && 'animate-spin')} />
      </div>
      <div className="min-w-0 truncate font-medium leading-none text-foreground">{label}</div>
    </div>
  )
}
