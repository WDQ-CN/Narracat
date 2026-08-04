import { useEffect } from 'react'
import {
  getAgentEventsAfter,
  getAgentThreadSnapshot,
  onAgentEvent,
} from '@/lib/ipc'
import { useAgentStore } from './agent-store'
import { useNovelStore } from './novel-store'
import { loadWorkbenchProject } from './use-novel-project'
import { isSameProjectPath } from './project-path'
import type {
  AgentDurableEventV1,
  AgentEvent,
  AgentEventEnvelopeV1,
} from '@shared/types/agent'
import type { WorkbenchPrimarySectionId } from './workbench-navigation'

type ProjectUpdatedEvent = Extract<AgentEvent, { type: 'novel.project.updated' }>
type AgentEventBatchScheduler = (flush: () => void) => () => void

function readWorkbenchSectionId(value: string | undefined): WorkbenchPrimarySectionId | undefined {
  return value === 'blueprint' || value === 'settings' || value === 'reference-works' ? value : undefined
}

function hasAgentEventApi(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electron?.onAgentEvent)
}

function shouldFlushAgentEventImmediately(event: AgentEvent): boolean {
  return event.type !== 'message.delta' && event.type !== 'reasoning.delta'
}

function scheduleAgentEventBatch(flush: () => void): () => void {
  if (
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function' &&
    typeof window.cancelAnimationFrame === 'function'
  ) {
    const frameId = window.requestAnimationFrame(flush)
    return () => window.cancelAnimationFrame(frameId)
  }

  const timeoutId = setTimeout(flush, 16)
  return () => clearTimeout(timeoutId)
}

export function createAgentEventBatcher({
  flush,
  schedule = scheduleAgentEventBatch,
}: {
  flush: (events: AgentEvent[]) => void
  schedule?: AgentEventBatchScheduler
}) {
  let queue: AgentEvent[] = []
  let cancelScheduledFlush: (() => void) | null = null

  const flushNow = () => {
    cancelScheduledFlush = null
    const events = queue
    queue = []
    if (events.length > 0) flush(events)
  }

  return {
    enqueue(event: AgentEvent) {
      queue.push(event)

      if (shouldFlushAgentEventImmediately(event)) {
        cancelScheduledFlush?.()
        flushNow()
        return
      }

      cancelScheduledFlush ??= schedule(flushNow)
    },
    dispose() {
      cancelScheduledFlush?.()
      flushNow()
    },
  }
}

function createAgentEnvelopeBatcher({
  flush,
  schedule = scheduleAgentEventBatch,
}: {
  flush: (events: AgentEventEnvelopeV1[]) => void
  schedule?: AgentEventBatchScheduler
}) {
  let queue: AgentEventEnvelopeV1[] = []
  let cancelScheduledFlush: (() => void) | null = null
  const flushNow = () => {
    cancelScheduledFlush = null
    const events = queue
    queue = []
    if (events.length > 0) flush(events)
  }
  return {
    enqueue(envelope: AgentEventEnvelopeV1) {
      queue.push(envelope)
      const payload = envelope.payload
      const isStreaming =
        envelope.durability === 'transient' &&
        (payload.type === 'message.delta' || payload.type === 'reasoning.delta')
      if (!isStreaming) {
        cancelScheduledFlush?.()
        flushNow()
        return
      }
      cancelScheduledFlush ??= schedule(flushNow)
    },
    dispose() {
      cancelScheduledFlush?.()
      flushNow()
    },
  }
}

export function resolveProjectRefreshSelection({
  currentObjectId,
  event,
}: {
  currentObjectId?: string
  event: ProjectUpdatedEvent
}): {
  selectedObjectId?: string
  selectedSectionId?: WorkbenchPrimarySectionId
  selectedTabId?: string
} {
  return {
    selectedObjectId: event.target?.objectId ?? currentObjectId,
    selectedSectionId: readWorkbenchSectionId(event.target?.sectionId),
    selectedTabId: event.target?.tabId,
  }
}

export function resolveProjectUpdateRefresh({
  currentObjectId,
  event,
}: {
  currentObjectId?: string
  event: ProjectUpdatedEvent
}): {
  selectedChapter?: number
  selectedObjectId?: string
  selectedSectionId?: WorkbenchPrimarySectionId
  selectedTabId?: string | null
} {
  // 只要当前已有显示对象（增量刷新、以及绝大多数终态刷新），都只平滑刷新该对象、绝不主动切对象：
  // use-agent-events 改不了 UI 的 selectedObjectId，一旦把 store 的 activeWorkbenchArtifacts 切到别的对象，
  // 会被 selectMatchingWorkbenchArtifacts 因 objectId 不匹配判空、导致 run 结束后内容消失。
  // 仅当前无显示对象（如首次生成产物）时，才用事件 target 跳到产物页。
  if (event.transient || currentObjectId) {
    return { selectedObjectId: currentObjectId }
  }

  const refreshSelection = resolveProjectRefreshSelection({ event, currentObjectId })
  return {
    selectedChapter: event.selectedChapter,
    selectedObjectId: refreshSelection.selectedObjectId,
    selectedSectionId: refreshSelection.selectedSectionId,
    selectedTabId: refreshSelection.selectedTabId,
  }
}

