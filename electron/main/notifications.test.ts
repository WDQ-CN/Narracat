import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listResultNotifications,
  markAllResultNotificationsRead,
  markResultNotificationRead,
  notificationsPath,
  upsertResultNotification,
} from './notifications'
import type { ResultNotification } from '@shared/types/notifications'

function timeForIndex(index: number): string {
  return new Date(Date.UTC(2026, 4, 22, 0, index)).toISOString()
}

function notification(index: number): ResultNotification {
  const runId = `run-${index}`
  return {
    id: `notification-${runId}`,
    runId,
    threadId: 'thread-1',
    status: index % 2 === 0 ? 'success' : 'failed',
    title: `通知 ${index}`,
    summary: index % 2 === 0 ? 'Agent 已完成任务。' : 'Agent 运行失败，已保留可用上下文。',
    projectName: '长夜星河',
    projectPath: '/novels/stars',
    createdAt: timeForIndex(index),
    updatedAt: timeForIndex(index),
  }
}

describe('result notification persistence', () => {
  test('stores app-level notifications under userData and persists across reads', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'narracat-notifications-'))
    const storePath = notificationsPath(userData)

    await upsertResultNotification(storePath, notification(1))
    await upsertResultNotification(storePath, notification(2))

    const persisted = JSON.parse(await readFile(storePath, 'utf-8')) as { notifications: ResultNotification[] }
    expect(persisted.notifications).toHaveLength(2)

    const listed = await listResultNotifications(storePath)
    expect(listed.notifications.map((item) => item.runId)).toEqual(['run-2', 'run-1'])
    expect(listed.unreadCount).toBe(2)
  })

  test(
    'keeps only 100 local notifications and lists the latest 20 by default',
    async () => {
      const userData = await mkdtemp(join(tmpdir(), 'narracat-notifications-cap-'))
      const storePath = notificationsPath(userData)

      for (let index = 1; index <= 101; index += 1) {
        await upsertResultNotification(storePath, notification(index))
      }

      const listed = await listResultNotifications(storePath)
      expect(listed.notifications).toHaveLength(20)
      expect(listed.notifications[0]?.runId).toBe('run-101')
      expect(listed.notifications.at(-1)?.runId).toBe('run-82')
      expect(listed.totalCount).toBe(100)
    },
    // 101 次真实顺序读改写文件 I/O，本机 <100ms，但在 GitHub Actions ubuntu runner 上
    // 实测偶发撞上 bun 默认 5000ms 超时（磁盘 I/O 延迟波动，非逻辑问题）——放宽到 20s
    // 给慢速/抖动环境留够余量，不改变断言本身。
    20_000,
  )

  test('marks one notification and all notifications as read', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'narracat-notifications-read-'))
    const storePath = notificationsPath(userData)
    await upsertResultNotification(storePath, notification(1))
    await upsertResultNotification(storePath, notification(2))

    const oneRead = await markResultNotificationRead(storePath, 'notification-run-1', '2026-05-22T10:00:00.000Z')
    expect(oneRead.unreadCount).toBe(1)
    expect(oneRead.notifications.find((item) => item.id === 'notification-run-1')?.readAt).toBe(
      '2026-05-22T10:00:00.000Z',
    )

    const allRead = await markAllResultNotificationsRead(storePath, '2026-05-22T10:01:00.000Z')
    expect(allRead.unreadCount).toBe(0)
    expect(allRead.totalCount).toBe(2)
  })

  test('persists waiting confirmation notifications with their question anchor', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'narracat-notifications-waiting-'))
    const storePath = notificationsPath(userData)

    await upsertResultNotification(storePath, {
      ...notification(1),
      status: 'waiting',
      title: 'Agent 等待你确认',
      summary: '主角接下来应该公开身份还是继续隐藏？',
      questionRequestId: 'question-run-1',
    })

    const listed = await listResultNotifications(storePath)
    expect(listed.notifications[0]).toMatchObject({
      id: 'notification-run-1',
      status: 'waiting',
      questionRequestId: 'question-run-1',
    })
  })

  test('serializes concurrent mutations atomically and excludes running/cancelling from unread count', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'narracat-notifications-concurrent-'))
    const storePath = notificationsPath(userData)
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        upsertResultNotification(storePath, {
          ...notification(index + 1),
          status: index % 2 === 0 ? 'running' : 'success',
        }),
      ),
    )
    const listed = await listResultNotifications(storePath)
    expect(listed.totalCount).toBe(40)
    expect(listed.unreadCount).toBe(20)
    const persisted = await readFile(storePath, 'utf8')
    expect(() => JSON.parse(persisted)).not.toThrow()
  })

  test('persists direct-href notifications without a project (e.g. pack-learn drafts, 刀4 终审 follow-up)', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'narracat-notifications-href-'))
    const storePath = notificationsPath(userData)

    await upsertResultNotification(storePath, {
      id: 'notification-pack-learn-draft-9',
      runId: 'pack-learn-draft-9',
      threadId: 'pack-learn-draft-9',
      status: 'success',
      title: '《试书》学完了',
      summary: '留下 4 张卡',
      projectName: '试书',
      href: '/settings?section=packs&sub=draft:draft-9',
      createdAt: timeForIndex(1),
      updatedAt: timeForIndex(1),
    })

    const listed = await listResultNotifications(storePath)
    expect(listed.notifications[0]).toMatchObject({
      href: '/settings?section=packs&sub=draft:draft-9',
    })
    expect(listed.notifications[0]).not.toHaveProperty('projectPath')
  })
})
