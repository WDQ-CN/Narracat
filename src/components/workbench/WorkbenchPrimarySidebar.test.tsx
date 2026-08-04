import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  createInitialCollapsedVolumeIds,
  createWorkbenchChapterDirectoryGroups,
  findChapterVolumeId,
  WorkbenchPrimarySidebar,
} from './WorkbenchPrimarySidebar'
import type { AgentRun } from '@shared/types/agent'
import type { NovelProjectDetail } from '@shared/types/novel'

const project: NovelProjectDetail = {
  id: 'novel-1',
  title: '星辰大海',
  path: '/novels/stars',
  status: 'ready',
  chapterProgress: '1 / 4 章',
  wordCountLabel: '2100 字',
  tocItems: [
    { id: 'volume-1', kind: 'volume', title: '第 1 卷', volumeNumber: 1 },
    {
      id: 'chapter-1',
      kind: 'chapter',
      title: '第 001 章 · 初醒',
      chapterNumber: 1,
      volumeNumber: 1,
      status: 'completed',
    },
    {
      id: 'chapter-2',
      kind: 'chapter',
      title: '第 002 章 · 远行',
      chapterNumber: 2,
      volumeNumber: 1,
      status: 'planned',
    },
    { id: 'volume-2', kind: 'volume', title: '第 2 卷', volumeNumber: 2 },
    {
      id: 'chapter-3',
      kind: 'chapter',
      title: '第 003 章 · 归潮',
      chapterNumber: 3,
      volumeNumber: 2,
      status: 'missing-manuscript',
    },
    {
      id: 'chapter-4',
      kind: 'chapter',
      title: '第 004 章 · 夜航',
      chapterNumber: 4,
      volumeNumber: 2,
      status: 'missing-outline',
    },
  ],
  treeItems: [
    { id: 'master-outline', kind: 'master-outline', title: '全书大纲', level: 0, exists: true },
    { id: 'foundation', kind: 'foundation', title: '创作根基', level: 0, exists: true },
    {
      id: 'bible-premise',
      kind: 'bible-document',
      title: '核心前提',
      level: 1,
      parentId: 'foundation',
      exists: true,
    },
    {
      id: 'bible-style',
      kind: 'bible-document',
      title: '写作风格',
      level: 1,
      parentId: 'foundation',
      exists: false,
    },
    { id: 'references', kind: 'reference-list', title: '参考作品', level: 0, exists: false },
    { id: 'volume-1', kind: 'volume', title: '第 1 卷', level: 0, volumeNumber: 1 },
    {
      id: 'volume-outline-1',
      kind: 'volume-outline',
      title: '卷大纲',
      level: 1,
      parentId: 'volume-1',
      volumeNumber: 1,
      exists: false,
    },
    {
      id: 'chapter-2',
      kind: 'chapter',
      title: '第 002 章 · 远行',
      level: 1,
      parentId: 'volume-1',
      chapterNumber: 2,
      volumeNumber: 1,
      status: 'planned',
    },
  ],
}

function completeProject(): NovelProjectDetail {
  return {
    ...project,
    treeItems: project.treeItems.map((item) => ({ ...item, exists: item.exists === false ? true : item.exists })),
  }
}

function primaryMenuTexts(html: string): string[] {
  const nav = html.match(/<nav[^>]+data-workbench-primary-menu="true"[^>]*>(.*?)<\/nav>/s)?.[1] ?? ''
  return Array.from(nav.matchAll(/<a[^>]+href="\/workbench\?[^"]*"[^>]*>(.*?)<\/a>/gs)).map((match) =>
    match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim(),
  )
}

function primaryMenuHtml(html: string): string {
  return html.match(/<nav[^>]+data-workbench-primary-menu="true"[^>]*>(.*?)<\/nav>/s)?.[1] ?? ''
}

function sidebarHeadbarClass(html: string): string {
  return html.match(/<div class="([^"]+)" data-workbench-sidebar-headbar="true"/)?.[1] ?? ''
}

function sidebarClass(html: string): string {
  return html.match(/<aside class="([^"]+)" data-workbench-primary-sidebar="true"/)?.[1] ?? ''
}

function chapterDirectoryTitleClass(html: string): string {
  return html.match(/<div class="([^"]+)" data-workbench-chapter-directory-title="true"/)?.[1] ?? ''
}

