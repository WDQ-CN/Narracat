import { describe, expect, test } from 'bun:test'
import {
  createPackLearnResultNotificationDraft,
  createQuestionNotificationDraft,
  createResultNotificationDraft,
  getRecentResultNotifications,
  reduceResultNotifications,
  resultNotificationIdForRun,
} from './result-notifications'
import type { AgentRun } from '@shared/types/agent'
import type { PackLearnResult, PackLearnSource } from '@shared/types/capability-pack'
import type { ResultNotification } from '@shared/types/notifications'

const baseRun: AgentRun = {
  id: 'run-1',
  threadId: 'thread-1',
  command: 'write-next',
  prompt: '继续写第 12 章',
  status: 'complete',
  startedAt: '2026-05-22T15:00:00.000Z',
  finishedAt: '2026-05-22T15:10:00.000Z',
  projectPath: '/novels/stars',
  selectedChapter: 12,
  target: {
    sectionId: 'blueprint',
    tabId: 'chapter-12',
    objectId: 'chapter-12',
  },
}

function timeForIndex(index: number): string {
  return new Date(Date.UTC(2026, 4, 22, 0, index)).toISOString()
}

function makeNotification(overrides: Partial<ResultNotification> = {}): ResultNotification {
  return {
    id: 'notification-run-1',
    runId: 'run-1',
    threadId: 'thread-1',
    status: 'running',
    title: 'Agent 正在执行任务',
    summary: '任务正在后台执行。',
    projectName: '长夜星河',
    createdAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-24T12:00:00.000Z',
    ...overrides,
  }
}

