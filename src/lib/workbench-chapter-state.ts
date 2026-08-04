import type { NovelChapterStatus, NovelTocItem, NovelWorkbenchTreeItem } from '@shared/types/novel'
import type { WorkbenchChapterView } from '@shared/types/workbench'

export type WorkbenchChapterDirectoryTag =
  | {
      id: 'current' | 'completed' | 'recoverable' | 'interrupted-draft' | 'missing-outline'
      label: string
      className: string
    }
  | null

export function resolveCurrentStageChapterId(tocItems: NovelTocItem[]): string | null {
  const currentChapter = tocItems.find((item) => item.kind === 'chapter' && item.status !== 'completed')

  return currentChapter?.id ?? null
}

/**
 * 未兑现计划「移到后续章」候选章号（A4×D2 片3b Task 7）：本章之后、状态非「已完成」的章。
 * 「已排章纲」由引擎兜底校验（novel_resolve_planned_state 的 defer 动作拒绝未排纲的目标章），
 * 本函数不做该项预查——避免 App 侧 toc 状态与引擎章纲文件真实存在性不同步导致误判。
 */
export function resolveDeferTargets(tocItems: NovelTocItem[], currentChapter: number): number[] {
  return tocItems
    .filter(
      (item): item is NovelTocItem & { chapterNumber: number } =>
        item.kind === 'chapter' &&
        item.status !== 'completed' &&
        typeof item.chapterNumber === 'number' &&
        item.chapterNumber > currentChapter,
    )
    .map((item) => item.chapterNumber)
    .sort((a, b) => a - b)
}

export function resolveDefaultChapterView(selectedItem: NovelWorkbenchTreeItem | null): WorkbenchChapterView {
  if (selectedItem?.kind === 'chapter' && selectedItem.status === 'missing-outline') return 'outline'

  return 'text'
}

export function resolveChapterDirectoryTag({
  chapterId,
  currentChapterId,
  status,
}: {
  chapterId: string
  currentChapterId: string | null
  status: NovelChapterStatus | undefined
}): WorkbenchChapterDirectoryTag {
  if (status === 'recoverable') {
    return {
      id: 'recoverable',
      label: '待恢复',
      className: 'bg-warning/10 font-semibold text-warning',
    }
  }

  if (status === 'interrupted-draft') {
    return {
      id: 'interrupted-draft',
      label: '写作中断',
      className: 'bg-warning/10 text-warning',
    }
  }

  if (chapterId === currentChapterId) {
    return {
      id: 'current',
      label: '当前阶段',
      className: 'bg-brand font-semibold text-white',
    }
  }

  if (status === 'completed') {
    return {
      id: 'completed',
      label: '已完成',
      className: 'bg-active text-muted-foreground',
    }
  }

  if (status === 'missing-outline') {
    return {
      id: 'missing-outline',
      label: '待规划',
      className: 'bg-warning/10 text-warning',
    }
  }

  return null
}

export function resolveCurrentStageVolumeTag({
  chapters,
  currentChapterId,
  expanded,
}: {
  chapters: NovelTocItem[]
  currentChapterId: string | null
  expanded: boolean
}): WorkbenchChapterDirectoryTag {
  if (expanded || !currentChapterId) return null

  const currentChapter = chapters.find((chapter) => chapter.id === currentChapterId)
  if (!currentChapter) return null

  return resolveChapterDirectoryTag({
    chapterId: currentChapter.id,
    currentChapterId,
    status: currentChapter.status,
  })
}
