import { describe, expect, test } from 'bun:test'
import type { AppConfig } from '@shared/types/config'
import { POOL_DEFAULT_FIELDS } from '@shared/types/config'
import type { NovelProjectSummary } from '@shared/types/novel'
import {
  parseRememberNovelProjectPathInput,
  rememberNovelProjectPath,
} from './remember-project-path'

const config: AppConfig = {
  ...POOL_DEFAULT_FIELDS,
  apiKeyMetadata: {},
  novelRootDir: '/novels',
  recentNovelPaths: ['/novels/old-stars', '/novels/moon', '/novels/new-stars'],
  systemNotificationsEnabled: true,
  introVersion: 1,
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

describe('remember moved novel project path', () => {
  test('rejects incomplete IPC input', () => {
    expect(() => parseRememberNovelProjectPathInput(null)).toThrow('项目位置参数非法。')
    expect(() => parseRememberNovelProjectPathInput({
      novelId: 'novel-stars',
      previousPath: '/novels/old-stars',
    })).toThrow('项目位置参数非法。')
  })

  test('verifies the project identity before mutating config', async () => {
    let writes = 0

    await expect(rememberNovelProjectPath(
      {
        novelId: 'novel-stars',
        previousPath: '/novels/old-stars',
        currentPath: '/novels/not-stars',
      },
      {
        loadProjectSummary: async () => ({ ...movedProject, id: 'another-novel' }),
        readConfig: async () => config,
        writeConfig: async () => {
          writes += 1
        },
      },
    )).rejects.toThrow('项目身份与新位置不匹配。')

    expect(writes).toBe(0)
  })

  test('promotes the verified new path and removes old and duplicate entries', async () => {
    let written: AppConfig | null = null

    const result = await rememberNovelProjectPath(
      {
        novelId: 'novel-stars',
        previousPath: '/novels/old-stars',
        currentPath: '/novels/new-stars',
      },
      {
        loadProjectSummary: async () => movedProject,
        readConfig: async () => config,
        writeConfig: async (next) => {
          written = next
        },
      },
    )

    expect(result).toEqual({ updated: true })
    expect(written?.recentNovelPaths).toEqual(['/novels/new-stars', '/novels/moon'])
  })
})