describe('result notification helpers', () => {
  test('creates a successful chapter notification summary from run context', () => {
    const draft = createResultNotificationDraft({
      run: baseRun,
      status: 'success',
      projectName: '长夜星河',
      occurredAt: '2026-05-22T15:10:00.000Z',
    })

    expect(draft).toMatchObject({
      runId: 'run-1',
      threadId: 'thread-1',
      status: 'success',
      title: '第 12 章正文已生成',
      summary: 'Agent 已完成章节正文生成。',
      projectName: '长夜星河',
      projectPath: '/novels/stars',
      target: {
        sectionId: 'blueprint',
        tabId: 'chapter-12',
        objectId: 'chapter-12',
      },
    })
  })

  test('creates a failed notification without leaking long error output', () => {
    const draft = createResultNotificationDraft({
      run: {
        ...baseRun,
        id: 'run-2',
        command: 'world',
        status: 'failed',
        target: {
          sectionId: 'settings',
          tabId: 'world',
          objectId: 'world',
        },
      },
      status: 'failed',
      projectName: '星门',
      occurredAt: '2026-05-22T16:00:00.000Z',
      error:
        'Error: tool failed\n    at long stack frame\n    at another stack frame\nFull output: '.repeat(20),
    })

    expect(draft.title).toBe('世界观设定生成失败')
    expect(draft.summary).toBe('Agent 运行失败，已保留可用上下文。')
    expect(JSON.stringify(draft)).not.toContain('long stack frame')
    expect(JSON.stringify(draft)).not.toContain('Full output')
  })

  test('creates a waiting confirmation notification from question context', () => {
    const draft = createQuestionNotificationDraft({
      run: { ...baseRun, status: 'running', finishedAt: undefined },
      projectName: '长夜星河',
      occurredAt: '2026-05-22T15:04:00.000Z',
      questionRequestId: 'question-run-1',
      questions: [
        {
          header: '走向',
          question: '主角接下来应该公开身份还是继续隐藏？',
          options: [
            { label: '公开', description: '推进正面对抗' },
            { label: '隐藏', description: '保留悬念' },
          ],
        },
      ],
    })

    expect(draft).toMatchObject({
      id: 'notification-run-1',
      runId: 'run-1',
      threadId: 'thread-1',
      status: 'waiting',
      title: 'Agent 等待你确认',
      summary: '主角接下来应该公开身份还是继续隐藏？',
      projectName: '长夜星河',
      projectPath: '/novels/stars',
      questionRequestId: 'question-run-1',
      target: {
        sectionId: 'blueprint',
        tabId: 'chapter-12',
        objectId: 'chapter-12',
      },
      createdAt: '2026-05-22T15:04:00.000Z',
      updatedAt: '2026-05-22T15:04:00.000Z',
    })
    expect(draft.readAt).toBeUndefined()
  })

  test('evolves a waiting notification into the final run result without duplicating or staying read', () => {
    const waiting = createQuestionNotificationDraft({
      run: { ...baseRun, status: 'running', finishedAt: undefined },
      projectName: '长夜星河',
      occurredAt: '2026-05-22T15:04:00.000Z',
      questionRequestId: 'question-run-1',
      questions: [
        {
          header: '走向',
          question: '主角接下来应该公开身份还是继续隐藏？',
          options: [
            { label: '公开', description: '推进正面对抗' },
            { label: '隐藏', description: '保留悬念' },
          ],
        },
      ],
    })
    const readWaiting = reduceResultNotifications([waiting], {
      type: 'mark-read',
      id: resultNotificationIdForRun(baseRun.id),
      readAt: '2026-05-22T15:05:00.000Z',
    })
    expect(readWaiting[0]?.readAt).toBe('2026-05-22T15:05:00.000Z')

    const finalNotification = createResultNotificationDraft({
      run: baseRun,
      status: 'success',
      projectName: '长夜星河',
      occurredAt: '2026-05-22T15:10:00.000Z',
    })
    const evolved = reduceResultNotifications(readWaiting, { type: 'upsert', notification: finalNotification })

    expect(evolved).toHaveLength(1)
    expect(evolved[0]).toMatchObject({
      id: 'notification-run-1',
      runId: 'run-1',
      status: 'success',
      title: '第 12 章正文已生成',
      createdAt: '2026-05-22T15:04:00.000Z',
      updatedAt: '2026-05-22T15:10:00.000Z',
    })
    expect(evolved[0]?.readAt).toBeUndefined()
  })

  test('keeps the persisted project route when restart reconciliation only knows a generic interrupted run', () => {
    const running = makeNotification({
      status: 'running',
      projectName: '星河',
      projectPath: '/novels/stars',
      segmentId: 'segment-before-restart',
      target: { sectionId: 'blueprint', tabId: 'chapter-1', objectId: 'chapter-1' },
    })
    const interrupted = makeNotification({
      status: 'interrupted',
      projectName: '未关联项目',
      projectPath: undefined,
      segmentId: undefined,
      target: undefined,
      updatedAt: '2026-07-24T13:00:00.000Z',
    })

    expect(
      reduceResultNotifications([running], { type: 'upsert', notification: interrupted })[0],
    ).toMatchObject({
      status: 'interrupted',
      projectName: '星河',
      projectPath: '/novels/stars',
      segmentId: 'segment-before-restart',
      target: { sectionId: 'blueprint', tabId: 'chapter-1', objectId: 'chapter-1' },
    })
  })

  test('upserts by run id, keeps newest first, and caps local history at 100 items', () => {
    const notifications = Array.from({ length: 101 }, (_, index): ResultNotification => {
      const runId = `run-${index + 1}`
      return {
        id: `notification-${runId}`,
        runId,
        threadId: 'thread-1',
        status: 'success',
        title: `通知 ${index + 1}`,
        summary: 'Agent 已完成任务。',
        projectName: '长夜星河',
        projectPath: '/novels/stars',
        createdAt: timeForIndex(index),
        updatedAt: timeForIndex(index),
      }
    }).reduce((items, notification) => reduceResultNotifications(items, { type: 'upsert', notification }), [])

    expect(notifications).toHaveLength(100)
    expect(notifications[0]?.runId).toBe('run-101')
    expect(notifications.at(-1)?.runId).toBe('run-2')
    expect(getRecentResultNotifications(notifications)).toHaveLength(20)

    const updated = reduceResultNotifications(notifications, {
      type: 'upsert',
      notification: {
        ...notifications[50]!,
        status: 'failed',
        title: '更新后的失败通知',
        updatedAt: '2026-05-22T10:00:00.000Z',
      },
    })

    expect(updated).toHaveLength(100)
    expect(updated[0]).toMatchObject({
      status: 'failed',
      title: '更新后的失败通知',
    })
  })

  test('keeps active and waiting tasks above newer terminal results', () => {
    const notifications = [
      makeNotification({
        id: 'notification-success',
        runId: 'run-success',
        status: 'success',
        updatedAt: '2026-07-24T12:05:00.000Z',
      }),
      makeNotification({
        id: 'notification-running',
        runId: 'run-running',
        status: 'running',
        updatedAt: '2026-07-24T12:01:00.000Z',
      }),
      makeNotification({
        id: 'notification-waiting',
        runId: 'run-waiting',
        status: 'waiting',
        updatedAt: '2026-07-24T12:02:00.000Z',
      }),
    ]

    expect(getRecentResultNotifications(notifications).map((item) => item.runId)).toEqual([
      'run-waiting',
      'run-running',
      'run-success',
    ])
  })

  test('marks single and all notifications as read without clearing panel history', () => {
    const unread: ResultNotification[] = [
      {
        id: 'notification-run-1',
        runId: 'run-1',
        threadId: 'thread-1',
        status: 'success',
        title: '第 1 章正文已生成',
        summary: 'Agent 已完成章节正文生成。',
        projectName: '长夜星河',
        projectPath: '/novels/stars',
        createdAt: '2026-05-22T15:10:00.000Z',
        updatedAt: '2026-05-22T15:10:00.000Z',
      },
      {
        id: 'notification-run-2',
        runId: 'run-2',
        threadId: 'thread-1',
        status: 'failed',
        title: '世界观设定生成失败',
        summary: 'Agent 运行失败，已保留可用上下文。',
        projectName: '星门',
        projectPath: '/novels/stars',
        createdAt: '2026-05-22T16:00:00.000Z',
        updatedAt: '2026-05-22T16:00:00.000Z',
      },
    ]

    const oneRead = reduceResultNotifications(unread, {
      type: 'mark-read',
      id: 'notification-run-1',
      readAt: '2026-05-22T16:10:00.000Z',
    })
    expect(oneRead.find((item) => item.id === 'notification-run-1')?.readAt).toBe('2026-05-22T16:10:00.000Z')
    expect(oneRead.find((item) => item.id === 'notification-run-1')?.updatedAt).toBe('2026-05-22T15:10:00.000Z')
    expect(oneRead.find((item) => item.id === 'notification-run-2')?.readAt).toBeUndefined()

    const allRead = reduceResultNotifications(oneRead, {
      type: 'mark-all-read',
      readAt: '2026-05-22T16:11:00.000Z',
    })
    expect(allRead).toHaveLength(2)
    expect(allRead.every((item) => item.readAt)).toBe(true)
    expect(allRead.find((item) => item.id === 'notification-run-2')?.updatedAt).toBe('2026-05-22T16:00:00.000Z')
  })
})