function directoryToggleClass(html: string): string {
  return html.match(/<button[^>]+class="([^"]+)"[^>]+data-workbench-chapter-directory-toggle/)?.[1] ?? ''
}

function chapterTagTexts(html: string): string[] {
  return Array.from(html.matchAll(/data-workbench-chapter-tag="[^"]+"[^>]*>(.*?)<\/span>/g)).map((match) =>
    match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim(),
  )
}

function chapterTagClass(html: string, tag: string): string {
  return html.match(new RegExp(`<span class="([^"]+)" data-workbench-chapter-tag="${tag}"`))?.[1] ?? ''
}

function activeRowTexts(html: string): string[] {
  return Array.from(html.matchAll(/<a[^>]+data-active="true"[^>]*>(.*?)<\/a>/gs)).map((match) =>
    match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim(),
  )
}

function volumeTagClass(html: string, tag: string): string {
  return html.match(new RegExp(`<span class="([^"]+)" data-workbench-volume-tag="${tag}"`))?.[1] ?? ''
}

function volumeExpandedStates(html: string): string[] {
  return Array.from(
    html.matchAll(/<button[^>]+aria-expanded="(true|false)"[^>]+data-workbench-volume-row="true"/g),
  ).map((match) => match[1])
}

function renderWithProviders(children: ReactNode): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <MemoryRouter>{children}</MemoryRouter>
    </TooltipProvider>,
  )
}

const runningChapterRun: AgentRun = {
  id: 'run-1',
  threadId: 'thread-1',
  command: 'write-next',
  prompt: '写本章',
  status: 'running',
  startedAt: '2026-05-19T00:00:00.000Z',
  projectPath: '/novels/stars',
  target: {
    sectionId: 'blueprint',
    tabId: 'chapter-2',
    objectId: 'chapter-2',
  },
}

