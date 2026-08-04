import { describe, expect, test } from 'bun:test'
import type { AgentEventEnvelopeV1 } from '@shared/types/agent'
import type { ResultNotification, ResultNotificationList } from '@shared/types/notifications'
import { createAgentMainSideEffects } from './agent-main-side-effects.ts'

function envelope(
  seq: number,
  durability: AgentEventEnvelopeV1['durability'],
  payload: AgentEventEnvelopeV1['payload'],
): AgentEventEnvelopeV1 {
  return {
    schemaVersion: 1,
    eventId: `seg-00000000-0000-0000-0000-000000000001:${seq}`,
    threadId: 'novel:stars',
    segmentId: 'seg-00000000-0000-0000-0000-000000000001',
    runId: 'run-1',
    seq,
    durability,
    occurredAt: payload.createdAt,
    payload,
  }
}

describe('agent main-process side effects', () => {
  test('evolves one notification through running/waiting/running/success and clears memory sync without renderer', async () => {
    const notifications = new Map<string, ResultNotification>()
    const statuses: string[] = []
    const nativeStatuses: string[] = []
    const cleared: Array<[string, number]> = []
    const list = (): ResultNotificationList => ({
      notifications: [...notifications.values()],
      totalCount: notifications.size,
      unreadCount: 0,
    })
    const handle = createAgentMainSideEffects({
      async upsertNotification(notification) {
        notifications.set(notification.id, notification)
        statuses.push(notification.status)
        return list()
      },
      async markNotificationRead(id, readAt) {
        const notification = notifications.get(id)
        if (notification) notifications.set(id, { ...notification, readAt })
        return list()
      },
      broadcastNotifications() {},
      showNativeNotification(notification) {
        nativeStatuses.push(notification.status)
      },
      resolveProjectName: async () => '长夜星河',
      async clearPendingMemorySync(projectPath, chapter) {
        cleared.push([projectPath, chapter])
      },
    })

    await handle(
      envelope(1, 'durable', {
        type: 'run.accepted',
        runId: 'run-1',
        command: 'sync-chapter-memory',
        visiblePrompt: '同步第 12 章记忆',
        selectedChapter: 12,
        createdAt: '2026-07-24T12:00:00.000Z',
      }),
    )
    await handle(
      envelope(2, 'transient', {
        type: 'run.started',
        runId: 'run-1',
        threadId: 'novel:stars',
        command: 'sync-chapter-memory',
        prompt: '12',
        projectPath: '/novels/stars',
        selectedChapter: 12,
        createdAt: '2026-07-24T12:00:00.000Z',
      }),
    )
    await handle(
      envelope(3, 'durable', {
        type: 'run.question-requested',
        runId: 'run-1',
        messageId: 'assistant-run-1',
        questionRequestId: 'question-1',
        toolCallId: 'question-1',
        questions: [
          {
            header: '确认',
            question: '继续同步？',
            options: [
              { label: '继续', description: '继续' },
              { label: '停止', description: '停止' },
            ],
          },
        ],
        createdAt: '2026-07-24T12:01:00.000Z',
      }),
    )
    await handle(
      envelope(4, 'durable', {
        type: 'run.question-answered',
        runId: 'run-1',
        questionRequestId: 'question-1',
        answers: { '继续同步？': '继续' },
        createdAt: '2026-07-24T12:02:00.000Z',
      }),
    )
    await handle(
      envelope(5, 'durable', {
        type: 'run.completed',
        runId: 'run-1',
        assistantText: '同步完成。',
        createdAt: '2026-07-24T12:03:00.000Z',
      }),
    )

    expect(statuses).toEqual(['running', 'waiting', 'running', 'success'])
    expect(notifications.get('notification-run-1')).toMatchObject({
      runId: 'run-1',
      status: 'success',
      projectName: '长夜星河',
    })
    expect(nativeStatuses).toEqual(['waiting', 'success'])
    expect(cleared).toEqual([['/novels/stars', 12]])
  })

  test('creates a generic interrupted notification during startup reconciliation', async () => {
    let notification: ResultNotification | undefined
    const handle = createAgentMainSideEffects({
      async upsertNotification(next) {
        notification = next
        return { notifications: [next], totalCount: 1, unreadCount: 1 }
      },
      async markNotificationRead() {
        return { notifications: [], totalCount: 0, unreadCount: 0 }
      },
      broadcastNotifications() {},
      showNativeNotification() {},
      resolveProjectName: async () => 'unused',
      clearPendingMemorySync: async () => {},
    })

    await handle(
      envelope(2, 'durable', {
        type: 'run.interrupted',
        runId: 'run-1',
        assistantText: '',
        error: 'App restarted',
        createdAt: '2026-07-24T12:03:00.000Z',
      }),
    )
    expect(notification).toMatchObject({
      status: 'interrupted',
      title: 'Agent 任务已中断',
      projectName: '未关联项目',
    })
  })

  test('runs memory clear and native notification even when notification persistence keeps failing', async () => {
    let upsertAttempts = 0
    let nativeAttempts = 0
    const cleared: Array<[string, number]> = []
    const handle = createAgentMainSideEffects({
      async upsertNotification() {
        upsertAttempts += 1
        throw new Error('notification store unavailable')
      },
      async markNotificationRead() {
        return { notifications: [], totalCount: 0, unreadCount: 0 }
      },
      broadcastNotifications() {},
      showNativeNotification() {
        nativeAttempts += 1
      },
      resolveProjectName: async () => '长夜星河',
      async clearPendingMemorySync(projectPath, chapter) {
        cleared.push([projectPath, chapter])
      },
    })

    await handle(
      envelope(1, 'durable', {
        type: 'run.accepted',
        runId: 'run-1',
        command: 'sync-chapter-memory',
        visiblePrompt: '同步第 12 章记忆',
        selectedChapter: 12,
        createdAt: '2026-07-24T12:00:00.000Z',
      }),
    )
    await handle(
      envelope(2, 'transient', {
        type: 'run.started',
        runId: 'run-1',
        threadId: 'novel:stars',
        command: 'sync-chapter-memory',
        prompt: '12',
        projectPath: '/novels/stars',
        selectedChapter: 12,
        createdAt: '2026-07-24T12:00:00.000Z',
      }),
    ).catch(() => undefined)

    await expect(
      handle(
        envelope(3, 'durable', {
          type: 'run.completed',
          runId: 'run-1',
          assistantText: '同步完成。',
          createdAt: '2026-07-24T12:03:00.000Z',
        }),
      ),
    ).rejects.toThrow('副作用未全部完成')

    expect(upsertAttempts).toBe(4)
    expect(cleared).toEqual([['/novels/stars', 12]])
    expect(nativeAttempts).toBe(1)
  })
})
