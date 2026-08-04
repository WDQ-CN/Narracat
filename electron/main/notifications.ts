import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  createResultNotificationList,
  reduceResultNotifications,
} from '@shared/lib/result-notifications'
import type { ResultNotification, ResultNotificationList } from '@shared/types/notifications'
import { atomicWriteFile } from './atomic-write.ts'

interface ResultNotificationFile {
  notifications: ResultNotification[]
}

const notificationMutationQueues = new Map<string, Promise<void>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readTarget(value: unknown): ResultNotification['target'] | undefined {
  if (!isRecord(value)) return undefined
  const sectionId = readString(value, 'sectionId')
  const tabId = readString(value, 'tabId')
  const objectId = readString(value, 'objectId')
  return sectionId && tabId && objectId ? { sectionId, tabId, objectId } : undefined
}

export function normalizeResultNotification(value: unknown): ResultNotification | null {
  if (!isRecord(value)) return null

  const id = readString(value, 'id')
  const runId = readString(value, 'runId')
  const threadId = readString(value, 'threadId')
  const status =
    value.status === 'running' ||
    value.status === 'waiting' ||
    value.status === 'cancelling' ||
    value.status === 'success' ||
    value.status === 'failed' ||
    value.status === 'interrupted'
      ? value.status
      : undefined
  const title = readString(value, 'title')
  const summary = readString(value, 'summary')
  const projectName = readString(value, 'projectName')
  const createdAt = readString(value, 'createdAt')
  const updatedAt = readString(value, 'updatedAt')

  if (!id || !runId || !threadId || !status || !title || !summary || !projectName || !createdAt || !updatedAt) {
    return null
  }

  const notification: ResultNotification = {
    id,
    runId,
    threadId,
    status,
    title,
    summary,
    projectName,
    createdAt,
    updatedAt,
  }
  const projectPath = readString(value, 'projectPath')
  const segmentId = readString(value, 'segmentId')
  const command = readString(value, 'command')
  const target = readTarget(value.target)
  const href = readString(value, 'href')
  const questionRequestId = readString(value, 'questionRequestId')
  const readAt = readString(value, 'readAt')
  if (projectPath) notification.projectPath = projectPath
  if (segmentId) notification.segmentId = segmentId
  if (command) notification.command = command as ResultNotification['command']
  if (target) notification.target = target
  if (href) notification.href = href
  if (questionRequestId) notification.questionRequestId = questionRequestId
  if (readAt) notification.readAt = readAt

  return notification
}

function normalizeNotificationFile(value: unknown): ResultNotificationFile {
  if (!isRecord(value) || !Array.isArray(value.notifications)) return { notifications: [] }
  return {
    notifications: value.notifications.flatMap((item) => {
      const normalized = normalizeResultNotification(item)
      return normalized ? [normalized] : []
    }),
  }
}

export function notificationsPath(userDataPath: string): string {
  return join(userDataPath, 'result-notifications.json')
}

async function readNotificationFile(storePath: string): Promise<ResultNotificationFile> {
  try {
    return normalizeNotificationFile(JSON.parse(await readFile(storePath, 'utf-8')))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { notifications: [] }
    throw error
  }
}

async function writeNotificationFile(storePath: string, notifications: ResultNotification[]): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true })
  await atomicWriteFile(storePath, `${JSON.stringify({ notifications }, null, 2)}\n`)
}

function mutateNotifications(
  storePath: string,
  mutation: (notifications: ResultNotification[]) => ResultNotification[],
): Promise<ResultNotificationList> {
  const previous = notificationMutationQueues.get(storePath) ?? Promise.resolve()
  let payload!: ResultNotificationList
  const current = previous.catch(() => undefined).then(async () => {
    const file = await readNotificationFile(storePath)
    const notifications = mutation(file.notifications)
    await writeNotificationFile(storePath, notifications)
    payload = createResultNotificationList(notifications)
  })
  notificationMutationQueues.set(storePath, current)
  return current
    .then(() => payload)
    .finally(() => {
      if (notificationMutationQueues.get(storePath) === current) notificationMutationQueues.delete(storePath)
    })
}

export async function listResultNotifications(storePath: string): Promise<ResultNotificationList> {
  await (notificationMutationQueues.get(storePath) ?? Promise.resolve()).catch(() => undefined)
  const file = await readNotificationFile(storePath)
  return createResultNotificationList(file.notifications)
}

export async function upsertResultNotification(
  storePath: string,
  input: unknown,
): Promise<ResultNotificationList> {
  const notification = normalizeResultNotification(input)
  if (!notification) throw new Error('通知参数非法。')

  return mutateNotifications(storePath, (notifications) =>
    reduceResultNotifications(notifications, { type: 'upsert', notification }),
  )
}

export async function markResultNotificationRead(
  storePath: string,
  id: string,
  readAt = new Date().toISOString(),
): Promise<ResultNotificationList> {
  return mutateNotifications(storePath, (notifications) =>
    reduceResultNotifications(notifications, { type: 'mark-read', id, readAt }),
  )
}

export async function markAllResultNotificationsRead(
  storePath: string,
  readAt = new Date().toISOString(),
): Promise<ResultNotificationList> {
  return mutateNotifications(storePath, (notifications) =>
    reduceResultNotifications(notifications, { type: 'mark-all-read', readAt }),
  )
}