describe('WorkbenchPrimarySidebar', () => {
  test('章节目录接入 project-local 正文草稿清单并呈现最小草稿点', () => {
    const source = readFileSync(fileURLToPath(new URL('./WorkbenchPrimarySidebar.tsx', import.meta.url)), 'utf-8')

    expect(source).toContain('useManuscriptDrafts(project.path, draftVersion)')
    expect(source).toContain('data-manuscript-draft-dot="true"')
    expect(source).toContain('有未保存的正文恢复草稿')
  })

  test('resolves the default visible chapter volume from selected or current chapters', () => {
    const groups = createWorkbenchChapterDirectoryGroups(project.tocItems)

    expect(groups.map((group) => [group.volume.id, group.chapters.map((chapter) => chapter.id)])).toEqual([
      ['volume-1', ['chapter-1', 'chapter-2']],
      ['volume-2', ['chapter-3', 'chapter-4']],
    ])
    expect(findChapterVolumeId(groups, 'chapter-3')).toBe('volume-2')
    expect(findChapterVolumeId(groups, 'master-outline')).toBeNull()
    expect([...createInitialCollapsedVolumeIds({ volumeIds: ['volume-1', 'volume-2'], visibleVolumeId: 'volume-2' })]).toEqual([
      'volume-1',
    ])
  })

  test('renders project chrome with fixed primary links and a separate chapter directory', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        error={null}
        hasProjectPath
        loading={false}
        project={project}
        selectedSectionId="settings"
        selectedObjectId="chapter-2"
      />,
    )

    expect(html).toContain('aria-label="返回图书馆"')
    expect(html).toContain('data-icon-tooltip="返回图书馆"')
    expect(html).not.toContain('title="返回图书馆"')
    expect(html).toContain('aria-label="打开设置"')
    expect(html).toContain('data-icon-tooltip="打开设置"')
    expect(html).not.toContain('title="打开设置"')
    expect(html).not.toContain('border-r border-border')
    expect(html).toContain('data-workbench-primary-sidebar="true"')
    expect(sidebarClass(html)).toContain('min-h-0')
    expect(sidebarClass(html)).toContain('w-full')
    expect(sidebarClass(html)).not.toContain('w-64')
    expect(html).toContain('data-workbench-sidebar-headbar="true"')
    expect(sidebarHeadbarClass(html)).toContain('justify-end')
    expect(sidebarHeadbarClass(html)).toContain('gap-2')
    expect(sidebarHeadbarClass(html)).not.toContain('justify-between')
    expect(html).toContain('data-workbench-sidebar-fixed-menu="true"')
    expect(html).toContain('星辰大海')
    expect(html).toContain('1 / 4 章 · 2100 字')
    expect(html).toContain('参考作品')
    expect(html).toContain('设定集')
    expect(html).toContain('小说大纲')
    expect(primaryMenuTexts(html)).toEqual([
      '状态',
      '参考作品',
      '设定集待设定',
      '小说大纲待设定',
      '能力包',
      '唠个嗑',
    ])
    expect(html).toContain('data-workbench-primary-section-icon="status"')
    expect(html).toContain('data-workbench-primary-section-icon="reference-works"')
    expect(html).toContain('data-workbench-primary-section-icon="settings"')
    expect(html).toContain('data-workbench-primary-section-icon="blueprint"')
    expect(html).toContain('data-workbench-primary-section-icon="packs"')
    expect(html).toContain('data-workbench-primary-section-icon="chat"')
    expect(primaryMenuHtml(html)).toContain('lucide-notebook-tabs')
    expect(primaryMenuHtml(html)).not.toContain('lucide-settings')
    expect(html).toContain('lucide-book-open')
    expect(html).toContain('data-workbench-primary-menu="true"')
    expect(html).toContain('data-workbench-chapter-directory="true"')
    expect(html).toContain('data-workbench-chapter-directory-scroll="true"')
    expect(html).toContain('min-h-0 flex-1 overflow-hidden border-t')
    expect(html).toContain('小说目录')
    expect(chapterDirectoryTitleClass(html)).toContain('h-8')
    expect(chapterDirectoryTitleClass(html)).toContain('px-2')
    expect(html).toContain('text-hint-foreground">小说目录')
    expect(html).toContain('data-workbench-chapter-directory-toggle="collapse-all"')
    expect(html).toContain('aria-label="全部收起小说目录"')
    expect(html).toContain('lucide-list-collapse')
    expect(directoryToggleClass(html)).toContain('opacity-0')
    expect(directoryToggleClass(html)).toContain('group-hover:opacity-100')
    expect(html).toContain('project=%2Fnovels%2Fstars&amp;section=blueprint&amp;tab=master-outline')
    expect(html).toContain('project=%2Fnovels%2Fstars&amp;section=settings&amp;tab=bible-premise')
    expect(html).toContain('project=%2Fnovels%2Fstars&amp;object=chapter-2')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('data-active="true"')
    expect(volumeExpandedStates(html)).toEqual(['true', 'false'])
    expect(html).toContain('data-workbench-chapter-list="volume-1"')
    expect(html).not.toContain('data-workbench-chapter-list="volume-2"')
    expect(html).not.toContain('创作根基')
    expect(html).toContain('第 002 章 · 远行')
    expect(html).not.toContain('第 003 章 · 归潮')
    expect(html).toContain('当前阶段')
    expect(html).not.toContain('已规划')
    expect(html).not.toContain('待正文')
    expect(html).not.toContain('写作中')
  })

  test('expands the selected chapter volume and keeps other volumes collapsed by default', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        error={null}
        hasProjectPath
        loading={false}
        project={project}
        selectedSectionId="blueprint"
        selectedObjectId="chapter-3"
      />,
    )

    expect(html.match(/data-workbench-volume-row="true"/g) ?? []).toHaveLength(2)
    expect(volumeExpandedStates(html)).toEqual(['false', 'true'])
    expect(html).toContain('focus-visible:ring-ring/50')
    expect(html).toContain('aria-label="小说章节目录" class="space-y-1"')
    expect(html).toContain('data-workbench-chapter-directory-scroll="true"')
    expect(html).not.toContain('data-workbench-chapter-list-motion="volume-1"')
    expect(html).toContain('data-workbench-chapter-list-motion="volume-2"')
    expect(html).toContain('lucide-folder')
    expect(html).not.toContain('data-workbench-chapter-list="volume-1"')
    expect(html).toContain('data-workbench-chapter-list="volume-2"')
    expect(html).toContain('第 1 卷')
    expect(html).toContain('第 2 卷')
    expect(html).not.toContain('第 001 章 · 初醒')
    expect(html).not.toContain('第 002 章 · 远行')
    expect(html).toContain('第 003 章 · 归潮')
    expect(html).toContain('第 004 章 · 夜航')
    expect(chapterTagTexts(html)).toEqual(['待规划'])
    expect(volumeTagClass(html, 'current')).toContain('bg-brand')
    expect(volumeTagClass(html, 'current')).toContain('text-white')
    expect(volumeTagClass(html, 'current')).toContain('font-semibold')
    expect(html).not.toContain('待正文')
    expect(html).not.toContain('已规划')
  })

  test('falls back to the current stage volume when no chapter object is selected', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        error={null}
        hasProjectPath
        loading={false}
        project={project}
        selectedSectionId="settings"
      />,
    )

    expect(volumeExpandedStates(html)).toEqual(['true', 'false'])
    expect(html).toContain('data-workbench-chapter-list="volume-1"')
    expect(html).not.toContain('data-workbench-chapter-list="volume-2"')
    expect(html).toContain('第 002 章 · 远行')
    expect(html).not.toContain('第 003 章 · 归潮')
  })

  test('shows the running Agent state on the targeted chapter row', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        activeRun={runningChapterRun}
        error={null}
        hasProjectPath
        loading={false}
        project={project}
        selectedSectionId="blueprint"
        selectedObjectId="chapter-2"
      />,
    )

    expect(html).toContain('data-workbench-sidebar-generation="chapter-2"')
    expect(html).toContain('aria-label="正在生成第 002 章 · 远行"')
    expect(html).toContain('生成中')
    expect(html).toContain('animate-spin')
  })

  test('promotes a running Agent state to the collapsed target volume row', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        activeRun={{
          ...runningChapterRun,
          target: {
            sectionId: 'blueprint',
            tabId: 'chapter-3',
            objectId: 'chapter-3',
          },
        }}
        error={null}
        hasProjectPath
        loading={false}
        project={project}
        selectedSectionId="blueprint"
        selectedObjectId="chapter-2"
      />,
    )

    expect(volumeExpandedStates(html)).toEqual(['true', 'false'])
    expect(html).not.toContain('data-workbench-chapter-list="volume-2"')
    expect(html).toContain('data-workbench-sidebar-generation="chapter-3"')
    expect(html).toContain('aria-label="正在生成第 003 章 · 归潮"')
  })

  test('shows the running Agent state on the primary section when no directory row matches', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        activeRun={{
          ...runningChapterRun,
          command: 'plan',
          prompt: '规划全书大纲',
          target: {
            sectionId: 'blueprint',
            tabId: 'master-outline',
            objectId: 'master-outline',
          },
        }}
        error={null}
        hasProjectPath
        loading={false}
        project={project}
        selectedSectionId="blueprint"
        selectedObjectId="master-outline"
      />,
    )

    expect(html).toContain('data-workbench-sidebar-generation="blueprint"')
    expect(html).toContain('aria-label="正在生成小说大纲"')
    expect(primaryMenuTexts(html)).toContain('小说大纲生成中')
  })

  test('does not fall back to a chapter active flag when the selected object is a section tab', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        error={null}
        hasProjectPath
        loading={false}
        project={{
          ...project,
          tocItems: project.tocItems.map((item) => (item.id === 'chapter-2' ? { ...item, active: true } : item)),
        }}
        selectedSectionId="settings"
        selectedObjectId={null}
      />,
    )

    expect(activeRowTexts(html)).toEqual(['设定集待设定'])
  })

  test('promotes the current stage tag to a collapsed volume row and hides it while expanded', () => {
    const source = readFileSync(fileURLToPath(new URL('./WorkbenchPrimarySidebar.tsx', import.meta.url)), 'utf-8')
    const expandedHtml = renderWithProviders(
      <WorkbenchPrimarySidebar
        error={null}
        hasProjectPath
        loading={false}
        project={project}
        selectedSectionId="blueprint"
        selectedObjectId="chapter-2"
      />,
    )

    expect(source).toContain('resolveCurrentStageVolumeTag')
    expect(source).toContain('data-workbench-volume-tag={volumeTag.id}')
    expect(source).toContain('expanded,')
    expect(volumeTagClass(expandedHtml, 'current')).toBe('')
  })

  test('uses motion primitives for smoother volume expansion and collapse', () => {
    const source = readFileSync(fileURLToPath(new URL('./WorkbenchPrimarySidebar.tsx', import.meta.url)), 'utf-8')

    expect(source).toContain('AnimatePresence')
    expect(source).toContain('motion.div')
    expect(source).toContain("height: 'auto'")
    expect(source).toContain('data-workbench-chapter-list-motion')
  })

  test('supports collapsing and expanding all chapter volumes from the directory title row', () => {
    const source = readFileSync(fileURLToPath(new URL('./WorkbenchPrimarySidebar.tsx', import.meta.url)), 'utf-8')

    expect(source).toContain('const allCollapsed = volumeIds.every')
    expect(source).toContain('function toggleAllVolumes()')
    expect(source).toContain("setCollapsedVolumeIds(allCollapsed ? new Set() : new Set(volumeIds))")
    expect(source).toContain("data-workbench-chapter-directory-toggle={allCollapsed ? 'expand-all' : 'collapse-all'}")
  })

  test('opens a routed chapter volume without resetting manual volume state', () => {
    const source = readFileSync(fileURLToPath(new URL('./WorkbenchPrimarySidebar.tsx', import.meta.url)), 'utf-8')

    expect(source).toContain('if (!selectedVolumeId) return')
    expect(source).toContain('if (!current.has(selectedVolumeId)) return current')
    expect(source).toContain('next.delete(selectedVolumeId)')
  })

  test('keeps the primary menu outside the chapter directory scroll region', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        error={null}
        hasProjectPath
        loading={false}
        project={project}
        selectedSectionId="settings"
      />,
    )

    const fixedMenuIndex = html.indexOf('data-workbench-sidebar-fixed-menu="true"')
    const directoryScrollIndex = html.indexOf('data-workbench-chapter-directory-scroll="true"')

    expect(fixedMenuIndex).toBeGreaterThan(-1)
    expect(directoryScrollIndex).toBeGreaterThan(-1)
    expect(fixedMenuIndex).toBeLessThan(directoryScrollIndex)
    expect(html.slice(fixedMenuIndex, directoryScrollIndex)).toContain('data-workbench-primary-menu="true"')
    expect(html.slice(fixedMenuIndex, directoryScrollIndex)).not.toContain(
      'data-workbench-chapter-directory-scroll="true"',
    )
  })

  test('keeps primary menu rows limited to title and optional pending status', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        error={null}
        hasProjectPath
        loading={false}
        project={project}
        selectedSectionId="settings"
      />,
    )

    expect(primaryMenuTexts(html)).toEqual([
      '状态',
      '参考作品',
      '设定集待设定',
      '小说大纲待设定',
      '能力包',
      '唠个嗑',
    ])
  })

  test('shows pending markers only for incomplete primary sections', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        error={null}
        hasProjectPath
        loading={false}
        project={project}
        selectedSectionId="blueprint"
      />,
    )

    expect(primaryMenuTexts(html).filter((text) => text.includes('待设定'))).toHaveLength(2)
    expect(primaryMenuTexts(html).find((text) => text === '参考作品')).toBe('参考作品')
    expect(primaryMenuTexts(html).some((text) => text.includes('已完成'))).toBe(false)
  })

  test('does not show completion badges for complete primary sections', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        error={null}
        hasProjectPath
        loading={false}
        project={completeProject()}
        selectedSectionId="blueprint"
      />,
    )

    expect(html).toContain('小说大纲')
    expect(html).toContain('设定集')
    expect(html).toContain('参考作品')
    expect(primaryMenuTexts(html).some((text) => text.includes('待设定'))).toBe(false)
    expect(primaryMenuTexts(html).some((text) => text.includes('已完成'))).toBe(false)
  })

  test('surfaces a project problem notice between the menu and the chapter directory', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        error={null}
        hasProjectPath
        loading={false}
        project={{ ...project, tocItems: [], problem: '全书结构数据损坏：章卷映射缺失或不完整，请让 Agent 重新同步全书结构。' }}
        selectedSectionId="blueprint"
      />,
    )

    expect(html).toContain('data-workbench-project-problem="true"')
    expect(html).toContain('全书结构数据损坏')
  })

  test('does not render a problem notice for healthy projects', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        error={null}
        hasProjectPath
        loading={false}
        project={project}
        selectedSectionId="blueprint"
      />,
    )

    expect(html).not.toContain('data-workbench-project-problem')
  })

  test('renders compact fallback state when no project is available', () => {
    const html = renderWithProviders(
      <WorkbenchPrimarySidebar
        error={null}
        hasProjectPath={false}
        loading={false}
        project={null}
        selectedSectionId="blueprint"
      />,
    )

    expect(html).toContain('未选择小说')
    expect(html).toContain('从图书馆选择')
    expect(html).not.toContain('小说大纲')
    expect(html).not.toContain('设定集')
    expect(html).not.toContain('参考作品')
  })
})