/** 批处理落地的事件处理主体；抽成模块级导出函数便于直接单测（不依赖 React 渲染）。 */
export function processAgentEvents(events: AgentEvent[]) {
  useAgentStore.getState().applyAgentEvents(events)
  processAgentEventSideEffects(events)
}

function processAgentEventSideEffects(events: AgentEvent[]) {
  const activeProject = useNovelStore.getState().activeProject
  for (const event of events) {
    if (event.type === 'message.delta' || event.type === 'reasoning.delta') continue

    if (event.type !== 'novel.project.updated') continue

    if (!isSameProjectPath(activeProject?.path, event.projectPath)) continue

    const currentObjectId = useNovelStore.getState().activeWorkbenchArtifacts?.objectId
    // 平滑刷新（不预清空）+ 不主动切对象：把 store 切到与 UI selectedObjectId 不一致的对象，
    // 会被 selectMatchingWorkbenchArtifacts 判空，导致 run 结束后正文/大纲/审修消失。
    const refresh = resolveProjectUpdateRefresh({ event, currentObjectId })
    void loadWorkbenchProject(
      event.projectPath,
      refresh.selectedChapter,
      refresh.selectedObjectId,
      refresh.selectedSectionId,
      refresh.selectedTabId,
      { smooth: true },
    )
  }
}

function rawEventForEnvelope(envelope: AgentEventEnvelopeV1): AgentEvent | null {
  if (envelope.durability === 'transient') return envelope.payload as AgentEvent
  const payload = envelope.payload as AgentDurableEventV1
  switch (payload.type) {
    case 'run.question-requested':
      return {
        type: 'question.requested',
        runId: payload.runId,
        messageId: payload.messageId,
        questionRequestId: payload.questionRequestId,
        toolCallId: payload.toolCallId,
        questions: payload.questions,
        createdAt: payload.createdAt,
      }
    case 'run.question-answered':
      return {
        type: 'question.answered',
        runId: payload.runId,
        questionRequestId: payload.questionRequestId,
        answers: payload.answers,
        createdAt: payload.createdAt,
      }
    case 'run.completed':
      return {
        type: 'run.completed',
        runId: payload.runId,
        usage: payload.usage,
        createdAt: payload.createdAt,
      }
    case 'run.failed':
      return {
        type: 'run.failed',
        runId: payload.runId,
        error: payload.error,
        reason: payload.reason,
        provider: payload.provider,
        createdAt: payload.createdAt,
      }
    case 'run.interrupted':
      return {
        type: 'run.interrupted',
        runId: payload.runId,
        error: payload.error,
        createdAt: payload.createdAt,
      }
    case 'run.cancelled':
      return {
        type: 'run.cancelled',
        runId: payload.runId,
        createdAt: payload.createdAt,
      }
    case 'run.plan-finalized':
      return {
        type: 'task-plan.updated',
        runId: payload.runId,
        items: payload.items,
        createdAt: payload.createdAt,
      }
    default:
      return null
  }
}

const hydrationBuffers = new Map<string, AgentEventEnvelopeV1[]>()
const hydrationPromises = new Map<string, Promise<void>>()
let disposeAgentEventSubscription: (() => void) | null = null

export function selectBufferedAgentEventsAfterSnapshot({
  segmentId,
  lastSeq,
  buffered,
}: {
  segmentId: string
  lastSeq: number
  buffered: AgentEventEnvelopeV1[]
}): { events: AgentEventEnvelopeV1[]; hasGap: boolean } {
  let expectedSeq = lastSeq
  const events: AgentEventEnvelopeV1[] = []
  for (const envelope of buffered
    .filter((item) => item.segmentId === segmentId && item.seq > lastSeq)
    .sort((left, right) => left.seq - right.seq)) {
    if (envelope.seq !== expectedSeq + 1) return { events, hasGap: true }
    events.push(envelope)
    expectedSeq = envelope.seq
  }
  return { events, hasGap: false }
}

function bufferEnvelope(envelope: AgentEventEnvelopeV1): void {
  const buffer = hydrationBuffers.get(envelope.threadId)
  if (buffer) buffer.push(envelope)
}

function applyAgentEnvelopes(envelopes: AgentEventEnvelopeV1[]): void {
  const rawEvents: AgentEvent[] = []
  const initial = useAgentStore.getState()
  const segmentByThread = { ...initial.segmentIdByThreadId }
  const seqByThread = { ...initial.lastSeqByThreadId }
  const accepted: AgentEventEnvelopeV1[] = []
  for (const envelope of envelopes) {
    if (
      segmentByThread[envelope.threadId] === envelope.segmentId &&
      envelope.seq <= (seqByThread[envelope.threadId] ?? 0)
    ) {
      continue
    }
    accepted.push(envelope)
    segmentByThread[envelope.threadId] = envelope.segmentId
    seqByThread[envelope.threadId] = envelope.seq
    const raw = rawEventForEnvelope(envelope)
    if (raw) rawEvents.push(raw)
  }
  useAgentStore.getState().applyAgentEnvelopes(accepted)
  if (rawEvents.length > 0) processAgentEventSideEffects(rawEvents)
}

