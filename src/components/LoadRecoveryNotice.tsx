import { useState } from 'react'
import { Link } from 'react-router'
import { Check, Copy, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import type { LoadIssue } from '@/lib/load-state'

export function LoadRecoveryNotice({
  className,
  compact = false,
  from,
  issue,
  onRetry,
  retrying = false,
  stale = false,
}: {
  className?: string
  compact?: boolean
  from: string
  issue: LoadIssue
  onRetry: () => void
  retrying?: boolean
  stale?: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function copyErrorId() {
    try {
      await navigator.clipboard.writeText(issue.id)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section
      className={cn(
        'rounded-card border px-3 py-2.5',
        stale
          ? 'border-warning/30 bg-warning/10 text-warning'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
      data-load-recovery={stale ? 'stale' : 'error'}
      data-load-error-id={issue.id}
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {stale ? '刷新失败，当前显示的是上次成功读取的内容。' : issue.summary}
          </div>
          <div className="mt-1 text-xs opacity-80">错误 ID：{issue.id}</div>
          <div className={cn('mt-2 flex flex-wrap items-center gap-1.5', compact && 'mt-1.5')}>
            <Button type="button" size="xs" variant="outline" disabled={retrying} onClick={onRetry}>
              <RefreshCw className={cn('size-3.5', retrying && 'animate-spin')} />
              {retrying ? '重试中' : '重试'}
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => void copyErrorId()}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? '已复制' : '复制错误 ID'}
            </Button>
            <Button asChild size="xs" variant="ghost">
              <Link to="/settings?section=about" state={{ from }}>
                查看诊断
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
