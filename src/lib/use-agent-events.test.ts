import { afterEach, describe, expect, test } from 'bun:test'
import { createResultNotificationDraft } from '@shared/lib/result-notifications'
import {
  createAgentEventBatcher,
  processAgentEvents,
  resolveProjectRefreshSelection,
  resolveProjectUpdateRefresh,
  selectBufferedAgentEventsAfterSnapshot,
  useAgentEventSubscription,
} from './use-agent-events'
import type { AgentEvent, AgentEventEnvelopeV1 } from '@shared/types/agent'

describe('useAgentEventSubscription', () => {
  test('exports a hook', () => {
    expect(typeof useAgentEventSubscription).toBe('function')
  })

  test('batches streaming deltas until the scheduled frame flushes', () => {
    const batches: AgentEvent[][] = []
    let scheduledFlush: (() => void) | null = null
    const batcher = createAgentEventBatcher({
      flush: (events) => batches.push(events),
      schedule: (flush) => {
        scheduledFlush = flush
        return () => {
          scheduledFlush = null
        }
      },
    })
    const delta1: AgentEvent = {
      type: 'message.delta',
      runId: 'run-1',
      messageId: 'assistant-run-1',
      text: '第一段',
      createdAt: '2026-05-24T00:00:00.000Z',
    }
    const delta2: AgentEvent = {
      type: 'message.delta',
      runId: 'run-1',
      messageId: 'assistant-run-1',
      text: '第二段',
      createdAt: '2026-05-24T00:00:01.000Z',
    }

    batcher.enqueue(delta1)
    batcher.enqueue(delta2)

    expect(batches).toEqual([])
    scheduledFlush?.()
    expect(batches).toEqual([[delta1, delta2]])
  })

  test('flushes queued streaming deltas before terminal events', () => {
    const batches: AgentEvent[][] = []
    let scheduledFlush: (() => void) | null = null
    const batcher = createAgentEventBatcher({
      flush: (events) => batches.push(events),
      schedule: (flush) => {
        scheduledFlush = flush
        return () => {
          scheduledFlush = null
        }
      },
    })
    const delta: AgentEvent = {
      type: 'message.delta',
      runId: 'run-1',
      messageId: 'assistant-run-1',
      text: '第一段',
      createdAt: '2026-05-24T00:00:00.000Z',
    }
    const completed: AgentEvent = {
      type: 'run.completed',
      runId: 'run-1',
      createdAt: '2026-05-24T00:00:01.000Z',
    }

    batcher.enqueue(delta)
    batcher.enqueue(completed)

    expect(scheduledFlush).toBeNull()
    expect(batches).toEqual([[delta, completed]])
  })

  test('replays only contiguous events newer than an in-flight snapshot and detects gaps', () => {
    const makeEnvelope = (seq: number): AgentEventEnvelopeV1 => ({
      schemaVersion: 1,
      eventId: `seg-1:${seq}`,
      threadId: 'thread-1',
      segmentId: 'seg-1',
      runId: 'run-1',
      seq,
      durability: 'transient',
      occurredAt: '2026-07-24T00:00:00.000Z',
      payload: {
        type: 'message.delta',
        runId: 'run-1',
        messageId: 'assistant-run-1',
        text: String(seq),
        createdAt: '2026-07-24T00:00:00.000Z',
      },
    })
    expect(
      selectBufferedAgentEventsAfterSnapshot({
        segmentId: 'seg-1',
        lastSeq: 2,
        buffered: [makeEnvelope(2), makeEnvelope(4), makeEnvelope(3)],
      }),
    ).toEqual({ events: [makeEnvelope(3), makeEnvelope(4)], hasGap: false })
    expect(
      selectBufferedAgentEventsAfterSnapshot({
        segmentId: 'seg-1',
        lastSeq: 2,
        buffered: [makeEnvelope(4)],
      }),
    ).toEqual({ events: [], hasGap: true })
  })

  test('uses the completed agent target when refreshing generated setup artifacts', () => {
    expect(
      resolveProjectRefreshSelection({
        event: {
          type: 'novel.project.updated',
          runId: 'run-1',
          projectPath: '/novels/stars',
          target: {
            sectionId: 'settings',
            tabId: 'foundation',
            objectId: 'foundation',
          },
          createdAt: '2026-05-16T00:00:00.000Z',
        },
        currentObjectId: 'master-outline',
      }),
    ).toEqual({
      selectedObjectId: 'foundation',
      selectedSectionId: 'settings',
      selectedTabId: 'foundation',
    })
  })

  test('uses the completed reference-works target when refreshing generated reference analysis', () => {
    expect(
      resolveProjectRefreshSelection({
        event: {
          type: 'novel.project.updated',
          runId: 'run-1',
          projectPath: '/novels/stars',
          target: {
            sectionId: 'reference-works',
            tabId: 'references',
            objectId: 'references',
          },
          createdAt: '2026-05-20T00:00:00.000Z',
        },
        currentObjectId: 'foundation',
      }),
    ).toEqual({
      selectedObjectId: 'references',
      selectedSectionId: 'reference-works',
      selectedTabId: 'references',
    })
  })

})

