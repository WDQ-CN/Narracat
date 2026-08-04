import { beforeEach, describe, expect, test } from 'bun:test'
import { useNovelStore } from './novel-store'

beforeEach(() => {
  useNovelStore.getState().resetNovelState()
})

describe('useNovelStore', () => {
  test('stores Agent Core diagnostics', () => {
    useNovelStore.getState().setDiagnostics({
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
    })

    expect(useNovelStore.getState().diagnostics?.version).toBe('3.10.22')
  })

  test('stores library projects and active project detail', () => {
    useNovelStore.getState().setProjects([
      {
        id: 'novel-1',
        title: '星辰大海',
        path: '/novels/stars',
        status: 'ready',
        chapterProgress: '1 / 2 章',
        wordCountLabel: '2100 字',
      },
    ])
    useNovelStore.getState().setActiveProject({
      id: 'novel-1',
      title: '星辰大海',
      path: '/novels/stars',
      status: 'ready',
      chapterProgress: '1 / 2 章',
      wordCountLabel: '2100 字',
      selectedChapter: 1,
      tocItems: [],
      treeItems: [],
      checkpoint: null,
    })

    expect(useNovelStore.getState().projects).toHaveLength(1)
    expect(useNovelStore.getState().activeProject?.title).toBe('星辰大海')
  })

  test('tracks create and setup saving states independently', () => {
    useNovelStore.getState().setNovelCreating(true)
    useNovelStore.getState().setNovelSetupSaving(true)

    expect(useNovelStore.getState().creating).toBe(true)
    expect(useNovelStore.getState().savingSetup).toBe(true)

    useNovelStore.getState().resetNovelState()

    expect(useNovelStore.getState().creating).toBe(false)
    expect(useNovelStore.getState().savingSetup).toBe(false)
  })
})
