import { afterEach, describe, expect, test } from 'bun:test'
import { openResultNotification, resolveResultNotificationHref } from './result-notification-navigation'
import { useAgentStore } from './agent-store'
import type { NovelProjectDetail } from '@shared/types/novel'
import type { ResultNotification } from '@shared/types/notifications'

const originalWindow = globalThis.window

const project: NovelProjectDetail = {
  id: 'stars',
  title: '长夜星河',
  genre: '玄幻',
  coverPreset: 'cover-01',
  path: '/novels/stars',
  status: 'ready',
  chapterProgress: '12 / 30 章',
  wordCountLabel: '24000 字',
  tocItems: [],
  treeItems: [
    { id: 'master-outline', kind: 'master-outline', title: '全书大纲', level: 0, exists: true },
    { id: 'chapter-12', kind: 'chapter', title: '第 12 章', level: 1, chapterNumber: 12, exists: true },
  ],
}

const notification: ResultNotification = {
  id: 'notification-run-1',
  runId: 'run-1',
  threadId: 'thread-1',
  status: 'waiting',
  title: 'Agent 等待你确认',
  summary: '主角接下来应该公开身份还是继续隐藏？',
  projectName: '长夜星河',
  projectPath: '/novels/stars',
  target: {
    sectionId: 'blueprint',
    tabId: 'chapter-12',
    objectId: 'chapter-12',
  },
  questionRequestId: 'question-run-1',
  createdAt: '2026-05-23T12:00:00.000Z',
  updatedAt: '2026-05-23T12:01:00.000Z',
}

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
  useAgentStore.getState().resetAgentState()
})

describe('result notification navigation', () => {
  test('opens a notification target, marks it read, and focuses the question card anchor', async () => {
    const calls: unknown[] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          getNovelProject: async (projectPath: string) => {
            calls.push(['project', projectPath])
            return project
          },
          markResultNotificationRead: async (id: string) => {
            calls.push(['mark-read', id])
            return { notifications: [], totalCount: 1, unreadCount: 0 }
          },
        },
      },
    })

    await openResultNotification({
      notification,
      navigate: (href) => calls.push(['navigate', href]),
      notify: (message) => calls.push(['notify', message]),
    })

    expect(calls).toEqual([
      ['mark-read', 'notification-run-1'],
      ['project', '/novels/stars'],
      ['navigate', '/workbench?project=%2Fnovels%2Fstars&object=chapter-12'],
    ])
    expect(useAgentStore.getState().focusedQuestionRequestIdsByThreadId['thread-1']).toBe('question-run-1')
  })

  test('当通知自带 href（如刀4 学习通知，产物不挂在小说工作台对象上）时直接用它，不查项目', async () => {
    const calls: unknown[] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          getNovelProject: async (projectPath: string) => {
            calls.push(['project', projectPath])
            return project
          },
        },
      },
    })

    const href = await resolveResultNotificationHref({
      ...notification,
      projectPath: undefined,
      target: undefined,
      href: '/settings?section=packs&sub=draft:draft-9',
    })

    expect(href).toEqual({ href: '/settings?section=packs&sub=draft:draft-9' })
    expect(calls).toEqual([])
  })

  test('recovers a project route from durable thread identity after a cold-start interruption', async () => {
    const calls: unknown[] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          listNovelProjects: async () => [project],
          getNovelProject: async (projectPath: string) => {
            calls.push(['project', projectPath])
            return project
          },
        },
      },
    })

    const destination = await resolveResultNotificationHref({
      ...notification,
      threadId: 'novel:stars',
      projectName: '未关联项目',
      projectPath: undefined,
      target: undefined,
      status: 'interrupted',
    })

    expect(destination).toEqual({ href: '/workbench?project=%2Fnovels%2Fstars' })
    expect(calls).toEqual([['project', '/novels/stars']])
  })

  test('loads an interrupted run from its sealed segment before navigating to the task card', async () => {
    useAgentStore.getState().replaceThreadFromSnapshot({
      schemaVersion: 1,
      threadId: 'thread-1',
      segmentId: 'segment-current',
      lastSeq: 1,
      contextAvailable: false,
      projectRevision: 0,
      history: [],
      activeRun: null,
      lastRun: null,
    })
    const calls: unknown[] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          getNovelProject: async () => project,
          markResultNotificationRead: async () => ({
            notifications: [],
            totalCount: 1,
            unreadCount: 0,
          }),
          getAgentThreadSnapshot: async (input: { threadId: string; segmentId?: string }) => {
            calls.push(['snapshot', input])
            return {
              schemaVersion: 1,
              threadId: 'thread-1',
              segmentId: 'segment-before-restart',
              lastSeq: 4,
              contextAvailable: false,
              projectRevision: 0,
              history: [
                {
                  id: 'user-run-1',
                  role: 'user',
                  status: 'complete',
                  createdAt: notification.createdAt,
                  parts: [{ id: 'part-user-run-1', type: 'text', text: '写下一章', status: 'complete' }],
                },
              ],
              activeRun: null,
              lastRun: {
                id: 'run-1',
                threadId: 'thread-1',
                command: 'write-next',
                prompt: '写下一章',
                status: 'interrupted',
                startedAt: notification.createdAt,
                finishedAt: notification.updatedAt,
              },
            }
          },
        },
      },
    })

    await openResultNotification({
      notification: { ...notification, status: 'interrupted', segmentId: 'segment-before-restart' },
      navigate: (href) => calls.push(['navigate', href]),
    })

    expect(calls[0]).toEqual([
      'snapshot',
      { threadId: 'thread-1', segmentId: 'segment-before-restart' },
    ])
    expect(useAgentStore.getState().threadsById['thread-1']?.lastRun).toMatchObject({
      id: 'run-1',
      status: 'interrupted',
    })
  })
})
