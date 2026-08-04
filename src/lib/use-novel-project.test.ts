import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearWorkbenchArtifactsCacheForProject,
  createChapterArtifactsFromWorkbenchArtifacts,
  deleteLibraryProject,
  loadWorkbenchProject,
  peekWorkbenchArtifactsCache,
  prepareWorkbenchProjectLoad,
  reloadLibraryProjects,
  resolveReusableWorkbenchProjectDetail,
  resolveWorkbenchObjectId,
  saveLibraryProjectMetadata,
} from './use-novel-project'
import { useNovelStore } from './novel-store'
import type { NovelProjectDetail, NovelWorkbenchArtifacts } from '@shared/types/novel'

const detail: NovelProjectDetail = {
  id: 'novel-1',
  title: '星辰大海',
  genre: '科幻',
  coverPreset: 'cover-03',
  path: '/novels/stars',
  status: 'ready',
  chapterProgress: '1 / 2 章',
  wordCountLabel: '2100 字',
  selectedChapter: 2,
  tocItems: [],
  treeItems: [
    {
      id: 'master-outline',
      kind: 'master-outline',
      title: '总纲',
      level: 0,
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
      id: 'world',
      kind: 'world-list',
      title: '世界观',
      level: 1,
      parentId: 'foundation',
      exists: true,
    },
    {
      id: 'references',
      kind: 'reference-list',
      title: '参考作品',
      level: 0,
      exists: false,
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
      title: '第一卷',
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
      chapterNumber: 1,
      volumeNumber: 1,
    },
    {
      id: 'chapter-2',
      kind: 'chapter',
      title: '第二章',
      level: 1,
      chapterNumber: 2,
      volumeNumber: 1,
    },
  ],
  checkpoint: null,
}

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
  useNovelStore.getState().resetNovelState()
})

describe('resolveWorkbenchObjectId', () => {
  test('uses a valid explicit object selection first', () => {
    expect(
      resolveWorkbenchObjectId({
        detail,
        selectedChapter: 1,
        selectedObjectId: 'master-outline',
      }),
    ).toBe('master-outline')
  })

  test('preserves legacy object selection when no section is provided', () => {
    expect(
      resolveWorkbenchObjectId({
        detail,
        selectedObjectId: 'chapter-1',
        selectedTabId: 'chapter-1',
      }),
    ).toBe('chapter-1')
  })

  test('falls back from an invalid explicit object to a valid selected chapter', () => {
    expect(
      resolveWorkbenchObjectId({
        detail,
        selectedChapter: 1,
        selectedObjectId: 'chapter-999',
      }),
    ).toBe('chapter-1')
  })

  test('defaults to the current stage chapter when route selection is absent', () => {
    expect(
      resolveWorkbenchObjectId({
        detail: {
          ...detail,
          selectedChapter: 1,
          tocItems: [
            { id: 'volume-1', kind: 'volume', title: '第一卷', volumeNumber: 1 },
            {
              id: 'chapter-1',
              kind: 'chapter',
              title: '第一章',
              chapterNumber: 1,
              volumeNumber: 1,
              status: 'completed',
            },
            {
              id: 'chapter-2',
              kind: 'chapter',
              title: '第二章',
              chapterNumber: 2,
              volumeNumber: 1,
              status: 'planned',
            },
          ],
        },
      }),
    ).toBe('chapter-2')
  })

  test('defaults to settings when there is no current stage chapter', () => {
    expect(
      resolveWorkbenchObjectId({
        detail: {
          ...detail,
          selectedChapter: 2,
          tocItems: [
            { id: 'volume-1', kind: 'volume', title: '第一卷', volumeNumber: 1 },
            {
              id: 'chapter-1',
              kind: 'chapter',
              title: '第一章',
              chapterNumber: 1,
              volumeNumber: 1,
              status: 'completed',
            },
            {
              id: 'chapter-2',
              kind: 'chapter',
              title: '第二章',
              chapterNumber: 2,
              volumeNumber: 1,
              status: 'completed',
            },
          ],
        },
      }),
    ).toBe('bible-premise')
  })

  test('defaults new projects that still need setup to reference works', () => {
    expect(
      resolveWorkbenchObjectId({
        detail: {
          ...detail,
          status: 'needs-setup',
          selectedChapter: undefined,
          tocItems: [],
        },
      }),
    ).toBe('references')
  })

  test('uses the default blueprint tab when a section route has no tab', () => {
    expect(
      resolveWorkbenchObjectId({
        detail,
        selectedSectionId: 'blueprint',
        selectedTabId: null,
      }),
    ).toBe('master-outline')
  })

  test('uses the default settings tab when a settings route has no tab', () => {
    expect(
      resolveWorkbenchObjectId({
        detail,
        selectedSectionId: 'settings',
        selectedTabId: null,
      }),
    ).toBe('bible-premise')
  })

  test('uses the reference works object when the reference works section has no tab', () => {
    expect(
      resolveWorkbenchObjectId({
        detail,
        selectedSectionId: 'reference-works',
        selectedTabId: null,
      }),
    ).toBe('references')
  })

  test('falls back to the first section tab when route tab is invalid', () => {
    expect(
      resolveWorkbenchObjectId({
        detail,
        selectedSectionId: 'settings',
        selectedTabId: 'missing-tab',
      }),
    ).toBe('bible-premise')
  })

  test('loads the active section tab object when route tab is valid', () => {
    expect(
      resolveWorkbenchObjectId({
        detail,
        selectedSectionId: 'settings',
        selectedTabId: 'world',
      }),
    ).toBe('world')
  })

  test('uses section fallback instead of legacy object when section is provided', () => {
    expect(
      resolveWorkbenchObjectId({
        detail,
        selectedSectionId: 'settings',
        selectedObjectId: 'chapter-1',
        selectedTabId: 'chapter-1',
      }),
    ).toBe('bible-premise')
  })

  test('falls back to the first tree item when no selected chapter exists', () => {
    expect(
      resolveWorkbenchObjectId({
        detail: {
          ...detail,
          selectedChapter: undefined,
          treeItems: [detail.treeItems[0]],
        },
      }),
    ).toBe('master-outline')
  })
})

