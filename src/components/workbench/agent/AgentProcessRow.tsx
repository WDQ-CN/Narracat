import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight, Loader2, TriangleAlert, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { AgentPartStatus } from '@shared/types/agent'

export function AgentProcessRow({
  title,
  status,
  detail,
  tone = 'muted',
  defaultOpen = false,
  collapseKey,
}: {
  title: string
  status: AgentPartStatus
  detail?: ReactNode
  /**
   * danger 只用于 run 级终态失败；执行过程中的工具级错误属于 LLM 自愈型瞬时噪声，
   * 用 warning（中性警示）呈现，避免把"重试中"渲染成"任务损坏"。
   */
  tone?: 'muted' | 'warning' | 'danger'
  defaultOpen?: boolean
  collapseKey?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const hasDetail = detail !== undefined && detail !== null && detail !== ''
  const isRunning = status === 'running'
  const isDanger = tone === 'danger'
  const isWarning = tone === 'warning'

  useEffect(() => {
    if (collapseKey !== undefined) setOpen(false)
  }, [collapseKey])

  return (
    <div className="min-w-0 max-w-full text-xs">
      <button
        type="button"
        className={cn(
          'group/process flex min-w-0 max-w-full items-center gap-1.5 py-0.5 text-left transition-opacity hover:opacity-75',
          !hasDetail && 'cursor-default hover:opacity-100'
        )}
        onClick={() => {
          if (hasDetail) setOpen((value) => !value)
        }}
        aria-expanded={hasDetail ? open : undefined}
      >
        {isRunning && <Loader2 className="size-3 animate-spin shrink-0 text-primary opacity-70" />}
        {isDanger && !isRunning && <XCircle className="size-3 shrink-0 text-destructive opacity-75" />}
        {isWarning && !isRunning && <TriangleAlert className="size-3 shrink-0 text-warning opacity-75" />}
        <span
          className={cn(
            'min-w-0 flex-1 truncate leading-relaxed',
            isDanger ? 'text-destructive' : 'text-hint-foreground',
            isRunning && 'animate-pulse'
          )}
        >
          {title}
        </span>
        {hasDetail && (
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-hint-foreground opacity-0 transition-all duration-150 group-hover/process:opacity-70',
              open && 'rotate-90 opacity-70'
            )}
          />
        )}
      </button>

      {open && hasDetail && (
        <div className="ml-1.5 mt-1 mb-2 min-w-0 max-w-full border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground animate-in fade-in slide-in-from-top-1 duration-150">
          {typeof detail === 'string' ? <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{detail}</p> : detail}
        </div>
      )}
    </div>
  )
}
