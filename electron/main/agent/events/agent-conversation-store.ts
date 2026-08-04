import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AgentEventEnvelopeV1,
  AgentHistorySegmentSummaryV1,
  AgentThreadSnapshotV1,
} from '@shared/types/agent'
import type { AgentDurableEventV1, AgentThread } from '@shared/types/agent'
import { atomicWriteFile } from '../../atomic-write.ts'
import {
  createEmptyDurableAgentThread,
  reduceAgentDurableEvent,
} from '@shared/lib/agent-durable-events'

const SCHEMA_VERSION = 1
const SEGMENT_ID_PATTERN = /^seg-[a-f0-9-]{36}$/
const EVENT_FILE_PATTERN = /^(\d{12})\.json$/

interface ThreadIndexV1 {
  schemaVersion: 1
  threadId: string
  segmentIds: string[]
  activeSegmentId: string
  hasUnreadableHistory?: boolean
}

interface SegmentManifestV1 {
  schemaVersion: 1
  threadId: string
  segmentId: string
  createdAt: string
  sealedAt?: string
  lastDurableSeq: number
}

interface SegmentProjectionV1 {
  schemaVersion: 1
  threadId: string
  segmentId: string
  lastSeq: number
  thread: AgentThread
}

interface LoadedSegment {
  manifest: SegmentManifestV1
  projection: SegmentProjectionV1
}

export interface AgentConversationStore {
  ensureActiveSegment: (threadId: string) => Promise<LoadedSegment>
  appendDurableEvent: (envelope: AgentEventEnvelopeV1) => Promise<AgentThreadSnapshotV1>
  getThreadSnapshot: (threadId: string, segmentId?: string) => Promise<AgentThreadSnapshotV1>
  listHistorySegments: (threadId: string) => Promise<AgentHistorySegmentSummaryV1[]>
  startNewConversation: (threadId: string, occurredAt: string) => Promise<AgentThreadSnapshotV1>
  listThreadIds: () => Promise<string[]>
  hasAvailableSessionContext?: (threadId: string) => Promise<boolean>
}

export interface AgentConversationStoreOptions {
  rootDir: string
  now?: () => string
  createSegmentId?: () => string
  writeAtomically?: typeof atomicWriteFile
  onCacheWriteError?: (error: unknown, context: { threadId: string; segmentId: string }) => void
}

function unsupportedAgentHistorySchemaError(): Error {
  const error = new Error('当前 Agent 历史由更新版本的 NarraCat 创建，请先更新 App。')
  error.name = 'UnsupportedAgentHistorySchemaError'
  return error
}

function isUnsupportedAgentHistorySchemaError(error: unknown): boolean {
  return error instanceof Error && error.name === 'UnsupportedAgentHistorySchemaError'
}

function agentHistoryCorruptionError(message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.name = 'AgentHistoryCorruptionError'
  return error
}

function isAgentHistoryCorruptionError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AgentHistoryCorruptionError'
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

function isMalformedJsonError(error: unknown): boolean {
  return error instanceof SyntaxError
}

function threadKey(threadId: string): string {
  if (
    !threadId ||
    threadId.length > 256 ||
    /[\\/\u0000-\u001f]/.test(threadId) ||
    /%(?:2f|5c)/i.test(threadId)
  ) {
    throw new Error('Agent threadId 参数非法。')
  }
  return createHash('sha256').update(threadId, 'utf8').digest('hex')
}

export function agentConversationThreadDir(rootDir: string, threadId: string): string {
  return join(rootDir, 'agent-state', 'v1', 'threads', threadKey(threadId))
}

function segmentDir(rootDir: string, threadId: string, segmentId: string): string {
  return join(agentConversationThreadDir(rootDir, threadId), 'segments', segmentId)
}