async function recoverEnvelopeGap(envelope: AgentEventEnvelopeV1): Promise<void> {
  const state = useAgentStore.getState()
  const segmentId = state.segmentIdByThreadId[envelope.threadId]
  const lastSeq = state.lastSeqByThreadId[envelope.threadId] ?? 0
  if (segmentId !== envelope.segmentId) {
    useAgentStore.getState().replaceThreadFromSnapshot(await getAgentThreadSnapshot(envelope.threadId))
    return
  }
  const result = await getAgentEventsAfter(envelope.threadId, envelope.segmentId, lastSeq)
  if (result.status === 'snapshot-required') {
    useAgentStore.getState().replaceThreadFromSnapshot(await getAgentThreadSnapshot(envelope.threadId))
    return
  }
  applyAgentEnvelopes(result.events)
}

function handleAgentEnvelope(envelope: AgentEventEnvelopeV1): void {
  if (hydrationBuffers.has(envelope.threadId)) {
    bufferEnvelope(envelope)
    return
  }
  const state = useAgentStore.getState()
  const segmentId = state.segmentIdByThreadId[envelope.threadId]
  const lastSeq = state.lastSeqByThreadId[envelope.threadId] ?? 0
  if ((segmentId && segmentId !== envelope.segmentId) || (segmentId === envelope.segmentId && envelope.seq > lastSeq + 1)) {
    hydrationBuffers.set(envelope.threadId, [envelope])
    void recoverEnvelopeGap(envelope)
      .catch((error) => console.error(error))
      .finally(() => {
        const buffered = hydrationBuffers.get(envelope.threadId) ?? []
        hydrationBuffers.delete(envelope.threadId)
        const current = useAgentStore.getState()
        const currentSegment = current.segmentIdByThreadId[envelope.threadId]
        const currentSeq = current.lastSeqByThreadId[envelope.threadId] ?? 0
        applyAgentEnvelopes(
          buffered
            .filter((item) => item.segmentId === currentSegment && item.seq > currentSeq)
            .sort((left, right) => left.seq - right.seq),
        )
      })
    return
  }
  applyAgentEnvelopes([envelope])
}

export function hydrateAgentThread(threadId: string): Promise<void> {
  const existing = hydrationPromises.get(threadId)
  if (existing) return existing
  hydrationBuffers.set(threadId, [])
  ensureAgentEventSubscription()
  const hydration = getAgentThreadSnapshot(threadId)
    .then(async (snapshot) => {
      const previousRevision = useAgentStore.getState().projectRevisionByThreadId[threadId] ?? 0
      useAgentStore.getState().replaceThreadFromSnapshot(snapshot)
      if (snapshot.projectRevision > previousRevision) {
        const state = useAgentStore.getState()
        const activeProject = useNovelStore.getState().activeProject
        if (state.activeThreadId === threadId && activeProject) {
          const currentObjectId = useNovelStore.getState().activeWorkbenchArtifacts?.objectId
          void loadWorkbenchProject(activeProject.path, undefined, currentObjectId, undefined, undefined, {
            smooth: true,
          })
        }
      }
      const buffered = hydrationBuffers.get(threadId) ?? []
      const { events: applicable, hasGap } = selectBufferedAgentEventsAfterSnapshot({
        segmentId: snapshot.segmentId,
        lastSeq: snapshot.lastSeq,
        buffered,
      })
      if (!hasGap) {
        applyAgentEnvelopes(applicable)
        return
      }
      const recovered = await getAgentEventsAfter(threadId, snapshot.segmentId, snapshot.lastSeq)
      if (recovered.status === 'ok') {
        applyAgentEnvelopes(recovered.events)
        return
      }
      useAgentStore.getState().replaceThreadFromSnapshot(await getAgentThreadSnapshot(threadId))
    })
    .finally(() => {
      hydrationBuffers.delete(threadId)
      hydrationPromises.delete(threadId)
    })
  hydrationPromises.set(threadId, hydration)
  return hydration
}

export function ensureAgentEventSubscription(): void {
  if (disposeAgentEventSubscription || !hasAgentEventApi()) return
  const batcher = createAgentEnvelopeBatcher({
    flush: (events) => {
      for (const event of events) handleAgentEnvelope(event)
    },
  })
  const unsubscribe = onAgentEvent((event) => batcher.enqueue(event))
  disposeAgentEventSubscription = () => {
    unsubscribe()
    batcher.dispose()
    disposeAgentEventSubscription = null
  }
}

export function useAgentEventSubscription() {
  useEffect(() => {
    ensureAgentEventSubscription()
  }, [])
}
