import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, test } from 'bun:test'
import {
  resolveWorkbenchContentSelection,
  selectMatchingWorkbenchArtifacts,
  selectWorkbenchObjectItem,
} from './WorkbenchContentView'
import { useAgentStore } from '@/lib/agent-store'
import { useNovelStore } from '@/lib/novel-store'
import type { NovelProjectDetail } from '@shared/types/novel'

const readyProject: NovelProjectDetail = {
  id: 'stars',
  title: '星辰大海',
  path: '/novels/stars',
  status: 'ready',
  chapterProgress: '0/2',
  wordCountLabel: '0 字',
  tocItems: [],
  treeItems: [
    {
      id: 'master-outline',
      kind: 'master-outline',
      title: '全书大纲',
      level: 0,
      exists: true,
    },
    {
      id: 'foundation',
      kind: 'foundation',
      title: '创作根基',
      level: 0,
      exists: true,
    },
    {
      id: 'bible-premise',
      kind: 'bible-document',
      title: '核心前提',
      level: 1,
      parentId: 'foundation',
      exists: true,
    },
    {
      id: 'bible-scenes',
      kind: 'bible-document',
      title: '场景设定',
      level: 1,
      parentId: 'foundation',
      exists: true,
    },
    {
      id: 'characters',
      kind: 'character-list',
      title: '角色档案',
      level: 0,
      exists: true,
    },
    {
      id: 'world',
      kind: 'world-list',
      title: '世界设定',
      level: 0,
      exists: true,
    },
    {
      id: 'volume-1',
      kind: 'volume',
      title: '第一卷',
      level: 0,
      volumeNumber: 1,
    },
    {
      id: 'volume-outline-1',
      kind: 'volume-outline',
      title: '卷大纲',
      level: 1,
      parentId: 'volume-1',
      volumeNumber: 1,
      exists: true,
    },
    {
      id: 'chapter-1',
      kind: 'chapter',
      title: '第一章',
      level: 1,
      parentId: 'volume-1',
      chapterNumber: 1,
      volumeNumber: 1,
      status: 'planned',
    },
    {
      id: 'chapter-2',
      kind: 'chapter',
      title: '第二章',
      level: 1,
      parentId: 'volume-1',
      chapterNumber: 2,
      volumeNumber: 1,
      status: 'planned',
    },
  ],
}

beforeEach(() => {
  useNovelStore.getState().resetNovelState()
  useAgentStore.getState().resetAgentState()
})