describe('prepareWorkbenchProjectLoad', () => {
  test('keeps the active project mounted when switching tabs inside the same project', () => {
    useNovelStore.getState().resetNovelState()
    useNovelStore.getState().setActiveProject(detail)
    useNovelStore.getState().setActiveWorkbenchArtifacts({
      projectPath: detail.path,
      objectId: 'master-outline',
      objectKind: 'master-outline',
      title: '总纲',
      artifacts: [],
    })

    prepareWorkbenchProjectLoad(detail.path)

    expect(useNovelStore.getState().activeProject).toBe(detail)
    expect(useNovelStore.getState().activeWorkbenchArtifacts).toBeNull()
    expect(useNovelStore.getState().activeArtifacts).toBeNull()
    expect(useNovelStore.getState().loading).toBe(true)
  })

  test('clears the active project when loading a different project', () => {
    useNovelStore.getState().resetNovelState()
    useNovelStore.getState().setActiveProject(detail)

    prepareWorkbenchProjectLoad('/novels/moon')

    expect(useNovelStore.getState().activeProject).toBeNull()
  })
})

describe('workbench artifact loading', () => {
  test('preserves last-good project content and marks a failed refresh stale', async () => {
    let attempts = 0
    const lastGoodArtifacts: NovelWorkbenchArtifacts = {
      projectPath: detail.path,
      objectId: 'chapter-2',
      objectKind: 'chapter',
      title: '第二章',
      artifacts: [],
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          getNovelProject: async () => {
            attempts += 1
            throw new Error('/Users/example/private-book/.narracat/state.yaml failed')
          },
        },
      },
    })
    useNovelStore.getState().setActiveProject(detail)
    useNovelStore.getState().setActiveWorkbenchArtifacts(lastGoodArtifacts)
    useNovelStore.getState().setWorkbenchLoad({ status: 'ready', hasData: true, issue: null })

    await loadWorkbenchProject(detail.path, 2, 'chapter-2', undefined, undefined, { smooth: true })

    expect(attempts).toBe(2)
    expect(useNovelStore.getState().activeProject).toBe(detail)
    expect(useNovelStore.getState().activeWorkbenchArtifacts).toBe(lastGoodArtifacts)
    expect(useNovelStore.getState().workbenchLoad).toMatchObject({
      status: 'stale',
      hasData: true,
      issue: {
        summary: '没能读取当前项目内容。',
      },
    })
    expect(useNovelStore.getState().workbenchLoad.issue?.id).not.toContain('private-book')
  })

  test('derives chapter artifacts from workbench artifacts without a second chapter IPC', async () => {
    const calls: string[] = []
    const chapterWorkbenchArtifacts: NovelWorkbenchArtifacts = {
      projectPath: detail.path,
      objectId: 'chapter-2',
      objectKind: 'chapter',
      title: '第二章',
      artifacts: [
        {
          id: 'chapter-outline',
          kind: 'chapter-outline',
          title: '章节大纲',
          path: 'outline/vol-01/ch-002.md',
          exists: true,
          content: '# 第二章',
        },
        {
          id: 'manuscript',
          kind: 'manuscript',
          title: '正文',
          path: 'manuscript/vol-01/ch-002.md',
          exists: true,
          content: '# 正文',
        },
        {
          id: 'context-pack',
          kind: 'context-pack',
          title: '上下文',
          path: '.narracat/context-packs/ch-002.json',
          exists: true,
          data: { target_chapter: 2 },
        },
        {
          id: 'review',
          kind: 'review',
          title: '审修报告',
          path: 'reviews/ch-002-review.md',
          exists: false,
        },
        {
          id: 'deep-review',
          kind: 'deep-review',
          title: '深审标注',
          path: 'reviews/ch-002-deep-review.md',
          exists: true,
          content: '# 深审标注',
        },
      ],
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          getNovelProject: async () => {
            calls.push('project')
            return detail
          },
          getNovelWorkbenchArtifacts: async () => {
            calls.push('workbench-artifacts')
            return chapterWorkbenchArtifacts
          },
          getNovelChapterArtifacts: async () => {
            calls.push('chapter-artifacts')
            throw new Error('chapter artifacts should not be loaded separately')
          },
        },
      },
    })

    await loadWorkbenchProject(detail.path, 2, 'chapter-2')

    expect(calls).toEqual(['project', 'workbench-artifacts'])
    expect(useNovelStore.getState().activeWorkbenchArtifacts).toBe(chapterWorkbenchArtifacts)
    expect(useNovelStore.getState().activeArtifacts).toEqual({
      projectPath: detail.path,
      chapterNumber: 2,
      volumeNumber: 1,
      artifacts: [
        {
          kind: 'outline',
          title: '章节大纲',
          path: 'outline/vol-01/ch-002.md',
          exists: true,
          content: '# 第二章',
          data: undefined,
          error: undefined,
        },
        {
          kind: 'manuscript',
          title: '正文',
          path: 'manuscript/vol-01/ch-002.md',
          exists: true,
          content: '# 正文',
          data: undefined,
          error: undefined,
        },
        {
          kind: 'context-pack',
          title: '上下文',
          path: '.narracat/context-packs/ch-002.json',
          exists: true,
          content: undefined,
          data: { target_chapter: 2 },
          error: undefined,
        },
        {
          kind: 'review',
          title: '审修报告',
          path: 'reviews/ch-002-review.md',
          exists: false,
          content: undefined,
          data: undefined,
          error: undefined,
        },
        {
          kind: 'deep-review',
          title: '深审标注',
          path: 'reviews/ch-002-deep-review.md',
          exists: true,
          content: '# 深审标注',
          data: undefined,
          error: undefined,
        },
      ],
    })
  })

  test('returns no chapter artifacts for non-chapter workbench objects', () => {
    expect(
      createChapterArtifactsFromWorkbenchArtifacts({
        selectedTreeItem: detail.treeItems[0],
        workbenchArtifacts: {
          projectPath: detail.path,
          objectId: 'master-outline',
          objectKind: 'master-outline',
          title: '总纲',
          artifacts: [],
        },
      }),
    ).toBeNull()
  })

  test('a superseded concurrent refresh aborts before overwriting the latest result', async () => {
    const latestArtifacts: NovelWorkbenchArtifacts = {
      projectPath: detail.path,
      objectId: 'foundation',
      objectKind: 'foundation',
      title: '创作根基',
      artifacts: [{ id: 'foundation', kind: 'markdown', title: '创作根基', exists: true, content: '最新内容' }],
    }
    const artifactCalls: string[] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          getNovelProject: async () => detail,
          getNovelWorkbenchArtifacts: async () => {
            artifactCalls.push('x')
            return latestArtifacts
          },
        },
      },
    })

    // 模拟 run 结束附近「最后一次增量刷新」与「终态刷新」并发。
    const superseded = loadWorkbenchProject(detail.path, undefined, 'foundation', undefined, undefined, {
      smooth: true,
    })
    const latest = loadWorkbenchProject(detail.path, undefined, 'foundation', undefined, undefined, { smooth: true })
    await Promise.all([superseded, latest])

    // 被取代的刷新在第一个 await 后凭 token 放弃，不再读取 workbench artifacts，也不覆盖 store。
    expect(artifactCalls).toHaveLength(1)
    expect(useNovelStore.getState().activeWorkbenchArtifacts).toBe(latestArtifacts)
  })
})

