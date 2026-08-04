import type { AgentQuickAction } from '@shared/types/agent'
import type { ManuscriptDraftSummary } from '@shared/types/manuscript-draft'
import type { ConfirmDialogCopy } from '@/components/ui/confirm-dialog'

export type ManuscriptDraftGate =
  | { kind: 'allow' }
  | { kind: 'block'; message: string }
  | { kind: 'warn'; message: string }

const sameChapterBlockedCommands = new Set<AgentQuickAction>(['rewrite', 'review', 'sync-chapter-memory'])

export function commandNeedsManuscriptDraftCheck(command: AgentQuickAction | null | undefined): boolean {
  return command === 'write-next' || (command ? sameChapterBlockedCommands.has(command) : false)
}

export function inferChapterNumber(text: string): number | undefined {
  const match = /第?\s*(\d{1,6})\s*章|ch-?(\d{1,6})\b/i.exec(text)
  const chapter = Number(match?.[1] ?? match?.[2])
  return Number.isInteger(chapter) && chapter > 0 ? chapter : undefined
}

function chapterList(drafts: ManuscriptDraftSummary[]): string {
  return drafts.map((draft) => `第 ${draft.chapter} 章`).join('、')
}

export function resolveManuscriptDraftGate({
  command,
  drafts,
  selectedChapter,
}: {
  command: AgentQuickAction | null | undefined
  drafts: ManuscriptDraftSummary[]
  selectedChapter?: number
}): ManuscriptDraftGate {
  if (!command || drafts.length === 0) return { kind: 'allow' }

  if (command === 'write-next') {
    return {
      kind: 'warn',
      message: `${chapterList(drafts)}有未保存的正文恢复草稿。继续写下一章不会合并这些草稿；草稿会保留，之后仍可回到对应章节保存或放弃。`,
    }
  }

  if (!sameChapterBlockedCommands.has(command)) return { kind: 'allow' }
  if (selectedChapter === undefined) {
    return {
      kind: 'block',
      message: `${chapterList(drafts)}有未保存的正文恢复草稿。请先明确目标章；有草稿的章节必须保存或放弃后才能运行此操作。`,
    }
  }
  if (!drafts.some((draft) => draft.chapter === selectedChapter)) return { kind: 'allow' }

  return {
    kind: 'block',
    message: `第 ${selectedChapter} 章有未保存的正文恢复草稿。请先保存正式正文或放弃草稿，再运行此操作。`,
  }
}

/** warn 档的确认弹窗文案（WorkbenchStage / AgentComposer 共用，#400）：不丢数据，只是新章不合并草稿。 */
export function buildManuscriptDraftWarnConfirm(message: string): ConfirmDialogCopy {
  return {
    title: '有未保存的恢复草稿',
    description: message,
    confirmLabel: '仍要继续',
  }
}
