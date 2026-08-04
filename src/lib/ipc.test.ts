import { afterEach, describe, expect, test } from 'bun:test'
import {
  answerAgentQuestion,
  clearReferenceGuidance,
  createNovelProjectBackup,
  deleteNovelProject,
  importReferenceSourceFiles,
  listResultNotifications,
  markAllResultNotificationsRead,
  markResultNotificationRead,
  onOpenResultNotification,
  pasteReferenceSource,
  removeReferenceSource,
  resetReferenceWorks,
  restoreNovelProjectBackup,
  upsertResultNotification,
  updateNovelProjectMetadata,
} from './ipc'

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

describe('ipc client', () => {
  test('forwards reference works file operations through the preload API', async () => {
    const calls: unknown[] = []
    const summary = {
      sources: [],
      status: {
        guidanceState: 'empty',
        sourceCount: 0,
        needsAnalysis: false,
        stale: false,
        guidanceExists: false,
      },
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          pasteReferenceSource: async (input: unknown) => {
            calls.push(['paste', input])
            return summary
          },
          importReferenceSourceFiles: async (projectPath: string) => {
            calls.push(['import', projectPath])
            return summary
          },
          removeReferenceSource: async (input: unknown) => {
            calls.push(['remove', input])
            return summary
          },
          clearReferenceGuidance: async (projectPath: string) => {
            calls.push(['clear-guidance', projectPath])
            return summary
          },
          resetReferenceWorks: async (projectPath: string) => {
            calls.push(['reset', projectPath])
            return summary
          },
        },
      },
    })

    await pasteReferenceSource({ projectPath: '/novels/stars', title: '片段', content: '正文' })
    await importReferenceSourceFiles('/novels/stars')
    await removeReferenceSource({ projectPath: '/novels/stars', fileName: '片段.md' })
    await clearReferenceGuidance('/novels/stars')
    await resetReferenceWorks('/novels/stars')

    expect(calls).toEqual([
      ['paste', { projectPath: '/novels/stars', title: '片段', content: '正文' }],
      ['import', '/novels/stars'],
      ['remove', { projectPath: '/novels/stars', fileName: '片段.md' }],
      ['clear-guidance', '/novels/stars'],
      ['reset', '/novels/stars'],
    ])
  })

  test('forwards library metadata updates through the preload API', async () => {
    const calls: unknown[] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          updateNovelProjectMetadata: async (input: unknown) => {
            calls.push(input)
            return {
              id: 'novel-1',
              title: '新的书名',
              genre: '科幻',
              coverPreset: 'cover-08',
              path: '/novels/stars',
              status: 'ready',
              chapterProgress: '1 / 2 章',
              wordCountLabel: '2100 字',
              tocItems: [],
              treeItems: [],
              checkpoint: null,
            }
          },
        },
      },
    })

    const updated = await updateNovelProjectMetadata({
      projectPath: '/novels/stars',
      title: '新的书名',
      coverPreset: 'cover-08',
    })

    expect(calls).toEqual([{ projectPath: '/novels/stars', title: '新的书名', coverPreset: 'cover-08' }])
    expect(updated.title).toBe('新的书名')
    expect(updated.coverPreset).toBe('cover-08')
  })

  test('forwards library project deletion through the preload API', async () => {
    const calls: unknown[] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          deleteNovelProject: async (input: unknown) => {
            calls.push(input)
            return { projectPath: '/novels/stars', trashed: true }
          },
        },
      },
    })

    const result = await deleteNovelProject({
      projectPath: '/novels/stars',
      title: '星辰大海',
      confirmationTitle: '星辰大海',
    })

    expect(calls).toEqual([{ projectPath: '/novels/stars', title: '星辰大海', confirmationTitle: '星辰大海' }])
    expect(result).toEqual({ projectPath: '/novels/stars', trashed: true })
  })

  test('forwards project backup and restore through the preload API', async () => {
    const calls: unknown[] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          createNovelProjectBackup: async (projectPath: string) => {
            calls.push(['backup', projectPath])
            return { status: 'canceled' as const }
          },
          restoreNovelProjectBackup: async () => {
            calls.push(['restore'])
            return { status: 'canceled' as const }
          },
        },
      },
    })

    await expect(createNovelProjectBackup('/novels/stars')).resolves.toEqual({ status: 'canceled' })
    await expect(restoreNovelProjectBackup()).resolves.toEqual({ status: 'canceled' })
    expect(calls).toEqual([
      ['backup', '/novels/stars'],
      ['restore'],
    ])
  })

  test('rejects stale AskUserQuestion answers when the main process no longer accepts them', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          answerAgentQuestion: async () => ({ accepted: false }),
        },
      },
    })

    await expect(
      answerAgentQuestion({
        requestId: 'tool-question-1',
        answers: { '这个故事关于什么？': '小人物' },
      }),
    ).rejects.toThrow('问题已过期或当前运行已结束')
  })

  test('forwards result notification operations through the preload API', async () => {
    const calls: unknown[] = []
    const payload = { notifications: [], totalCount: 0, unreadCount: 0 }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          listResultNotifications: async () => {
            calls.push(['list'])
            return payload
          },
          upsertResultNotification: async (notification: unknown) => {
            calls.push(['upsert', notification])
            return payload
          },
          markResultNotificationRead: async (id: string) => {
            calls.push(['mark-read', id])
            return payload
          },
          markAllResultNotificationsRead: async () => {
            calls.push(['mark-all-read'])
            return payload
          },
          onOpenResultNotification: (callback: (notification: unknown) => void) => {
            calls.push(['listen-open'])
            callback(notification)
            return () => calls.push(['unsubscribe-open'])
          },
        },
      },
    })

    const notification = {
      id: 'notification-run-1',
      runId: 'run-1',
      threadId: 'thread-1',
      status: 'success' as const,
      title: '第 1 章正文已生成',
      summary: 'Agent 已完成章节正文生成。',
      projectName: '长夜星河',
      projectPath: '/novels/stars',
      createdAt: '2026-05-22T15:00:00.000Z',
      updatedAt: '2026-05-22T15:00:00.000Z',
    }

    await listResultNotifications()
    await upsertResultNotification(notification)
    await markResultNotificationRead('notification-run-1')
    await markAllResultNotificationsRead()
    const unsubscribe = onOpenResultNotification((payload) => calls.push(['open', payload]))
    unsubscribe()

    expect(calls).toEqual([
      ['list'],
      ['upsert', notification],
      ['mark-read', 'notification-run-1'],
      ['mark-all-read'],
      ['listen-open'],
      ['open', notification],
      ['unsubscribe-open'],
    ])
  })
})