describe('library loading semantics', () => {
  test('records a successful empty list instead of treating it as an initial placeholder', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          getNarraCatDiagnostics: async () => ({
            status: 'ready',
            agentCorePath: '/plugin',
            name: 'narracat',
            version: '4.0.142',
            expectedVersion: '4.0.142',
            versionLock: {
              path: 'agent-core/narracat-agent-core.lock.json',
              name: 'narracat',
              version: '4.0.142',
              manifestPath: '.claude-plugin/plugin.json',
              updateCommand: 'update',
              checkCommand: 'check',
            },
            checks: [],
            errors: [],
          }),
          listNovelProjects: async () => [],
        },
      },
    })

    await reloadLibraryProjects()

    expect(useNovelStore.getState().projects).toEqual([])
    expect(useNovelStore.getState().libraryLoad).toEqual({
      status: 'ready',
      hasData: true,
      issue: null,
    })
  })
})

describe('resolveReusableWorkbenchProjectDetail', () => {
  test('reuses the mounted project detail when switching objects inside the same project', () => {
    useNovelStore.getState().resetNovelState()
    useNovelStore.getState().setActiveProject(detail)

    expect(resolveReusableWorkbenchProjectDetail(detail.path)).toBe(detail)
  })

  test('does not reuse project detail across different project paths', () => {
    useNovelStore.getState().resetNovelState()
    useNovelStore.getState().setActiveProject(detail)

    expect(resolveReusableWorkbenchProjectDetail('/novels/moon')).toBeNull()
  })
})

