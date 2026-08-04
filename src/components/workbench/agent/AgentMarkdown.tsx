import { useCallback, type ReactNode } from 'react'
import { Command } from 'lucide-react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import {
  getAgentQuickActionCommandLabel,
  getAgentQuickActionMenuLabel,
} from '@/lib/agent-commands'
import { useAgentStore } from '@/lib/agent-store'
import { cn } from '@/lib/cn'
import type { AgentQuickAction } from '@shared/types/agent'

export function AgentMarkdown({ text, threadId }: { text: string; threadId?: string }) {
  const activeThreadId = useAgentStore((state) => state.activeThreadId)
  const scopedThreadId = threadId ?? activeThreadId
  const activeRun = useAgentStore((state) => state.threadsById[scopedThreadId]?.activeRun ?? null)
  const requestComposerHandoff = useAgentStore((state) => state.requestComposerHandoff)
  const disabled = Boolean(activeRun)

  // 引用必须稳定（useCallback）：MarkdownRenderer 按 commandPillRenderer 引用 memo，
  // 每帧新闭包会让流式中的整段 markdown 每帧全量重 parse（跳动根因之一）。
  const commandPillRenderer = useCallback<(commandLabel: string, action: AgentQuickAction) => ReactNode>(
    (commandLabel, action) => (
      <button
        type="button"
        className={cn(
          'mx-0.5 inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 align-baseline text-xs font-medium text-foreground transition-colors',
          disabled ? 'cursor-not-allowed opacity-55' : 'hover:bg-primary/15',
        )}
        disabled={disabled}
        data-agent-command-pill={commandLabel}
        data-agent-command-pill-action={action}
        title={getAgentQuickActionCommandLabel(action)}
        onClick={() => {
          if (disabled) return
          requestComposerHandoff(
            {
              sourceActionId: `agent-command-pill-${commandLabel}`,
              command: action,
              prompt: '',
              preserveDraft: true,
            },
            scopedThreadId,
          )
        }}
      >
        <Command className="size-3" />
        <span>{getAgentQuickActionMenuLabel(action)}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{commandLabel}</span>
      </button>
    ),
    [disabled, requestComposerHandoff, scopedThreadId],
  )

  return <MarkdownRenderer text={text} variant="conversation" commandPillRenderer={commandPillRenderer} />
}
