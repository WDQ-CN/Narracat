import { describe, expect, test } from 'bun:test'
import { resolveWorkbenchGenerationState, resolveWorkbenchSidebarGenerationTarget } from './workbench-generation'
import type { AgentRun } from '@shared/types/agent'
import type { WorkbenchTabItem } from './workbench-navigation'
import type { NovelProjectDetail, NovelWorkbenchTreeItem } from '@shared/types/novel'

const runningPlan: AgentRun = {
  id: 'run-1',
  threadId: 'thread-1',
  command: 'plan',
  prompt: '规划全书大纲',
  status: 'running',
  startedAt: '2026-05-19T00:00:00.000Z',
  projectPath: '/novels/stars',
  target: {
    sectionId: 'blueprint',
    tabId: 'master-outline',
    objectId: 'master-outline',
  },
}

const masterOutlineTab: WorkbenchTabItem = {
  id: 'master-outline',
  title: '全局大纲',
  objectId: 'master-outline',
  exists: false,
  emptyTitle: '全局大纲尚未生成',
  emptyDescription: '全局大纲缺失。',
  emptyAction: { label: '生成全局大纲', prompt: '请生成全局大纲。' },
}

const masterOutlineItem: NovelWorkbenchTreeItem = {
  id: 'master-outline',
  kind: 'master-outline',
  title: '全书大纲',
  level: 0,
  exists: false,
}

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
  ],
  treeItems: [
    { id: 'master-outline', kind: 'master-outline', title: '全书大纲', level: 0, exists: false },
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
    {
      id: 'bible-premise',
      kind: 'bible-document',
      title: '核心前提',
      level: 1,
      parentId: 'foundation',
      exists: false,
    },
    { id: 'references', kind: 'reference-list', title: '参考作品', level: 0, exists: false },
  ],
}

describe('workbench generation state', () => {
  test('matches a running Agent target to the active workbench tab', () => {
    expect(
      resolveWorkbenchGenerationState({
        activeRun: runningPlan,
        activeTab: masterOutlineTab,
        selectedItem: masterOutlineItem,
        selectedSectionId: 'blueprint',
      }),
    ).toEqual({
      label: '全局大纲',
      statusText: '正在生成全局大纲',
    })
  })

  test('ignores running Agent targets for a different workbench page', () => {
    expect(
      resolveWorkbenchGenerationState({
        activeRun: runningPlan,
        activeTab: {
          ...masterOutlineTab,
          id: 'volume-outline-1',
          title: '第一卷',
          objectId: 'volume-outline-1',
        },
        selectedItem: {
          ...masterOutlineItem,
          id: 'volume-outline-1',
          kind: 'volume-outline',
          title: '卷大纲',
        },
        selectedSectionId: 'blueprint',
      }),
    ).toBeNull()
  })

  test('maps a running chapter target to the matching sidebar chapter row', () => {
    expect(
      resolveWorkbenchSidebarGenerationTarget({
        activeRun: {
          ...runningPlan,
          target: {
            sectionId: 'blueprint',
            tabId: 'chapter-2',
            objectId: 'chapter-2',
          },
        },
        project,
      }),
    ).toEqual({ kind: 'chapter', id: 'chapter-2' })
  })

  test('maps a running volume outline target to the parent sidebar volume row', () => {
    expect(
      resolveWorkbenchSidebarGenerationTarget({
        activeRun: {
          ...runningPlan,
          target: {
            sectionId: 'blueprint',
            tabId: 'volume-outline-1',
            objectId: 'volume-outline-1',
          },
        },
        project,
      }),
    ).toEqual({ kind: 'volume', id: 'volume-1' })
  })

  test('maps non-directory targets to their primary sidebar section', () => {
    expect(resolveWorkbenchSidebarGenerationTarget({ activeRun: runningPlan, project })).toEqual({
      kind: 'primary',
      id: 'blueprint',
    })
    expect(
      resolveWorkbenchSidebarGenerationTarget({
        activeRun: {
          ...runningPlan,
          command: 'setup',
          target: {
            sectionId: 'settings',
            tabId: 'bible-premise',
            objectId: 'bible-premise',
          },
        },
        project,
      }),
    ).toEqual({ kind: 'primary', id: 'settings' })
    expect(
      resolveWorkbenchSidebarGenerationTarget({
        activeRun: {
          ...runningPlan,
          command: 'reference',
          target: {
            sectionId: 'reference-works',
            tabId: 'references',
            objectId: 'references',
          },
        },
        project,
      }),
    ).toEqual({ kind: 'primary', id: 'reference-works' })
  })

  test('ignores completed runs and runs for a different project in the sidebar', () => {
    expect(
      resolveWorkbenchSidebarGenerationTarget({
        activeRun: { ...runningPlan, status: 'complete', finishedAt: '2026-05-19T00:01:00.000Z' },
        project,
      }),
    ).toBeNull()
    expect(
      resolveWorkbenchSidebarGenerationTarget({
        activeRun: { ...runningPlan, projectPath: '/novels/other' },
        project,
      }),
    ).toBeNull()
  })
})