function eventFileName(seq: number): string {
  return `${String(seq).padStart(12, '0')}.json`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertSupportedSchema(value: unknown): void {
  if (isRecord(value) && typeof value.schemaVersion === 'number' && value.schemaVersion > SCHEMA_VERSION) {
    throw unsupportedAgentHistorySchemaError()
  }
}

function isThreadIndex(value: unknown, threadId: string): value is ThreadIndexV1 {
  assertSupportedSchema(value)
  if (!isRecord(value)) return false
  return (
    value.schemaVersion === 1 &&
    value.threadId === threadId &&
    Array.isArray(value.segmentIds) &&
    value.segmentIds.every((segmentId) => typeof segmentId === 'string' && SEGMENT_ID_PATTERN.test(segmentId)) &&
    typeof value.activeSegmentId === 'string' &&
    SEGMENT_ID_PATTERN.test(value.activeSegmentId) &&
    value.segmentIds.includes(value.activeSegmentId)
  )
}

function isManifest(value: unknown, threadId: string, segmentId: string): value is SegmentManifestV1 {
  assertSupportedSchema(value)
  if (!isRecord(value)) return false
  return (
    value.schemaVersion === 1 &&
    value.threadId === threadId &&
    value.segmentId === segmentId &&
    typeof value.createdAt === 'string' &&
    (value.sealedAt === undefined || typeof value.sealedAt === 'string') &&
    typeof value.lastDurableSeq === 'number' &&
    Number.isSafeInteger(value.lastDurableSeq) &&
    value.lastDurableSeq >= 0
  )
}

function isDurablePayload(value: unknown): value is AgentDurableEventV1 {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.createdAt !== 'string') return false
  const hasRunId = () => typeof value.runId === 'string' && Boolean(value.runId)
  switch (value.type) {
    case 'conversation.segment-opened':
    case 'conversation.segment-sealed':
      return true
    case 'conversation.divider-added':
      return typeof value.dividerId === 'string' && Boolean(value.dividerId)
    case 'run.accepted':
      return (
        hasRunId() &&
        typeof value.command === 'string' &&
        typeof value.visiblePrompt === 'string' &&
        (value.origin === undefined || value.origin === 'action')
      )
    case 'run.tool-summarized':
      return (
        hasRunId() &&
        typeof value.messageId === 'string' &&
        typeof value.toolCallId === 'string' &&
        typeof value.toolName === 'string' &&
        typeof value.title === 'string' &&
        (value.status === 'complete' || value.status === 'failed') &&
        (value.summary === undefined || typeof value.summary === 'string') &&
        (value.error === undefined || typeof value.error === 'string')
      )
    case 'run.question-requested':
      return (
        hasRunId() &&
        typeof value.messageId === 'string' &&
        typeof value.questionRequestId === 'string' &&
        typeof value.toolCallId === 'string' &&
        Array.isArray(value.questions)
      )
    case 'run.question-answered':
      return hasRunId() && typeof value.questionRequestId === 'string' && isRecord(value.answers)
    case 'run.plan-finalized':
      return hasRunId() && Array.isArray(value.items)
    case 'run.completed':
      return hasRunId() && typeof value.assistantText === 'string'
    case 'run.failed':
      return hasRunId() && typeof value.assistantText === 'string' && typeof value.error === 'string'
    case 'run.cancelled':
      return hasRunId() && typeof value.assistantText === 'string'
    case 'run.interrupted':
      return hasRunId() && typeof value.assistantText === 'string' && typeof value.error === 'string'
    case 'session.context-established':
      return (
        (value.mode === 'direct' || value.mode === 'project-command') &&
        typeof value.compatibilityFingerprintHash === 'string'
      )
    case 'session.invalidated':
      return typeof value.reason === 'string'
    default:
      return false
  }
}

