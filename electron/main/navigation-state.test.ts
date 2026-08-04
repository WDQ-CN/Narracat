import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  navigationStatePath,
  readStoredWorkLocation,
  writeStoredWorkLocation,
} from './navigation-state'

describe('navigation state store', () => {
  test('uses the App userData navigation-state.json path', () => {
    expect(navigationStatePath('/app/user-data')).toBe('/app/user-data/navigation-state.json')
  })

  test('falls back to Library for missing or damaged state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'narracat-navigation-'))
    const storePath = navigationStatePath(directory)

    expect(await readStoredWorkLocation(storePath)).toEqual({ version: 1, landing: 'library' })

    await writeFile(storePath, '{broken', 'utf8')
    expect(await readStoredWorkLocation(storePath)).toEqual({ version: 1, landing: 'library' })
  })

  test('atomically persists the exact Workbench location', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'narracat-navigation-'))
    const storePath = navigationStatePath(directory)
    const location = {
      version: 1 as const,
      landing: 'workbench' as const,
      novelId: 'novel-stars',
      projectPath: '/novels/stars',
      sectionId: 'blueprint' as const,
      objectId: 'chapter-12',
      chapter: 12,
      chapterView: 'review' as const,
    }

    await writeStoredWorkLocation(storePath, location)

    expect(await readStoredWorkLocation(storePath)).toEqual(location)
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toEqual(location)
  })

  test('serializes concurrent writes in invocation order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'narracat-navigation-'))
    const storePath = navigationStatePath(directory)

    await Promise.all([
      writeStoredWorkLocation(storePath, { version: 1, landing: 'library' }),
      writeStoredWorkLocation(storePath, {
        version: 1,
        landing: 'workbench',
        novelId: 'novel-moon',
        projectPath: '/novels/moon',
        sectionId: 'settings',
        tabId: 'characters',
      }),
    ])

    expect(await readStoredWorkLocation(storePath)).toMatchObject({
      landing: 'workbench',
      novelId: 'novel-moon',
      projectPath: '/novels/moon',
    })
  })
})