describe('WorkbenchContentView selectors', () => {
  test('does not short-circuit prerequisite states into legacy setup panels', () => {
    const source = readFileSync(fileURLToPath(new URL('./WorkbenchContentView.tsx', import.meta.url)), 'utf-8')

    expect(source).not.toContain('SetupAgentPanel')
    expect(source).not.toContain('PlanningAgentPanel')
    expect(source).not.toContain("project?.status === 'needs-setup'")
    expect(source).not.toContain("project?.status === 'needs-outline'")
  })

  test('returns null when there is no active tab object id', () => {
    const selectedItem = selectWorkbenchObjectItem({
      project: readyProject,
      selectedObjectId: null,
    })

    expect(selectedItem).toBeNull()
  })

  test('does not fall back to loaded artifacts for stale tab object ids', () => {
    const selectedItem = selectWorkbenchObjectItem({
      project: readyProject,
      selectedObjectId: 'chapter-999',
    })

    expect(selectedItem).toBeNull()
  })

  test('uses a valid active tab object id', () => {
    const selectedItem = selectWorkbenchObjectItem({
      project: readyProject,
      selectedObjectId: 'world',
    })

    expect(selectedItem?.id).toBe('world')
  })

  test('returns no matching artifacts when loaded artifacts belong to a previous object', () => {
    const selectedItem = selectWorkbenchObjectItem({
      project: readyProject,
      selectedObjectId: 'master-outline',
    })

    const matchingArtifacts = selectMatchingWorkbenchArtifacts({
      activeWorkbenchArtifacts: {
        projectPath: '/novels/stars',
        objectId: 'chapter-2',
        objectKind: 'chapter',
        title: '第二章',
        artifacts: [],
      },
      selectedItem,
    })

    expect(selectedItem?.id).toBe('master-outline')
    expect(matchingArtifacts).toBeNull()
  })

  test('selects the settings world tab object for content rendering', () => {
    const selection = resolveWorkbenchContentSelection({
      project: readyProject,
      selectedSectionId: 'settings',
      selectedTabId: 'world',
      activeWorkbenchArtifacts: {
        projectPath: '/novels/stars',
        objectId: 'world',
        objectKind: 'world-list',
        title: '世界设定',
        artifacts: [
          {
            id: 'world',
            kind: 'markdown',
            title: '世界设定',
            exists: true,
            content: '世界观内容',
            path: '/novels/stars/world.md',
          },
        ],
      },
    })

    expect(selection.activeTab?.id).toBe('world')
    expect(selection.selectedItem?.id).toBe('world')
    expect(selection.artifacts?.objectId).toBe('world')
    expect(selection.artifacts?.artifacts[0]?.content).toBe('世界观内容')
  })

  test('falls back to the first section tab when the selected tab is unknown', () => {
    const selection = resolveWorkbenchContentSelection({
      project: readyProject,
      selectedSectionId: 'settings',
      selectedTabId: 'missing-tab',
      activeWorkbenchArtifacts: {
        projectPath: '/novels/stars',
        objectId: 'bible-premise',
        objectKind: 'bible-document',
        title: '核心前提',
        artifacts: [
          {
            id: 'bible-premise',
            kind: 'markdown',
            title: '核心前提',
            exists: true,
            content: '核心前提内容',
            path: '/novels/stars/bible/premise.md',
          },
        ],
      },
    })

    expect(selection.activeTab?.id).toBe('bible-premise')
    expect(selection.selectedItem?.id).toBe('bible-premise')
    expect(selection.artifacts?.objectId).toBe('bible-premise')
    expect(selection.artifacts?.artifacts[0]?.content).toBe('核心前提内容')
  })

  test('preserves legacy object selections that are not section tabs', () => {
    const selection = resolveWorkbenchContentSelection({
      project: readyProject,
      selectedSectionId: 'blueprint',
      selectedObjectId: 'chapter-1',
      selectedTabId: 'chapter-1',
      activeWorkbenchArtifacts: {
        projectPath: '/novels/stars',
        objectId: 'chapter-1',
        objectKind: 'chapter',
        title: '第一章',
        artifacts: [],
      },
    })

    expect(selection.activeTab).toBeNull()
    expect(selection.selectedItem?.id).toBe('chapter-1')
    expect(selection.artifacts?.objectId).toBe('chapter-1')
  })

  test('keeps chapter navigation out of the content selection model', () => {
    const selection = resolveWorkbenchContentSelection({
      project: readyProject,
      selectedSectionId: 'blueprint',
      selectedTabId: 'volume-outline-1',
      activeWorkbenchArtifacts: {
        projectPath: '/novels/stars',
        objectId: 'volume-outline-1',
        objectKind: 'volume-outline',
        title: '卷大纲',
        artifacts: [],
      },
    })

    expect(selection.activeTab?.id).toBe('volume-outline-1')
    expect(selection.selectedItem?.id).toBe('volume-outline-1')
    expect('volumeChapters' in selection).toBe(false)
  })

  test('keeps chapter tab state controlled by the workbench stage', () => {
    const source = readFileSync(fileURLToPath(new URL('./WorkbenchContentView.tsx', import.meta.url)), 'utf-8')

    expect(source).toContain('resolveCurrentStageChapterId')
    expect(source).toContain('chapterView: WorkbenchChapterView')
    expect(source).toContain('onChapterViewChange: (value: WorkbenchChapterView) => void')
    expect(source).toContain('chapterView={chapterView}')
    expect(source).toContain('onChapterViewChange={onChapterViewChange}')
    expect(source).not.toContain('resolveDefaultChapterView')
    expect(source).not.toContain('setChapterView(')
  })

  test('passes target-matched active run generation state into the object view', () => {
    const source = readFileSync(fileURLToPath(new URL('./WorkbenchContentView.tsx', import.meta.url)), 'utf-8')

    expect(source).toContain('resolveWorkbenchGenerationState')
    expect(source).toContain('const activeRun = useAgentStore')
    expect(source).toContain('generationState={generationState}')
  })
})
