import { describe, expect, test } from 'bun:test'
import type { NovelProjectSummary } from '@shared/types/novel'
import type { StoredWorkLocation } from '@shared/types/work-location'
import { resolveStartupWorkLocation } from './work-location-startup'

const stored: Extract<StoredWorkLocation, { landing: 'workbench' }> = {
  version: 1,
  landing: 'workbench',
  novelId: 'novel-stars',
  projectPath: '/novels/old-stars',
  sectionId: 'blueprint',
  objectId: 'chapter-8',
  chapter: 8,
  chapterView: 'outline',
}

const movedProject: NovelProjectSummary = {
  id: 'novel-stars',
  title: '星门',
  genre: '科幻',
  coverPreset: 'cover-01',
  path: '/novels/new-stars',
  status: 'ready',
  chapterProgress: '1 / 2 章',
  wordCountLabel: '1000 字',
}

describe('startup work location resolution', () => {
  test('does not scan projects when Library was the last landing', async () => {
    let scans = 0

    const result = await resolveStartupWorkLocation({
      pathname: '/',
      readLocation: async () => ({ version: 1, landing: 'library' }),
      listProjects: async () => {
        scans += 1
        return []
      },
      rememberProjectPath: async () => {},
      writeLocation: async () => {},
    })

    expect(result).toEqual({ kind: 'stay' })
    expect(scans).toBe(0)
  })

  test('retries once, migrates a moved project path, and restores the precise subview', async () => {
    let scans = 0
    const remembered: unknown[] = []
    const writes: StoredWorkLocation[] = []

    const result = await resolveStartupWorkLocation({
      pathname: '/',
      readLocation: async () => stored,
      listProjects: async () => {
        scans += 1
        if (scans === 1) throw new Error('temporary scan failure')
        return [movedProject]
      },
      rememberProjectPath: async (input) => {
        remembered.push(input)
      },
      writeLocation: async (location) => {
        writes.push(location)
      },
    })

    expect(scans).toBe(2)
    expect(remembered).toEqual([{
      novelId: 'novel-stars',
      previousPath: '/novels/old-stars',
      currentPath: '/novels/new-stars',
    }])
    expect(writes).toEqual([{ ...stored, projectPath: '/novels/new-stars' }])
    expect(result).toEqual({
      kind: 'navigate',
      href: '/workbench?project=%2Fnovels%2Fnew-stars&object=chapter-8&view=outline',
    })
  })

  test('clears a missing project location and returns a restrained fallback', async () => {
    const writes: StoredWorkLocation[] = []

    const result = await resolveStartupWorkLocation({
      pathname: '/',
      readLocation: async () => stored,
      listProjects: async () => [],
      rememberProjectPath: async () => {},
      writeLocation: async (location) => {
        writes.push(location)
      },
    })

    expect(writes).toEqual([{ version: 1, landing: 'library' }])
    expect(result).toEqual({
      kind: 'fallback-library',
      message: '上次打开的项目已缺失或损坏，已返回图书馆。',
    })
  })
})