describe('saveLibraryProjectMetadata', () => {
  test('refreshes the library and active project after saving metadata', async () => {
    const calls: unknown[] = []
    const updatedProject = {
      ...detail,
      title: '新的书名',
      coverPreset: 'cover-08',
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          updateNovelProjectMetadata: async (input: unknown) => {
            calls.push(['update', input])
            return updatedProject
          },
          getNarraCatDiagnostics: async () => ({
            status: 'ready',
            agentCorePath: '/plugin',
            name: 'narracat',
            version: '3.10.22',
            expectedVersion: '3.10.22',
            versionLock: {
              path: 'agent-core/narracat-agent-core.lock.json',
              name: 'narracat',
              version: '3.10.22',
              manifestPath: '.claude-plugin/plugin.json',
              updateCommand: 'bun --no-cache run prepare:narracat-agent-core -- --source <path>',
              checkCommand: 'bun --no-cache run verify:narracat-agent-core',
            },
            checks: [],
            errors: [],
          }),
          listNovelProjects: async () => [
            {
              id: updatedProject.id,
              title: updatedProject.title,
              genre: updatedProject.genre,
              coverPreset: updatedProject.coverPreset,
              path: updatedProject.path,
              status: updatedProject.status,
              chapterProgress: updatedProject.chapterProgress,
              wordCountLabel: updatedProject.wordCountLabel,
            },
          ],
        },
      },
    })

    useNovelStore.getState().setActiveProject(detail)

    await saveLibraryProjectMetadata({
      projectPath: detail.path,
      title: '新的书名',
      coverPreset: 'cover-08',
    })

    expect(calls).toEqual([['update', { projectPath: detail.path, title: '新的书名', coverPreset: 'cover-08' }]])
    expect(useNovelStore.getState().projects[0]).toMatchObject({
      title: '新的书名',
      coverPreset: 'cover-08',
    })
    expect(useNovelStore.getState().activeProject).toMatchObject({
      title: '新的书名',
      coverPreset: 'cover-08',
    })
  })
})

