import type { AgentComposerHandoff, AgentQuickAction } from '@/types/agent'
import type { NovelWorkbenchArtifact, NovelWorkbenchTreeItem } from '@shared/types/novel'
import type { WorkbenchChapterView } from '@shared/types/workbench'
import type { WorkbenchPrimarySectionId } from './workbench-navigation'

export interface WorkbenchSelectionHandoffDescriptor {
  command: AgentQuickAction
  sourceActionId: string
  sourceTitle: string
  target: {
    sectionId: WorkbenchPrimarySectionId
    tabId: string
    objectId: string
  }
  selectedChapter?: number
}

const SETUP_SELECTION_ITEM_IDS = new Set(['foundation'])
const PREMISE_SELECTION_ITEM_IDS = new Set(['bible-premise'])

export function normalizeSelectedMarkdownText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function resolveWorkbenchSelectionHandoff({
  artifact,
  chapterView,
  sectionId,
  selectedItem,
}: {
  artifact?: Pick<NovelWorkbenchArtifact, 'id' | 'title' | 'isDraft'> | null
  chapterView: WorkbenchChapterView
  sectionId: WorkbenchPrimarySectionId
  selectedItem: NovelWorkbenchTreeItem | null
}): WorkbenchSelectionHandoffDescriptor | null {
  if (!selectedItem || sectionId === 'reference-works') return null

  if (selectedItem.kind === 'chapter') {
    const target = { sectionId: 'blueprint' as const, tabId: selectedItem.id, objectId: selectedItem.id }

    if (chapterView === 'text') {
      // staging 只读预览（刀 3 §4.6）：写作中断的草稿不划选交给 Agent 重写——那等于换个入口
      // 绕回正式正文的重写链，正文视图本就不该给这条草稿正文生成 handoff。
      if (artifact?.isDraft) return null

      return descriptor({
        command: 'rewrite',
        sourceActionId: `selection-${selectedItem.id}-manuscript`,
        sourceTitle: `${selectedItem.title} · 正文`,
        target,
        selectedChapter: selectedItem.chapterNumber,
      })
    }

    if (chapterView === 'review') {
      return descriptor({
        command: 'rewrite',
        sourceActionId: `selection-${selectedItem.id}-review`,
        sourceTitle: `${selectedItem.title} · 审修报告`,
        target,
        selectedChapter: selectedItem.chapterNumber,
      })
    }

    if (chapterView === 'outline') {
      return descriptor({
        command: 'plan',
        sourceActionId: `selection-${selectedItem.id}-outline`,
        sourceTitle: `${selectedItem.title} · 章节大纲`,
        target,
        selectedChapter: selectedItem.chapterNumber,
      })
    }

    return null
  }

  if (sectionId === 'blueprint') {
    return descriptor({
      command: 'plan',
      sourceActionId: `selection-${selectedItem.id}-${artifact?.id ?? selectedItem.id}`,
      sourceTitle: artifact?.title ?? selectedItem.title,
      target: { sectionId: 'blueprint', tabId: selectedItem.id, objectId: selectedItem.id },
    })
  }

  if (sectionId === 'settings') {
    if (selectedItem.kind === 'narrator-voice') {
      return descriptor({
        command: 'plan',
        sourceActionId: `selection-${selectedItem.id}-${artifact?.id ?? selectedItem.id}`,
        sourceTitle: artifact?.title ?? selectedItem.title,
        target: { sectionId: 'blueprint', tabId: 'master-outline', objectId: 'master-outline' },
      })
    }

    // 立项卡（核心前提）走定点修订；创作根基父节点仍走全量立项；其余设定项走 world
    const command: AgentQuickAction = isPremiseSelectionItem(selectedItem)
      ? 'revise-premise'
      : isSetupSelectionItem(selectedItem)
        ? 'setup'
        : 'world'
    return descriptor({
      command,
      sourceActionId: `selection-${selectedItem.id}-${artifact?.id ?? selectedItem.id}`,
      sourceTitle: artifact?.title ?? selectedItem.title,
      target: { sectionId: 'settings', tabId: selectedItem.id, objectId: selectedItem.id },
    })
  }

  return null
}

export function createWorkbenchSelectionComposerHandoff(
  descriptor: WorkbenchSelectionHandoffDescriptor,
  selectedText: string,
): Omit<AgentComposerHandoff, 'id'> | null {
  const text = normalizeSelectedMarkdownText(selectedText)
  if (!text) return null

  return {
    sourceActionId: descriptor.sourceActionId,
    command: descriptor.command,
    prompt: '',
    target: descriptor.target,
    selectedChapter: descriptor.selectedChapter,
    referenceContext: {
      sourceTitle: descriptor.sourceTitle,
      text,
    },
  }
}

function descriptor(input: WorkbenchSelectionHandoffDescriptor): WorkbenchSelectionHandoffDescriptor {
  return input
}

function isSetupSelectionItem(item: NovelWorkbenchTreeItem): boolean {
  return item.kind === 'foundation' || SETUP_SELECTION_ITEM_IDS.has(item.id)
}

function isPremiseSelectionItem(item: NovelWorkbenchTreeItem): boolean {
  return PREMISE_SELECTION_ITEM_IDS.has(item.id)
}
