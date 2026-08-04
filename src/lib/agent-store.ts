import { create } from 'zustand'
import { createEmptyAgentThread, reduceAgentEvent } from './agent-events'
import { reduceAgentDurableEvent } from '@shared/lib/agent-durable-events'
import {
  getAgentThreadIdForProjectIdentity,
  type AgentDurableEventV1,
  type AgentEvent,
  type AgentEventEnvelopeV1,
  type AgentThread,
  type AgentThreadSnapshotV1,
} from '@shared/types/agent'
import type { AgentComposerHandoff } from '@/types/agent'
import type { NovelProjectSummary } from '@shared/types/novel'

interface AgentStore {
  activeThreadId: string
  threadsById: Record<string, AgentThread>
  composerHandoffRequestsByThreadId: Record<string, AgentComposerHandoff | undefined>
  focusedQuestionRequestIdsByThreadId: Record<string, string | undefined>
  segmentIdByThreadId: Record<string, string | undefined>
  lastSeqByThreadId: Record<string, number | undefined>
  previousSegmentIdByThreadId: Record<string, string | undefined>
  unreadableHistoryByThreadId: Record<string, boolean | undefined>
  projectRevisionByThreadId: Record<string, number | undefined>
  applyAgentEvent: (event: AgentEvent) => void
  applyAgentEvents: (events: AgentEvent[]) => void
  applyAgentEnvelope: (envelope: AgentEventEnvelopeV1) => void
  applyAgentEnvelopes: (envelopes: AgentEventEnvelopeV1[]) => void
  replaceThreadFromSnapshot: (snapshot: AgentThreadSnapshotV1) => void
  prependHistorySnapshot: (snapshot: AgentThreadSnapshotV1) => void
  selectThread: (threadId: string) => void
  selectProjectThread: (project: Pick<NovelProjectSummary, 'id' | 'path'>) => void
  requestComposerHandoff: (handoff: Omit<AgentComposerHandoff, 'id'>, threadId?: string) => void
  clearComposerHandoffRequest: (threadId?: string) => void
  focusQuestionRequest: (questionRequestId: string, threadId?: string) => void
  clearFocusedQuestionRequest: (threadId?: string) => void
  resetAgentState: () => void
}

const DEFAULT_THREAD_ID = 'workbench-placeholder'

export function getAgentThreadIdForProject(project: Pick<NovelProjectSummary, 'id' | 'path'>): string {
  return getAgentThreadIdForProjectIdentity(project)
}

function initialThreads(): Record<string, AgentThread> {
  return {
    [DEFAULT_THREAD_ID]: createEmptyAgentThread(DEFAULT_THREAD_ID),
  }
}

function applyAgentEventsToState(
  state: Pick<AgentStore, 'activeThreadId' | 'threadsById'>,
  events: AgentEvent[],
): Pick<AgentStore, 'activeThreadId' | 'threadsById'> {
  if (events.length === 0) return state

  const activeThreadId = state.activeThreadId
  const threadsById = { ...state.threadsById }

  for (const event of events) {
    const threadId = resolveEventThreadId(threadsById, activeThreadId, event)
    const thread = threadsById[threadId] ?? createEmptyAgentThread(threadId)
    threadsById[threadId] = reduceAgentEvent(thread, event)
  }

  return {
    activeThreadId,
    threadsById,
  }
}

function resolveEventThreadId(
  threadsById: Record<string, AgentThread>,
  activeThreadId: string,
  event: AgentEvent,
): string {
  if ('threadId' in event) return event.threadId

  return findThreadIdForRun(threadsById, event.runId) ?? activeThreadId
}

function findThreadIdForRun(threadsById: Record<string, AgentThread>, runId: string): string | undefined {
  for (const [threadId, thread] of Object.entries(threadsById)) {
    if (thread.activeRun?.id === runId || thread.lastRun?.id === runId) return threadId
  }

  return undefined
}

function ensureThread(threadsById: Record<string, AgentThread>, threadId: string): Record<string, AgentThread> {
  if (threadsById[threadId]) return threadsById
  return {
    ...threadsById,
    [threadId]: createEmptyAgentThread(threadId),
  }
}

function applyEnvelopeToThread(thread: AgentThread, envelope: AgentEventEnvelopeV1): AgentThread {
  if (envelope.durability === 'durable') {
    return reduceAgentDurableEvent(thread, envelope.payload as AgentDurableEventV1)
  }
  if (envelope.payload.type === 'run.started' && thread.activeRun?.id === envelope.payload.runId) {
    return {
      ...thread,
      activeRun: {
        ...thread.activeRun,
        prompt: envelope.payload.prompt,
        displayPrompt: envelope.payload.displayPrompt,
        projectPath: envelope.payload.projectPath,
        selectedChapter: envelope.payload.selectedChapter,
        target: envelope.payload.target,
      },
    }
  }
  return reduceAgentEvent(thread, envelope.payload as AgentEvent)
}

function applyAgentEnvelopesToState(state: AgentStore, envelopes: AgentEventEnvelopeV1[]): Partial<AgentStore> {
  if (envelopes.length === 0) return state
  const threadsById = { ...state.threadsById }
  const segmentIdByThreadId = { ...state.segmentIdByThreadId }
  const lastSeqByThreadId = { ...state.lastSeqByThreadId }
  let changed = false
  for (const envelope of envelopes) {
    const currentSegmentId = segmentIdByThreadId[envelope.threadId]
    const currentSeq = lastSeqByThreadId[envelope.threadId] ?? 0
    if (currentSegmentId === envelope.segmentId && envelope.seq <= currentSeq) continue
    const segmentChanged = Boolean(currentSegmentId && currentSegmentId !== envelope.segmentId)
    const thread = segmentChanged
      ? createEmptyAgentThread(envelope.threadId)
      : threadsById[envelope.threadId] ?? createEmptyAgentThread(envelope.threadId)
    threadsById[envelope.threadId] = applyEnvelopeToThread(thread, envelope)
    segmentIdByThreadId[envelope.threadId] = envelope.segmentId
    lastSeqByThreadId[envelope.threadId] = envelope.seq
    changed = true
  }
  return changed ? { threadsById, segmentIdByThreadId, lastSeqByThreadId } : state
}