describe('deleteLibraryProject', () => {
  test('refreshes the library and clears active project state after deletion', async () => {
    const calls: unknown[] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          deleteNovelProject: async (input: unknown) => {
            calls.push(['delete', input])
            return { projectPath: detail.path, trashed: true }
          },
          getNarraCatDiagnostics: async () => ({
            status: 'ready',
            agentCorePath: '/plugin',
            name: 'narracat',
            version: '3.10.22',
            expectedVersion: '3.10.22',
            versionLock: {
              path: 'agent-core/narracat-agent-core.lock.json',
              name: 'narracat',
              version: '3.10.22',
              manifestPath: '.claude-plugin/plugin.json',
              updateCommand: 'bun --no-cache run prepare:narracat-agent-core -- --source <path>',
              checkCommand: 'bun --no-cache run verify:narracat-agent-core',
            },
            checks: [],
            errors: [],
          }),
          listNovelProjects: async () => [],
        },
      },
    })

    useNovelStore.getState().setActiveProject(detail)
    useNovelStore.getState().setActiveWorkbenchArtifacts({
      projectPath: detail.path,
      objectId: 'foundation',
      objectKind: 'foundation',
      title: '创作根基',
      artifacts: [],
    })

    await deleteLibraryProject({
      projectPath: detail.path,
      title: detail.title,
      confirmationTitle: detail.title,
    })

    expect(calls).toEqual([['delete', { projectPath: detail.path, title: detail.title, confirmationTitle: detail.title }]])
    expect(useNovelStore.getState().projects).toEqual([])
    expect(useNovelStore.getState().activeProject).toBeNull()
    expect(useNovelStore.getState().activeWorkbenchArtifacts).toBeNull()
  })
})

describe('workbench artifacts cache (ADR-0022)', () => {
  const cacheDetail: NovelProjectDetail = {
    ...detail,
    path: '/novels/cache-test',
    treeItems: [{ id: 'foundation', kind: 'foundation', title: '创作根基', level: 0, exists: true }],
  }
  const foundationArtifacts: NovelWorkbenchArtifacts = {
    projectPath: cacheDetail.path,
    objectId: 'foundation',
    objectKind: 'foundation',
    title: '创作根基',
    artifacts: [{ id: 'foundation', kind: 'markdown', title: '创作根基', exists: true, content: '根基内容' }],
  }

  afterEach(() => {
    clearWorkbenchArtifactsCacheForProject(cacheDetail.path)
  })

  function mockElectron() {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          getNovelProject: async () => cacheDetail,
          getNovelWorkbenchArtifacts: async () => foundationArtifacts,
        },
      },
    })
  }

  test('loadWorkbenchProject writes loaded artifacts into the cache (refresh keeps cache fresh)', async () => {
    mockElectron()
    expect(peekWorkbenchArtifactsCache(cacheDetail.path, 'foundation')).toBeUndefined()

    await loadWorkbenchProject(cacheDetail.path, undefined, 'foundation')

    expect(peekWorkbenchArtifactsCache(cacheDetail.path, 'foundation')).toEqual(foundationArtifacts)
  })

  test('clearWorkbenchArtifactsCacheForProject evicts only the matching project', async () => {
    mockElectron()
    await loadWorkbenchProject(cacheDetail.path, undefined, 'foundation')
    expect(peekWorkbenchArtifactsCache(cacheDetail.path, 'foundation')).toEqual(foundationArtifacts)

    clearWorkbenchArtifactsCacheForProject('/novels/unrelated')
    expect(peekWorkbenchArtifactsCache(cacheDetail.path, 'foundation')).toEqual(foundationArtifacts)

    clearWorkbenchArtifactsCacheForProject(cacheDetail.path)
    expect(peekWorkbenchArtifactsCache(cacheDetail.path, 'foundation')).toBeUndefined()
  })
})