function isDurableEnvelope(
  value: unknown,
  threadId: string,
  segmentId: string,
  expectedSeq?: number,
): value is AgentEventEnvelopeV1 & { payload: AgentDurableEventV1 } {
  assertSupportedSchema(value)
  if (!isRecord(value)) return false
  const seq = value.seq
  return (
    value.schemaVersion === 1 &&
    value.threadId === threadId &&
    value.segmentId === segmentId &&
    typeof seq === 'number' &&
    Number.isSafeInteger(seq) &&
    seq > 0 &&
    (expectedSeq === undefined || seq === expectedSeq) &&
    value.eventId === `${segmentId}:${seq}` &&
    value.durability === 'durable' &&
    typeof value.occurredAt === 'string' &&
    isDurablePayload(value.payload)
  )
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function snapshotFrom(index: ThreadIndexV1, loaded: LoadedSegment, contextAvailable = false): AgentThreadSnapshotV1 {
  const segmentIndex = index.segmentIds.indexOf(loaded.manifest.segmentId)
  return {
    schemaVersion: 1,
    threadId: index.threadId,
    segmentId: loaded.manifest.segmentId,
    lastSeq: loaded.projection.lastSeq,
    contextAvailable,
    projectRevision: 0,
    history: loaded.projection.thread.messages,
    activeRun: loaded.projection.thread.activeRun,
    lastRun: loaded.projection.thread.lastRun,
    ...(segmentIndex > 0 ? { previousSegmentId: index.segmentIds[segmentIndex - 1] } : {}),
    ...(index.hasUnreadableHistory ? { hasUnreadableHistory: true } : {}),
  }
}

export function createAgentConversationStore(options: AgentConversationStoreOptions): AgentConversationStore {
  const rootDir = options.rootDir
  const now = options.now ?? (() => new Date().toISOString())
  const createSegmentId = options.createSegmentId ?? (() => `seg-${randomUUID()}`)
  const writeAtomically = options.writeAtomically ?? atomicWriteFile
  const queues = new Map<string, Promise<unknown>>()
  const loadedSegments = new Map<string, LoadedSegment>()

  function loadedSegmentKey(threadId: string, segmentId: string): string {
    return `${threadKey(threadId)}:${segmentId}`
  }

  function enqueue<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(threadId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    queues.set(threadId, current)
    return current.finally(() => {
      if (queues.get(threadId) === current) queues.delete(threadId)
    })
  }

  async function writeThreadIndex(index: ThreadIndexV1): Promise<void> {
    const path = join(agentConversationThreadDir(rootDir, index.threadId), 'thread.json')
    await mkdir(join(agentConversationThreadDir(rootDir, index.threadId), 'segments'), { recursive: true })
    await writeAtomically(path, serialize(index))
  }

  async function writeSegmentFiles(loaded: LoadedSegment): Promise<void> {
    const dir = segmentDir(rootDir, loaded.manifest.threadId, loaded.manifest.segmentId)
    await writeAtomically(join(dir, 'projection.json'), serialize(loaded.projection))
    await writeAtomically(join(dir, 'manifest.json'), serialize(loaded.manifest))
  }

  async function writeSegmentCacheFailSoft(loaded: LoadedSegment): Promise<void> {
    try {
      await writeSegmentFiles(loaded)
    } catch (error) {
      options.onCacheWriteError?.(error, {
        threadId: loaded.manifest.threadId,
        segmentId: loaded.manifest.segmentId,
      })
    }
  }

  async function createSegment(threadId: string, createdAt: string): Promise<LoadedSegment> {
    const segmentId = createSegmentId()
    if (!SEGMENT_ID_PATTERN.test(segmentId)) throw new Error('Agent segment id 生成失败。')
    const dir = segmentDir(rootDir, threadId, segmentId)
    await mkdir(join(dir, 'events'), { recursive: true })
    const opened: AgentDurableEventV1 = { type: 'conversation.segment-opened', createdAt }
    const envelope: AgentEventEnvelopeV1 = {
      schemaVersion: 1,
      eventId: `${segmentId}:1`,
      threadId,
      segmentId,
      seq: 1,
      durability: 'durable',
      occurredAt: createdAt,
      payload: opened,
    }
    await writeAtomically(join(dir, 'events', eventFileName(1)), serialize(envelope))
    const thread = reduceAgentDurableEvent(createEmptyDurableAgentThread(threadId), opened)
    const loaded: LoadedSegment = {
      manifest: {
        schemaVersion: 1,
        threadId,
        segmentId,
        createdAt,
        lastDurableSeq: 1,
      },
      projection: {
        schemaVersion: 1,
        threadId,
        segmentId,
        lastSeq: 1,
        thread,
      },
    }
    await writeSegmentFiles(loaded)
    loadedSegments.set(loadedSegmentKey(threadId, segmentId), loaded)
    return loaded
  }

  async function scanThreadIndex(threadId: string): Promise<ThreadIndexV1 | null> {
    const segmentsRoot = join(agentConversationThreadDir(rootDir, threadId), 'segments')
    let names: string[]
    try {
      names = await readdir(segmentsRoot)
    } catch (error) {
      if (isMissingFileError(error)) return null
      throw error
    }
    const manifests: SegmentManifestV1[] = []
    for (const segmentId of names.filter((name) => SEGMENT_ID_PATTERN.test(name))) {
      try {
        const value = await readJson(join(segmentsRoot, segmentId, 'manifest.json'))
        if (isManifest(value, threadId, segmentId)) manifests.push(value)
      } catch (error) {
        if (isUnsupportedAgentHistorySchemaError(error)) throw error
        if (!isMissingFileError(error) && !isMalformedJsonError(error)) throw error
      }
    }
    manifests.sort((left, right) => {
      const byCreatedAt = left.createdAt.localeCompare(right.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      if (Boolean(left.sealedAt) !== Boolean(right.sealedAt)) return left.sealedAt ? -1 : 1
      return left.segmentId.localeCompare(right.segmentId)
    })
    if (manifests.length === 0) return null
    const active = [...manifests].reverse().find((manifest) => !manifest.sealedAt) ?? manifests.at(-1)!
    return {
      schemaVersion: 1,
      threadId,
      segmentIds: manifests.map((manifest) => manifest.segmentId),
      activeSegmentId: active.segmentId,
    }
  }

  async function loadThreadIndex(threadId: string): Promise<ThreadIndexV1 | null> {
    const path = join(agentConversationThreadDir(rootDir, threadId), 'thread.json')
    try {
      const value = await readJson(path)
      if (isThreadIndex(value, threadId)) return value
    } catch (error) {
      if (isUnsupportedAgentHistorySchemaError(error)) throw error
      if (!isMissingFileError(error) && !isMalformedJsonError(error)) throw error
    }
    const rebuilt = await scanThreadIndex(threadId)
    if (rebuilt) await writeThreadIndex(rebuilt)
    return rebuilt
  }

  async function replaySegment(threadId: string, segmentId: string): Promise<LoadedSegment> {
    const dir = segmentDir(rootDir, threadId, segmentId)
    let manifestValue: unknown
    let names: string[]
    try {
      manifestValue = await readJson(join(dir, 'manifest.json'))
      names = (await readdir(join(dir, 'events'))).filter((name) => EVENT_FILE_PATTERN.test(name)).sort()
    } catch (error) {
      if (isUnsupportedAgentHistorySchemaError(error)) throw error
      if (!isMissingFileError(error) && !isMalformedJsonError(error)) throw error
      throw agentHistoryCorruptionError('Agent segment 文件缺失或损坏。', error)
    }
    if (!isManifest(manifestValue, threadId, segmentId)) {
      throw agentHistoryCorruptionError('Agent segment manifest 损坏。')
    }
    let thread = createEmptyDurableAgentThread(threadId)
    let lastSeq = 0
    for (const name of names) {
      const seq = Number(EVENT_FILE_PATTERN.exec(name)?.[1])
      let value: unknown
      try {
        value = await readJson(join(dir, 'events', name))
      } catch (error) {
        if (isUnsupportedAgentHistorySchemaError(error)) throw error
        if (!isMissingFileError(error) && !isMalformedJsonError(error)) throw error
        throw agentHistoryCorruptionError('Agent durable event 文件缺失或损坏。', error)
      }
      if (!isDurableEnvelope(value, threadId, segmentId, seq) || seq <= lastSeq) {
        throw agentHistoryCorruptionError('Agent durable event 损坏。')
      }
      thread = reduceAgentDurableEvent(thread, value.payload)
      lastSeq = seq
    }
    if (lastSeq === 0) throw agentHistoryCorruptionError('Agent segment 缺少事件。')
    const loaded: LoadedSegment = {
      manifest: { ...manifestValue, lastDurableSeq: lastSeq },
      projection: {
        schemaVersion: 1,
        threadId,
        segmentId,
        lastSeq,
        thread,
      },
    }
    await writeSegmentCacheFailSoft(loaded)
    loadedSegments.set(loadedSegmentKey(threadId, segmentId), loaded)
    return loaded
  }

  async function loadSegment(threadId: string, segmentId: string): Promise<LoadedSegment> {
    const key = loadedSegmentKey(threadId, segmentId)
    const cached = loadedSegments.get(key)
    if (cached) return cached
    // 冷启动首次读取以 durable events 为真相重放，同时重写 projection cache；同进程后续 hydration
    // 与 append 命中内存 cache，不重复扫描。这样不会因一个“看起来完整”的旧 projection 掩盖损坏事件。
    return replaySegment(threadId, segmentId)
  }

  async function quarantineSegment(threadId: string, segmentId: string): Promise<void> {
    loadedSegments.delete(loadedSegmentKey(threadId, segmentId))
    const source = segmentDir(rootDir, threadId, segmentId)
    const destination = join(
      rootDir,
      'agent-state',
      'v1',
      'quarantine',
      `${threadKey(threadId)}-${segmentId}-${Date.now()}`,
    )
    await mkdir(join(rootDir, 'agent-state', 'v1', 'quarantine'), { recursive: true })
    await rename(source, destination)
  }

  async function requireIndexAndActive(threadId: string): Promise<{ index: ThreadIndexV1; loaded: LoadedSegment }> {
    let index = await loadThreadIndex(threadId)
    if (!index) {
      const loaded = await createSegment(threadId, now())
      index = {
        schemaVersion: 1,
        threadId,
        segmentIds: [loaded.manifest.segmentId],
        activeSegmentId: loaded.manifest.segmentId,
      }
      await writeThreadIndex(index)
      return { index, loaded }
    }
    try {
      const loaded = await loadSegment(threadId, index.activeSegmentId)
      if (!loaded.manifest.sealedAt) return { index, loaded }

      const rebuilt = await scanThreadIndex(threadId)
      if (rebuilt && rebuilt.activeSegmentId !== loaded.manifest.segmentId) {
        await writeThreadIndex({ ...rebuilt, hasUnreadableHistory: index.hasUnreadableHistory })
        return {
          index: { ...rebuilt, hasUnreadableHistory: index.hasUnreadableHistory },
          loaded: await loadSegment(threadId, rebuilt.activeSegmentId),
        }
      }
      const fresh = await createSegment(threadId, now())
      index = {
        ...index,
        segmentIds: [...index.segmentIds, fresh.manifest.segmentId],
        activeSegmentId: fresh.manifest.segmentId,
      }
      await writeThreadIndex(index)
      return { index, loaded: fresh }
    } catch (error) {
      if (isUnsupportedAgentHistorySchemaError(error)) throw error
      if (!isAgentHistoryCorruptionError(error)) throw error
      await quarantineSegment(threadId, index.activeSegmentId)
      index = {
        ...index,
        segmentIds: index.segmentIds.filter((segmentId) => segmentId !== index!.activeSegmentId),
        hasUnreadableHistory: true,
      }
      const loaded = await createSegment(threadId, now())
      index.segmentIds.push(loaded.manifest.segmentId)
      index.activeSegmentId = loaded.manifest.segmentId
      await writeThreadIndex(index)
      return { index, loaded }
    }
  }

  async function appendLoaded(
    loaded: LoadedSegment,
    envelope: AgentEventEnvelopeV1,
  ): Promise<LoadedSegment> {
    if (!isDurableEnvelope(envelope, loaded.manifest.threadId, loaded.manifest.segmentId)) {
      throw new Error('Agent durable event 参数非法。')
    }
    if (loaded.manifest.sealedAt) throw new Error('Agent conversation segment 已封存。')
    if (envelope.seq <= loaded.projection.lastSeq) throw new Error('Agent durable event sequence 未递增。')
    const dir = segmentDir(rootDir, envelope.threadId, envelope.segmentId)
    await writeAtomically(join(dir, 'events', eventFileName(envelope.seq)), serialize(envelope))
    const next: LoadedSegment = {
      manifest: {
        ...loaded.manifest,
        lastDurableSeq: envelope.seq,
        ...(envelope.payload.type === 'conversation.segment-sealed'
          ? { sealedAt: envelope.payload.createdAt }
          : {}),
      },
      projection: {
        ...loaded.projection,
        lastSeq: envelope.seq,
        thread: reduceAgentDurableEvent(loaded.projection.thread, envelope.payload),
      },
    }
    loadedSegments.set(loadedSegmentKey(envelope.threadId, envelope.segmentId), next)
    await writeSegmentCacheFailSoft(next)
    return next
  }

  return {
    async listThreadIds() {
      const threadsDir = join(rootDir, 'agent-state', 'v1', 'threads')
      let entries
      try {
        entries = await readdir(threadsDir, { withFileTypes: true })
      } catch (error) {
        if (isMissingFileError(error)) return []
        throw error
      }
      const threadIds: string[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          const value = await readJson(join(threadsDir, entry.name, 'thread.json'))
          if (isRecord(value) && typeof value.threadId === 'string' && value.threadId) {
            threadIds.push(value.threadId)
          }
        } catch (error) {
          if (isUnsupportedAgentHistorySchemaError(error)) throw error
          if (!isMissingFileError(error) && !isMalformedJsonError(error)) throw error
          // 单个损坏 thread index 由后续按 thread 水合时重建，不阻塞其它线程的启动对账。
        }
      }
      return threadIds
    },

    hasAvailableSessionContext(threadId) {
      return enqueue(threadId, async () => {
        const { loaded } = await requireIndexAndActive(threadId)
        const eventsDir = join(
          segmentDir(rootDir, threadId, loaded.manifest.segmentId),
          'events',
        )
        const names = (await readdir(eventsDir))
          .filter((name) => EVENT_FILE_PATTERN.test(name))
          .sort()
        let available = false
        for (const name of names) {
          const value = await readJson(join(eventsDir, name))
          if (!isDurableEnvelope(value, threadId, loaded.manifest.segmentId)) continue
          if (value.payload.type === 'session.context-established') available = true
          if (value.payload.type === 'session.invalidated') available = false
        }
        return available
      })
    },

    ensureActiveSegment(threadId) {
      return enqueue(threadId, async () => (await requireIndexAndActive(threadId)).loaded)
    },

    appendDurableEvent(envelope) {
      return enqueue(envelope.threadId, async () => {
        const { index, loaded } = await requireIndexAndActive(envelope.threadId)
        if (envelope.segmentId !== loaded.manifest.segmentId) {
          throw new Error('Agent durable event segment 已变化，请重新水合。')
        }
        const next = await appendLoaded(loaded, envelope)
        return snapshotFrom(index, next)
      })
    },

    getThreadSnapshot(threadId, segmentId) {
      return enqueue(threadId, async () => {
        const { index, loaded: active } = await requireIndexAndActive(threadId)
        if (!segmentId || segmentId === active.manifest.segmentId) return snapshotFrom(index, active)
        if (!SEGMENT_ID_PATTERN.test(segmentId) || !index.segmentIds.includes(segmentId)) {
          throw new Error('Agent history segment 参数非法。')
        }
        try {
          return snapshotFrom(index, await loadSegment(threadId, segmentId))
        } catch (error) {
          if (isUnsupportedAgentHistorySchemaError(error)) throw error
          if (!isAgentHistoryCorruptionError(error)) throw error
          await quarantineSegment(threadId, segmentId)
          const nextIndex: ThreadIndexV1 = {
            ...index,
            segmentIds: index.segmentIds.filter((id) => id !== segmentId),
            hasUnreadableHistory: true,
          }
          await writeThreadIndex(nextIndex)
          return snapshotFrom(nextIndex, active)
        }
      })
    },

    listHistorySegments(threadId) {
      return enqueue(threadId, async () => {
        const { index } = await requireIndexAndActive(threadId)
        const summaries: AgentHistorySegmentSummaryV1[] = []
        for (const segmentId of index.segmentIds) {
          try {
            const loaded = await loadSegment(threadId, segmentId)
            summaries.push({
              segmentId,
              createdAt: loaded.manifest.createdAt,
              ...(loaded.manifest.sealedAt ? { sealedAt: loaded.manifest.sealedAt } : {}),
              isActive: segmentId === index.activeSegmentId,
            })
          } catch (error) {
            if (isUnsupportedAgentHistorySchemaError(error)) throw error
            if (!isAgentHistoryCorruptionError(error)) throw error
            summaries.push({
              segmentId,
              createdAt: '',
              isActive: false,
              hasUnreadableHistory: true,
            })
          }
        }
        return summaries
      })
    },

    startNewConversation(threadId, occurredAt) {
      return enqueue(threadId, async () => {
        const { index, loaded } = await requireIndexAndActive(threadId)
        let seq = loaded.projection.lastSeq + 1
        const sealedEnvelope: AgentEventEnvelopeV1 = {
          schemaVersion: 1,
          eventId: `${loaded.manifest.segmentId}:${seq}`,
          threadId,
          segmentId: loaded.manifest.segmentId,
          seq,
          durability: 'durable',
          occurredAt,
          payload: { type: 'conversation.segment-sealed', createdAt: occurredAt },
        }
        await appendLoaded(loaded, sealedEnvelope)

        const next = await createSegment(threadId, occurredAt)
        seq = next.projection.lastSeq + 1
        const dividerEnvelope: AgentEventEnvelopeV1 = {
          schemaVersion: 1,
          eventId: `${next.manifest.segmentId}:${seq}`,
          threadId,
          segmentId: next.manifest.segmentId,
          seq,
          durability: 'durable',
          occurredAt,
          payload: {
            type: 'conversation.divider-added',
            dividerId: `divider-${next.manifest.segmentId}`,
            createdAt: occurredAt,
          },
        }
        const withDivider = await appendLoaded(next, dividerEnvelope)
        const nextIndex: ThreadIndexV1 = {
          ...index,
          segmentIds: [...index.segmentIds, next.manifest.segmentId],
          activeSegmentId: next.manifest.segmentId,
        }
        await writeThreadIndex(nextIndex)
        return snapshotFrom(nextIndex, withDivider)
      })
    },
  }
}