export const useAgentStore = create<AgentStore>((set) => ({
  activeThreadId: DEFAULT_THREAD_ID,
  threadsById: initialThreads(),
  composerHandoffRequestsByThreadId: {},
  focusedQuestionRequestIdsByThreadId: {},
  segmentIdByThreadId: {},
  lastSeqByThreadId: {},
  previousSegmentIdByThreadId: {},
  unreadableHistoryByThreadId: {},
  projectRevisionByThreadId: {},
  applyAgentEvent: (event) => set((state) => applyAgentEventsToState(state, [event])),
  applyAgentEvents: (events) => set((state) => applyAgentEventsToState(state, events)),
  applyAgentEnvelope: (envelope) => set((state) => applyAgentEnvelopesToState(state, [envelope])),
  applyAgentEnvelopes: (envelopes) => set((state) => applyAgentEnvelopesToState(state, envelopes)),
  replaceThreadFromSnapshot: (snapshot) =>
    set((state) => ({
      threadsById: {
        ...state.threadsById,
        [snapshot.threadId]: {
          id: snapshot.threadId,
          messages: snapshot.history,
          activeRun: snapshot.activeRun,
          lastRun: snapshot.lastRun,
        },
      },
      segmentIdByThreadId: {
        ...state.segmentIdByThreadId,
        [snapshot.threadId]: snapshot.segmentId,
      },
      lastSeqByThreadId: {
        ...state.lastSeqByThreadId,
        [snapshot.threadId]: snapshot.lastSeq,
      },
      previousSegmentIdByThreadId: {
        ...state.previousSegmentIdByThreadId,
        [snapshot.threadId]: snapshot.previousSegmentId,
      },
      unreadableHistoryByThreadId: {
        ...state.unreadableHistoryByThreadId,
        [snapshot.threadId]: snapshot.hasUnreadableHistory,
      },
      projectRevisionByThreadId: {
        ...state.projectRevisionByThreadId,
        [snapshot.threadId]: snapshot.projectRevision,
      },
    })),
  prependHistorySnapshot: (snapshot) =>
    set((state) => {
      const current = state.threadsById[snapshot.threadId] ?? createEmptyAgentThread(snapshot.threadId)
      const existingIds = new Set(current.messages.map((message) => message.id))
      const older = snapshot.history.filter((message) => !existingIds.has(message.id))
      return {
        threadsById: {
          ...state.threadsById,
          [snapshot.threadId]: {
            ...current,
            messages: [...older, ...current.messages],
            lastRun: current.lastRun ?? snapshot.lastRun,
          },
        },
        previousSegmentIdByThreadId: {
          ...state.previousSegmentIdByThreadId,
          [snapshot.threadId]: snapshot.previousSegmentId,
        },
        unreadableHistoryByThreadId: {
          ...state.unreadableHistoryByThreadId,
          [snapshot.threadId]:
            Boolean(state.unreadableHistoryByThreadId[snapshot.threadId]) ||
            Boolean(snapshot.hasUnreadableHistory),
        },
      }
    }),
  selectThread: (threadId) =>
    set((state) => ({
      activeThreadId: threadId,
      threadsById: ensureThread(state.threadsById, threadId),
    })),
  selectProjectThread: (project) =>
    set((state) => {
      const threadId = getAgentThreadIdForProject(project)
      return {
        activeThreadId: threadId,
        threadsById: ensureThread(state.threadsById, threadId),
      }
    }),
  requestComposerHandoff: (handoff, threadId) =>
    set((state) => ({
      composerHandoffRequestsByThreadId: {
        ...state.composerHandoffRequestsByThreadId,
        [threadId ?? state.activeThreadId]: {
          id: `handoff-${Date.now()}`,
          ...handoff,
        },
      },
    })),
  clearComposerHandoffRequest: (threadId) =>
    set((state) => {
      const scopedThreadId = threadId ?? state.activeThreadId
      const { [scopedThreadId]: _cleared, ...composerHandoffRequestsByThreadId } =
        state.composerHandoffRequestsByThreadId
      return { composerHandoffRequestsByThreadId }
    }),
  focusQuestionRequest: (questionRequestId, threadId) =>
    set((state) => ({
      focusedQuestionRequestIdsByThreadId: {
        ...state.focusedQuestionRequestIdsByThreadId,
        [threadId ?? state.activeThreadId]: questionRequestId,
      },
    })),
  clearFocusedQuestionRequest: (threadId) =>
    set((state) => {
      const scopedThreadId = threadId ?? state.activeThreadId
      const { [scopedThreadId]: _cleared, ...focusedQuestionRequestIdsByThreadId } =
        state.focusedQuestionRequestIdsByThreadId
      return { focusedQuestionRequestIdsByThreadId }
    }),
  resetAgentState: () =>
    set({
      activeThreadId: DEFAULT_THREAD_ID,
      threadsById: initialThreads(),
      composerHandoffRequestsByThreadId: {},
      focusedQuestionRequestIdsByThreadId: {},
      segmentIdByThreadId: {},
      lastSeqByThreadId: {},
      previousSegmentIdByThreadId: {},
      unreadableHistoryByThreadId: {},
      projectRevisionByThreadId: {},
    }),
}))
