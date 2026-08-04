import { useState } from 'react'
import {
  CheckCircle2,
  CircleDashed,
  FileSearch,
  FileText,
  Layers,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Square,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { cancelAgentRun, startAgentRun } from '@/lib/ipc'
import { useAgentStore } from '@/lib/agent-store'
import { useNovelStore } from '@/lib/novel-store'
import { getWritingOperationState } from '@/lib/writing-operation'
import type { WritingOperationArtifactCard, WritingOperationPhase } from '@/lib/writing-operation'
import type { AgentThread } from '@shared/types/agent'
import type { NovelChapterArtifacts } from '@shared/types/novel'

export function WritingOperationView({
  compact = false,
  thread: providedThread,
  threadId,
  chapterArtifacts: providedChapterArtifacts,
}: {
  compact?: boolean
  thread?: AgentThread
  threadId?: string
  chapterArtifacts?: NovelChapterArtifacts | null
}) {
  const [submitting, setSubmitting] = useState(false)
  const activeThreadId = useAgentStore((state) => state.activeThreadId)
  const scopedThreadId = threadId ?? activeThreadId
  const storeThread = useAgentStore((state) => state.threadsById[scopedThreadId])
  const storeChapterArtifacts = useNovelStore((state) => state.activeArtifacts)
  const activeProjectPath = useNovelStore((state) => state.activeProject?.path)
  const thread = providedThread ?? storeThread
  const chapterArtifacts = providedChapterArtifacts ?? storeChapterArtifacts
  const state = getWritingOperationState(thread, chapterArtifacts, activeProjectPath)

  async function handleCancel() {
    if (!thread?.activeRun || submitting) return
    setSubmitting(true)
    try {
      await cancelAgentRun(thread.activeRun.id)
    } catch (error) {
      console.error(error)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRetry() {
    if (!state.retryRequest || submitting) return
    setSubmitting(true)
    try {
      await startAgentRun(state.retryRequest)
    } catch (error) {
      console.error(error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={cn('min-h-0 overflow-auto', compact ? 'max-h-[42%] border-b border-border' : 'h-full')}>
      <div className={cn('space-y-3', compact ? 'p-3' : 'p-4')}>
        <header className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">{state.title}</div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{state.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {state.canRetry && (
              <Button type="button" variant="secondary" size="sm" disabled={submitting} onClick={() => void handleRetry()}>
                <RotateCcw className="size-3.5" />
                {state.retryLabel}
              </Button>
            )}
            {state.canCancel && (
              <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={() => void handleCancel()}>
                <Square className="size-3 fill-current" />
                取消
              </Button>
            )}
          </div>
        </header>

        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-foreground">阶段流</div>
            <div className="text-xs text-hint-foreground">{state.phases.length} 步</div>
          </div>
          <div className="grid gap-2">
            {state.phases.map((phase) => (
              <PhaseRow key={phase.id} phase={phase} />
            ))}
          </div>
        </section>

        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-foreground">产物</div>
            <div className="text-xs text-hint-foreground">
              已生成 {state.availableArtifactCount} · 等待 {state.missingArtifactCount}
            </div>
          </div>

          {state.artifacts.length > 0 ? (
            <>
              <div className="rounded-row bg-active px-3 py-2 text-xs leading-5 text-muted-foreground">
                已生成 {state.availableArtifactCount} 个，等待 {state.missingArtifactCount} 个
                {state.erroredArtifactCount > 0 ? `，异常 ${state.erroredArtifactCount} 个` : ''}。
              </div>
              <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-[repeat(auto-fit,minmax(132px,1fr))]')}>
                {state.artifacts.map((artifact) => (
                  <ArtifactCard key={`${artifact.kind}-${artifact.path}`} artifact={artifact} />
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-row border border-dashed border-border px-3 py-2 text-xs leading-5 text-muted-foreground">
              等待写作流程输出正文、上下文包和审修报告。
            </div>
          )}
        </section>

      </div>
    </div>
  )
}

function PhaseRow({ phase }: { phase: WritingOperationPhase }) {
  const Icon = getPhaseIcon(phase.status)

  return (
    <div className="flex min-h-10 min-w-0 items-center gap-2 rounded-row border border-border bg-surface px-2.5 py-1.5">
      <Icon
        className={cn(
          'size-3.5 shrink-0',
          phase.status === 'running' && 'animate-spin text-primary',
          phase.status === 'complete' && 'text-success',
          phase.status === 'failed' && 'text-destructive',
          phase.status === 'cancelled' && 'text-hint-foreground',
          phase.status === 'pending' && 'text-hint-foreground'
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">{phase.title}</div>
        <div className="truncate text-xs text-hint-foreground">{phase.detail}</div>
      </div>
      <span className="shrink-0 text-xs text-hint-foreground">{getPhaseStatusLabel(phase.status)}</span>
    </div>
  )
}

function ArtifactCard({ artifact }: { artifact: WritingOperationArtifactCard }) {
  const Icon = getArtifactIcon(artifact.kind)

  return (
    <div className="min-w-0 rounded-row border border-border bg-surface px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium text-foreground">{artifact.title}</span>
      </div>
      <div
        className={cn(
          'mt-1 text-xs',
          artifact.status === 'available' && 'text-success',
          artifact.status === 'missing' && 'text-hint-foreground',
          artifact.status === 'error' && 'text-destructive'
        )}
      >
        {artifact.detail}
      </div>
    </div>
  )
}

function getPhaseIcon(status: WritingOperationPhase['status']) {
  switch (status) {
    case 'running':
      return Loader2
    case 'complete':
      return CheckCircle2
    case 'failed':
      return XCircle
    case 'cancelled':
    case 'pending':
      return CircleDashed
  }
}

function getPhaseStatusLabel(status: WritingOperationPhase['status']): string {
  switch (status) {
    case 'running':
      return '进行中'
    case 'complete':
      return '完成'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
    case 'pending':
      return '等待'
  }
}

function getArtifactIcon(kind: WritingOperationArtifactCard['kind']) {
  switch (kind) {
    case 'outline':
      return Layers
    case 'context-pack':
      return ShieldCheck
    case 'manuscript':
    case 'review':
      return FileText
    case 'deep-review':
      return FileSearch
  }
}
