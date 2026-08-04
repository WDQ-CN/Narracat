import type { AgentRun } from '@shared/types/agent'
import type { NovelProjectDetail, NovelWorkbenchTreeItem } from '@shared/types/novel'
import type { WorkbenchPrimarySectionId, WorkbenchTabItem } from './workbench-navigation'

export interface WorkbenchGenerationState {
  label: string
  statusText: string
}

export type WorkbenchSidebarGenerationTarget =
  | { kind: 'primary'; id: WorkbenchPrimarySectionId }
  | { kind: 'volume'; id: string }
  | { kind: 'chapter'; id: string }

export function resolveWorkbenchGenerationState({
  activeRun,
  activeTab,
  selectedItem,
  selectedSectionId,
}: {
  activeRun: AgentRun | null
  activeTab: WorkbenchTabItem | null
  selectedItem: NovelWorkbenchTreeItem | null
  selectedSectionId: WorkbenchPrimarySectionId
}): WorkbenchGenerationState | null {
  if (!activeRun || activeRun.status !== 'running' || !activeRun.target || !selectedItem) return null

  const target = activeRun.target
  if (target.sectionId !== selectedSectionId) return null
  if (target.objectId !== selectedItem.id) return null
  if (activeTab && target.tabId !== activeTab.id && target.tabId !== activeTab.objectId) return null

  const label = activeTab?.title ?? selectedItem.title
  return {
    label,
    statusText: `正在生成${label}`,
  }
}

export function resolveWorkbenchSidebarGenerationTarget({
  activeRun,
  project,
}: {
  activeRun: AgentRun | null
  project: NovelProjectDetail | null
}): WorkbenchSidebarGenerationTarget | null {
  if (!activeRun || activeRun.status !== 'running' || !activeRun.target || !project) return null
  if (activeRun.projectPath && activeRun.projectPath !== project.path) return null

  const sectionId = readGenerationSectionId(activeRun.target.sectionId)
  if (!sectionId) return null

  const targetItem = project.treeItems.find(
    (item) => item.id === activeRun.target?.objectId || item.id === activeRun.target?.tabId,
  )
  const targetTocItem = project.tocItems.find(
    (item) => item.id === activeRun.target?.objectId || item.id === activeRun.target?.tabId,
  )

  if (targetItem?.kind === 'chapter' || targetTocItem?.kind === 'chapter') {
    return { kind: 'chapter', id: targetItem?.id ?? targetTocItem?.id ?? activeRun.target.objectId }
  }

  if (targetItem?.kind === 'volume' || targetTocItem?.kind === 'volume') {
    return { kind: 'volume', id: targetItem?.id ?? targetTocItem?.id ?? activeRun.target.objectId }
  }

  if (targetItem?.kind === 'volume-outline') {
    const volumeId =
      targetItem.parentId ??
      project.tocItems.find((item) => item.kind === 'volume' && item.volumeNumber === targetItem.volumeNumber)?.id
    if (volumeId) return { kind: 'volume', id: volumeId }
  }

  return { kind: 'primary', id: sectionId }
}

function readGenerationSectionId(value: string): WorkbenchPrimarySectionId | null {
  if (value === 'blueprint' || value === 'settings' || value === 'reference-works') return value
  return null
}