describe('resolveProjectUpdateRefresh', () => {
  test('refreshes only the current object for transient events', () => {
    expect(
      resolveProjectUpdateRefresh({
        event: {
          type: 'novel.project.updated',
          runId: 'run-1',
          projectPath: '/novels/stars',
          transient: true,
          createdAt: '2026-06-05T00:00:00.000Z',
        },
        currentObjectId: 'chapter-12',
      }),
    ).toEqual({ selectedObjectId: 'chapter-12' })
  })

  test('refreshes the current object on terminal events without switching away from it', () => {
    // 终态事件带 target（blueprint 分区 + chapter-12），但只要当前已显示某对象，就只刷新它、不切对象，
    // 避免 store 的 objectId 与 UI selectedObjectId 不一致被 selectMatchingWorkbenchArtifacts 判空。
    expect(
      resolveProjectUpdateRefresh({
        event: {
          type: 'novel.project.updated',
          runId: 'run-1',
          projectPath: '/novels/stars',
          selectedChapter: 12,
          target: { sectionId: 'blueprint', tabId: 'chapter-12', objectId: 'chapter-12' },
          createdAt: '2026-06-05T00:00:00.000Z',
        },
        currentObjectId: 'chapter-12',
      }),
    ).toEqual({ selectedObjectId: 'chapter-12' })
  })

  test('falls back to the event target on terminal events when nothing is shown yet', () => {
    expect(
      resolveProjectUpdateRefresh({
        event: {
          type: 'novel.project.updated',
          runId: 'run-1',
          projectPath: '/novels/stars',
          selectedChapter: 12,
          target: { sectionId: 'settings', tabId: 'foundation', objectId: 'foundation' },
          createdAt: '2026-06-05T00:00:00.000Z',
        },
        currentObjectId: undefined,
      }),
    ).toEqual({
      selectedChapter: 12,
      selectedObjectId: 'foundation',
      selectedSectionId: 'settings',
      selectedTabId: 'foundation',
    })
  })
})

describe('processAgentEvents — renderer 不再执行主进程副作用', () => {
  const originalWindow = globalThis.window

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  })

  function stubWindowElectron(clearCalls: { projectPath: string; chapter: number }[]) {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          clearPendingMemorySync: async (input: { projectPath: string; chapter: number }) => {
            clearCalls.push(input)
            return { ok: true }
          },
          upsertResultNotification: async () => ({ notifications: [], totalCount: 0, unreadCount: 0 }),
          markResultNotificationRead: async () => ({ notifications: [], totalCount: 0, unreadCount: 0 }),
        },
      },
    })
  }

  test('run.completed + command=sync-chapter-memory 不从 renderer 清标', async () => {
    const clearCalls: { projectPath: string; chapter: number }[] = []
    stubWindowElectron(clearCalls)

    processAgentEvents([
      {
        type: 'run.started',
        runId: 'run-sync-1',
        threadId: 'thread-sync-1',
        command: 'sync-chapter-memory',
        prompt: '同步第 5 章记忆',
        projectPath: '/novels/stars',
        selectedChapter: 5,
        createdAt: '2026-07-11T00:00:00.000Z',
      },
      {
        type: 'run.completed',
        runId: 'run-sync-1',
        createdAt: '2026-07-11T00:01:00.000Z',
      },
    ])

    await Promise.resolve()
    await Promise.resolve()

    expect(clearCalls).toEqual([])
  })

  test('run.failed 不调用 clearPendingMemorySync', async () => {
    const clearCalls: { projectPath: string; chapter: number }[] = []
    stubWindowElectron(clearCalls)

    processAgentEvents([
      {
        type: 'run.started',
        runId: 'run-sync-2',
        threadId: 'thread-sync-2',
        command: 'sync-chapter-memory',
        prompt: '同步第 6 章记忆',
        projectPath: '/novels/stars',
        selectedChapter: 6,
        createdAt: '2026-07-11T00:00:00.000Z',
      },
      {
        type: 'run.failed',
        runId: 'run-sync-2',
        error: '记忆回滚失败',
        createdAt: '2026-07-11T00:01:00.000Z',
      },
    ])

    await Promise.resolve()
    await Promise.resolve()

    expect(clearCalls).toEqual([])
  })

  test('run.completed 但非 sync-chapter-memory 命令不调用 clearPendingMemorySync', async () => {
    const clearCalls: { projectPath: string; chapter: number }[] = []
    stubWindowElectron(clearCalls)

    processAgentEvents([
      {
        type: 'run.started',
        runId: 'run-write-1',
        threadId: 'thread-write-1',
        command: 'write-next',
        prompt: '继续写第 6 章',
        projectPath: '/novels/stars',
        selectedChapter: 6,
        createdAt: '2026-07-11T00:00:00.000Z',
      },
      {
        type: 'run.completed',
        runId: 'run-write-1',
        createdAt: '2026-07-11T00:01:00.000Z',
      },
    ])

    await Promise.resolve()
    await Promise.resolve()

    expect(clearCalls).toEqual([])
  })
})

describe('createResultNotificationDraft — sync-chapter-memory 标题', () => {
  test('命令为 sync-chapter-memory 时标题含「记忆同步」', () => {
    const draft = createResultNotificationDraft({
      occurredAt: '2026-07-11T00:01:00.000Z',
      projectName: '长夜星河',
      status: 'success',
      run: {
        id: 'run-sync-1',
        threadId: 'thread-sync-1',
        command: 'sync-chapter-memory',
        prompt: '同步第 5 章记忆',
        status: 'complete',
        startedAt: '2026-07-11T00:00:00.000Z',
        projectPath: '/novels/stars',
        selectedChapter: 5,
      },
    })

    expect(draft.title).toContain('记忆同步')
  })
})
