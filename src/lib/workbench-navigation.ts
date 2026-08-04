import type { NovelProjectDetail, NovelWorkbenchTreeItem } from '@shared/types/novel'

export type WorkbenchPrimarySectionId = 'status' | 'reference-works' | 'blueprint' | 'settings' | 'packs' | 'chat'

export interface WorkbenchEmptyAction {
  label: string
  prompt: string
}

export interface WorkbenchPrimarySection {
  id: WorkbenchPrimarySectionId
  title: string
  pending: boolean
  defaultTabId: string | null
}

export interface WorkbenchTabItem {
  id: string
  title: string
  objectId: string
  exists: boolean
  emptyTitle: string
  emptyDescription: string
  emptyAction: WorkbenchEmptyAction
}

export function resolveWorkbenchSectionId(value: string | null): WorkbenchPrimarySectionId {
  const normalized = value?.trim()
  if (normalized === 'status') return 'status'
  if (normalized === 'reference-works') return 'reference-works'
  if (normalized === 'settings') return 'settings'
  if (normalized === 'chat') return 'chat'
  if (normalized === 'packs') return 'packs'
  return 'blueprint'
}

export function getWorkbenchPrimarySections(project: NovelProjectDetail): WorkbenchPrimarySection[] {
  return [
    buildPrimarySection(project, 'status', '状态'),
    buildPrimarySection(project, 'reference-works', '参考作品'),
    buildPrimarySection(project, 'settings', '设定集'),
    buildPrimarySection(project, 'blueprint', '小说大纲'),
    buildPrimarySection(project, 'packs', '能力包'),
    buildPrimarySection(project, 'chat', '唠个嗑'),
  ]
}

export function getWorkbenchTabs(
  project: NovelProjectDetail,
  sectionId: WorkbenchPrimarySectionId,
): WorkbenchTabItem[] {
  // 状态面板、能力包启用面板与唠个嗑都是独立板块，不走 per-object 标签/产物管线，故无 tab。
  if (sectionId === 'status' || sectionId === 'chat' || sectionId === 'packs') return []
  if (sectionId === 'reference-works') return getReferenceWorksTabs(project)
  return sectionId === 'blueprint' ? getBlueprintTabs(project) : getSettingsTabs(project)
}

export function findWorkbenchTab(tabs: WorkbenchTabItem[], tabId: string | null): WorkbenchTabItem | null {
  const normalizedTabId = tabId?.trim()
  return tabs.find((tab) => tab.id === normalizedTabId) ?? tabs[0] ?? null
}

export function buildWorkbenchSectionHref({
  projectPath,
  sectionId,
}: {
  projectPath: string
  sectionId: WorkbenchPrimarySectionId
}): string {
  const params = new URLSearchParams({ project: projectPath, section: sectionId })
  return `/workbench?${params.toString()}`
}

export function buildWorkbenchTabHref({
  projectPath,
  sectionId,
  tabId,
}: {
  projectPath: string
  sectionId: WorkbenchPrimarySectionId
  tabId: string
}): string {
  const params = new URLSearchParams({ project: projectPath, section: sectionId, tab: tabId })
  return `/workbench?${params.toString()}`
}

export function buildPrimarySectionHref({
  projectPath,
  section,
}: {
  projectPath: string
  section: WorkbenchPrimarySection
}): string {
  return section.defaultTabId
    ? buildWorkbenchTabHref({ projectPath, sectionId: section.id, tabId: section.defaultTabId })
    : buildWorkbenchSectionHref({ projectPath, sectionId: section.id })
}

function buildPrimarySection(
  project: NovelProjectDetail,
  id: WorkbenchPrimarySectionId,
  title: string,
): WorkbenchPrimarySection {
  const tabs = getWorkbenchTabs(project, id)

  return {
    id,
    title,
    pending: id === 'reference-works' ? false : tabs.some((tab) => tab.exists === false),
    defaultTabId: tabs[0]?.id ?? null,
  }
}

function getBlueprintTabs(project: NovelProjectDetail): WorkbenchTabItem[] {
  return project.treeItems
    .filter((item) => {
      const kind = item.kind
      return kind === 'master-outline' || kind === 'volume-outline'
    })
    .sort(compareBlueprintItems)
    .map((item) => tabFromTreeItem(item, blueprintTabTitle(project, item), blueprintEmptyDescription(item)))
}

function getReferenceWorksTabs(project: NovelProjectDetail): WorkbenchTabItem[] {
  return project.treeItems
    .filter((item) => item.kind === 'reference-list')
    .map((item) =>
      tabFromTreeItem(
        item,
        item.title,
        '参考作品是可选输入。分析后会形成项目级参考指导，叙事风格方向由参考指导和大纲叙事声音承载。',
      ),
    )
}

function getSettingsTabs(project: NovelProjectDetail): WorkbenchTabItem[] {
  const items = project.treeItems
    .filter((item) => {
      const kind = item.kind
      return (
        kind === 'bible-document' ||
        kind === 'character-list' ||
        kind === 'world-list' ||
        kind === 'narrator-voice' ||
        kind === 'bible-group'
      )
    })

  return items
    .map((item) =>
      tabFromTreeItem(item, item.title, `${item.title}缺失或为空时，可以让 NarraCat 生成初稿后再继续细化。`),
    )
}

function tabFromTreeItem(item: NovelWorkbenchTreeItem, title: string, emptyDescription: string): WorkbenchTabItem {
  return {
    id: item.id,
    title,
    objectId: item.id,
    exists: item.exists !== false,
    emptyTitle: `${title}尚未生成`,
    emptyDescription,
    emptyAction: {
      label: `生成${title}`,
      prompt: `请为当前小说生成${title}。`,
    },
  }
}

function blueprintTabTitle(project: NovelProjectDetail, item: NovelWorkbenchTreeItem): string {
  if (item.kind === 'master-outline') return '全局大纲'

  const parentVolume = item.parentId ? project.treeItems.find((candidate) => candidate.id === item.parentId) : undefined
  return parentVolume?.title ?? item.title
}

function blueprintEmptyDescription(item: NovelWorkbenchTreeItem): string {
  return item.kind === 'master-outline'
    ? '全局大纲缺失或为空时，可以让 NarraCat 先生成全书结构。'
    : '卷纲缺失或为空时，可以让 NarraCat 生成本卷结构。'
}

function compareBlueprintItems(left: NovelWorkbenchTreeItem, right: NovelWorkbenchTreeItem): number {
  const leftKind = left.kind
  const rightKind = right.kind

  if (leftKind === 'master-outline' && rightKind !== 'master-outline') return -1
  if (leftKind !== 'master-outline' && rightKind === 'master-outline') return 1

  const volumeOrder = (left.volumeNumber ?? 0) - (right.volumeNumber ?? 0)
  return volumeOrder || left.title.localeCompare(right.title, 'zh-CN')
}
