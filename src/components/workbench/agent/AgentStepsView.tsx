import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react'
import { getAgentSteps } from '@/lib/agent-panel'
import { cn } from '@/lib/cn'
import { useAgentStore } from '@/lib/agent-store'
import type { AgentStep } from '@/lib/agent-panel'

export function AgentStepsView({ steps: providedSteps, threadId }: { steps?: AgentStep[]; threadId?: string } = {}) {
  const activeThreadId = useAgentStore((state) => state.activeThreadId)
  const scopedThreadId = threadId ?? activeThreadId
  const thread = useAgentStore((state) => state.threadsById[scopedThreadId])
  const steps = providedSteps ?? getAgentSteps(thread)

  if (steps.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-3 py-5 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          <CircleDashed className="size-3.5 text-hint-foreground" />
          <span className="truncate">初始状态，Agent 尚未开始执行步骤。</span>
        </div>
      </div>
    )
  }

  if (steps.length === 1 && steps[0]?.status === 'running') {
    return <SingleRunningStep step={steps[0]} />
  }

  return (
    <div className="h-full min-h-0 overflow-auto px-3 py-3">
      <div className="space-y-2">
        {steps.map((step, index) => (
          <AgentStepRow key={step.id} step={step} index={index + 1} />
        ))}
      </div>
    </div>
  )
}

function SingleRunningStep({ step }: { step: AgentStep }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-3 py-5">
      <div className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-inset ring-primary/20">
        <Loader2 className="size-3.5 animate-spin text-primary" />
        <span>{step.title}</span>
        <span className="flex items-center gap-0.5 text-primary" aria-hidden="true">
          <span className="size-1 rounded-full bg-current opacity-40 animate-pulse" />
          <span className="size-1 rounded-full bg-current opacity-60 animate-pulse [animation-delay:120ms]" />
          <span className="size-1 rounded-full bg-current opacity-80 animate-pulse [animation-delay:240ms]" />
        </span>
      </div>
    </div>
  )
}

function AgentStepRow({ step, index }: { step: AgentStep; index: number }) {
  const isRunning = step.status === 'running'
  const isFailed = step.status === 'failed'
  const isPending = step.status === 'pending'
  const Icon = isRunning ? Loader2 : isFailed ? XCircle : isPending ? CircleDashed : CheckCircle2

  return (
    <div className="flex h-8 items-center gap-2 rounded-row px-2 text-xs whitespace-nowrap">
      <div className="w-5 shrink-0 text-right text-xs text-hint-foreground tabular-nums">{index}</div>
      <Icon
        className={cn(
          'size-3.5 shrink-0',
          isRunning && 'animate-spin text-primary',
          isFailed && 'text-destructive',
          isPending && 'text-hint-foreground',
          !isRunning && !isFailed && !isPending && 'text-success'
        )}
      />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate font-medium text-foreground">{step.title}</span>
        <span className="shrink-0 text-hint-foreground">·</span>
        <span className="min-w-0 truncate text-xs text-hint-foreground">{step.detail}</span>
      </div>
    </div>
  )
}
