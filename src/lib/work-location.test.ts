import { describe, expect, test } from 'bun:test'
import {
  buildStoredWorkbenchHref,
  createWorkbenchLocation,
  parseStoredWorkLocation,
  resolveSettingsReturnTarget,
  resolveStoredWorkProject,
} from './work-location'
import type { NovelProjectDetail, NovelProjectSummary } from '@shared/types/novel'

const project: NovelProjectDetail = {
  id: 'novel-stars',
  title: '星门',
  genre: '科幻',
  coverPreset: 'cover-01',
  path: '/novels/stars',
  status: 'ready',
  chapterProgress: '1 / 2 章',
  wordCountLabel: '1000 字',
  tocItems: [],
  treeItems: [],
}

describe('work location', () => {
  test('captures project, section, chapter and chapter subview', () => {
    const location = createWorkbenchLocation({
      project,
      sectionId: 'blueprint',
      chapterView: 'review',
      searchParams: new URLSearchParams({
        project: project.path,
        object: 'chapter-12',
      }),
    })

    expect(location).toEqual({
      version: 1,
      landing: 'workbench',
      novelId: 'novel-stars',
      projectPath: '/novels/stars',
      sectionId: 'blueprint',
      objectId: 'chapter-12',
      chapter: 12,
      chapterView: 'review',
    })
    expect(location.landing === 'workbench' ? buildStoredWorkbenchHref(location) : '').toBe(
      '/workbench?project=%2Fnovels%2Fstars&object=chapter-12&view=review',
    )
  })

  test('resolves a moved project by novel id and uses its current path', () => {
    const stored = parseStoredWorkLocation(
      JSON.stringify({
        version: 1,
        landing: 'workbench',
        novelId: 'novel-stars',
        projectPath: '/old/stars',
        sectionId: 'settings',
        tabId: 'characters',
      }),
    )
    const projects: NovelProjectSummary[] = [
      {
        ...project,
        path: '/old/stars',
        status: 'invalid',
      },
      {
        ...project,
        path: '/new/stars',
      },
    ]

    expect(stored.landing).toBe('workbench')
    if (stored.landing !== 'workbench') return

    const resolved = resolveStoredWorkProject(projects, stored)
    expect(resolved?.path).toBe('/new/stars')
    expect(buildStoredWorkbenchHref(stored, resolved?.path)).toContain('project=%2Fnew%2Fstars')
  })

  test('damaged storage falls back to Library', () => {
    expect(parseStoredWorkLocation('{broken')).toEqual({ version: 1, landing: 'library' })
    expect(parseStoredWorkLocation(JSON.stringify({ version: 2, landing: 'workbench' }))).toEqual({
      version: 1,
      landing: 'library',
    })
  })

  test('Settings returns to the precise stored Workbench route', () => {
    const stored = parseStoredWorkLocation(JSON.stringify({
      version: 1,
      landing: 'workbench',
      novelId: 'novel-stars',
      projectPath: '/novels/stars',
      sectionId: 'blueprint',
      objectId: 'chapter-8',
      chapter: 8,
      chapterView: 'outline',
    }))

    expect(resolveSettingsReturnTarget('/workbench', stored)).toContain('object=chapter-8')
    expect(resolveSettingsReturnTarget(undefined, stored)).toContain('object=chapter-8')
    expect(resolveSettingsReturnTarget('/', stored)).toBe('/')
  })
})