describe('pack learn result notification draft（刀4 终审 follow-up：学习终态接全局通知）', () => {
  const novelSource: PackLearnSource = { kind: 'novel', projectPath: '/novels/p1', title: '试书' }
  const txtSource: PackLearnSource = { kind: 'txt', filePath: '/tmp/x.txt', title: '别的书' }

  test('成功：标题带书名，摘要带留下的卡数，路由直达该草稿，不挂 projectPath（学习产物不是工作台对象）', () => {
    const result: PackLearnResult = { status: 'ok', draftId: 'draft-9', report: { cardsKept: 4, cardsDropped: 1, chaptersSampled: 6 } }
    const draft = createPackLearnResultNotificationDraft({
      source: novelSource,
      result,
      occurredAt: '2026-07-20T10:00:00.000Z',
    })

    expect(draft).toMatchObject({
      status: 'success',
      title: '《试书》学完了',
      summary: '留下 4 张卡',
      projectName: '试书',
      href: '/settings?section=packs&sub=draft%3Adraft-9',
    })
    expect(draft.projectPath).toBeUndefined()
    expect(draft.target).toBeUndefined()
  })

  test('失败：标题带书名，摘要是失败原因，路由落到草稿列表（没有具体草稿可去）', () => {
    const result: PackLearnResult = { status: 'error', message: '读不出这本书的正文。' }
    const draft = createPackLearnResultNotificationDraft({
      source: txtSource,
      result,
      occurredAt: '2026-07-20T10:00:00.000Z',
    })

    expect(draft).toMatchObject({
      status: 'failed',
      title: '《别的书》这次没学成',
      summary: '读不出这本书的正文。',
      projectName: '别的书',
      href: '/settings?section=packs&sub=creations',
    })
  })

  test('失败原因过长时截断，不把整段异常糊给用户', () => {
    const longMessage = '学出来的卡都太贴原文了，'.repeat(20)
    const draft = createPackLearnResultNotificationDraft({
      source: novelSource,
      result: { status: 'error', message: longMessage },
      occurredAt: '2026-07-20T10:00:00.000Z',
    })

    expect(draft.summary.length).toBeLessThan(longMessage.length)
    expect(draft.summary.endsWith('...')).toBe(true)
  })

  test('同一条终态调用两次，产出的 id/runId 完全一致（幂等：重复上报只会 upsert 覆盖，不会在通知列表里长出第二条）', () => {
    const result: PackLearnResult = { status: 'ok', draftId: 'draft-9', report: { cardsKept: 4, cardsDropped: 1, chaptersSampled: 6 } }
    const first = createPackLearnResultNotificationDraft({ source: novelSource, result, occurredAt: '2026-07-20T10:00:00.000Z' })
    const second = createPackLearnResultNotificationDraft({ source: novelSource, result, occurredAt: '2026-07-20T10:05:00.000Z' })

    expect(second.id).toBe(first.id)
    expect(second.runId).toBe(first.runId)

    const merged = reduceResultNotifications([], { type: 'upsert', notification: first })
    const stillOne = reduceResultNotifications(merged, { type: 'upsert', notification: second })
    expect(stillOne).toHaveLength(1)
    expect(stillOne[0]?.updatedAt).toBe('2026-07-20T10:05:00.000Z')
  })
})
