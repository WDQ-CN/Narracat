import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentEvent } from '@shared/types/agent'
import { createAgentConversationStore } from '../events/agent-conversation-store.ts'
import { createAgentRuntimeCoordinator } from './agent-runtime-coordinator.ts'
import type { AgentRunManager } from './run-manager.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeHarness() {
  const root = await mkdtemp(join(tmpdir(), 'narracat-runtime-coordinator-'))
  roots.push(root)
  let sendEvent!: (event: AgentEvent) => Promise<void>
  let runCounter = 0
  let startCalls = 0
  let cancelCalls = 0
  let answerCalls = 0
  const activeByThread = new Map<string, string>()

  const manager: AgentRunManager = {
    async startRun(request) {
      startCalls += 1
      const runId = `run-${++runCounter}`
      activeByThread.set(request.threadId, runId)
      await sendEvent({
        type: 'run.started',
        runId,
        threadId: request.threadId,
        command: request.command,
        prompt: request.prompt,
        projectPath: request.projectPath,
        createdAt: '2026-07-24T12:00:00.000Z',
      })
      return { runId }
    },
    async cancelRun() {
      cancelCalls += 1
      return { cancelled: true }
    },
    async answerQuestion() {
      answerCalls += 1
      return { accepted: true }
    },
    forgetThreadSession() {},
    hasActiveRunForThread(threadId) {
      return activeByThread.has(threadId)
    },
    getRunStatus() {
      return 'running'
    },
    hasThreadSession() {
      return false
    },
    async invalidateAllThreadSessions() {},
    hasActiveRuns() {
      return activeByThread.size > 0
    },
    async settleActiveRuns() {},
  }

  const coordinator = createAgentRuntimeCoordinator({
    store: createAgentConversationStore({ rootDir: root }),
    createRunManager(publish) {
      sendEvent = publish
      return manager
    },
    resolveProjectIdentity: async (projectPath) => ({
      id: projectPath.includes('stars') ? 'stars' : 'moon',
      path: projectPath,
    }),
  })

  return {
    coordinator,
    publish: async (event: AgentEvent) => {
      await sendEvent(event)
      if (
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        for (const [threadId, runId] of activeByThread) {
          if (runId === event.runId) activeByThread.delete(threadId)
        }
      }
    },
    counts: () => ({ startCalls, cancelCalls, answerCalls }),
  }
}

describe('agent runtime coordinator', () => {
  test('deduplicates start mutations and holds one lock per novel across renderer threads', async () => {
    const harness = await makeHarness()
    const request = {
      requestId: 'request-start-1',
      threadId: 'novel:stars',
      command: 'freeform' as const,
      prompt: '第一轮',
      projectPath: '/novels/stars',
    }

    const [first, duplicate] = await Promise.all([
      harness.coordinator.startRun(request),
      harness.coordinator.startRun(request),
    ])
    expect(first).toEqual({ runId: 'run-1' })
    expect(duplicate).toEqual(first)
    expect(harness.counts().startCalls).toBe(1)
    await expect(harness.coordinator.getProjectActivity('/novels/stars')).resolves.toMatchObject({
      active: true,
      threadId: 'novel:stars',
      runId: 'run-1',
      status: 'running',
    })

    await expect(
      harness.coordinator.startRun({
        ...request,
        requestId: 'request-start-2',
        threadId: 'another-window-thread',
      }),
    ).rejects.toThrow('当前小说已有 Agent 任务运行中')

    await expect(
      harness.coordinator.startRun({
        ...request,
        requestId: 'request-start-spoofed',
        threadId: 'novel:forged',
        projectPath: '/novels/unknown',
      }),
    ).rejects.toThrow('threadId 与当前小说身份不匹配')

    await expect(
      harness.coordinator.startRun({
        ...request,
        requestId: 'request-start-3',
        threadId: 'novel:moon',
        projectPath: '/novels/moon',
      }),
    ).resolves.toEqual({ runId: 'run-2' })
  })

  test('keeps running without subscribers and releases the project lock only after terminal publish', async () => {
    const harness = await makeHarness()
    const received: string[] = []
    const unsubscribe = harness.coordinator.subscribe({
      id: 'renderer-1',
      send: (event) => received.push(event.payload.type),
    })
    const started = await harness.coordinator.startRun({
      requestId: 'request-start-1',
      threadId: 'novel:stars',
      command: 'freeform',
      prompt: '第一轮',
      projectPath: '/novels/stars',
    })
    unsubscribe()

    await harness.publish({
      type: 'run.completed',
      runId: started.runId,
      createdAt: '2026-07-24T12:01:00.000Z',
    })
    expect(received).toEqual(['run.accepted', 'run.started'])

    await expect(
      harness.coordinator.startRun({
        requestId: 'request-start-2',
        threadId: 'novel:stars',
        command: 'freeform',
        prompt: '第二轮',
        projectPath: '/novels/stars',
      }),
    ).resolves.toEqual({ runId: 'run-2' })
  })

  test('releases the project lock after side effects but before broadcasting the terminal event', async () => {
    const harness = await makeHarness()
    const started = await harness.coordinator.startRun({
      requestId: 'request-start-1',
      threadId: 'novel:stars',
      command: 'freeform',
      prompt: '第一轮',
      projectPath: '/novels/stars',
    })
    let followUp: Promise<{ runId: string }> | undefined
    harness.coordinator.subscribe({
      id: 'renderer-1',
      send: (event) => {
        if (event.payload.type !== 'run.completed') return
        followUp = harness.coordinator.startRun({
          requestId: 'request-start-2',
          threadId: 'novel:stars',
          command: 'freeform',
          prompt: '第二轮',
          projectPath: '/novels/stars',
        })
      },
    })

    await harness.publish({
      type: 'run.completed',
      runId: started.runId,
      createdAt: '2026-07-24T12:01:00.000Z',
    })
    await expect(followUp).resolves.toEqual({ runId: 'run-2' })
  })

  test('deduplicates cancel and answer mutations independently', async () => {
    const harness = await makeHarness()
    await Promise.all([
      harness.coordinator.cancelRun({ requestId: 'cancel-1', runId: 'run-1' }),
      harness.coordinator.cancelRun({ requestId: 'cancel-1', runId: 'run-1' }),
    ])
    await Promise.all([
      harness.coordinator.answerQuestion({
        requestId: 'answer-1',
        questionRequestId: 'question-1',
        answers: { 选择: 'A' },
      }),
      harness.coordinator.answerQuestion({
        requestId: 'answer-1',
        questionRequestId: 'question-1',
        answers: { 选择: 'A' },
      }),
    ])
    expect(harness.counts()).toMatchObject({ cancelCalls: 1, answerCalls: 1 })
  })

  test('gives project backup an exclusive lock against Agent runs and project writes', async () => {
    const harness = await makeHarness()
    let releaseBackup!: () => void
    const backupGate = new Promise<void>((resolve) => {
      releaseBackup = resolve
    })
    const backup = harness.coordinator.runProjectBackup('/novels/stars', async () => {
      await backupGate
      return 'backed-up'
    })
    await Promise.resolve()

    await expect(
      harness.coordinator.runProjectMutation('/novels/stars', async () => 'saved'),
    ).rejects.toThrow('当前小说正在备份')
    await expect(
      harness.coordinator.startRun({
        requestId: 'request-during-backup',
        threadId: 'novel:stars',
        command: 'freeform',
        prompt: '不能开始',
        projectPath: '/novels/stars',
      }),
    ).rejects.toThrow('当前小说正在备份')

    releaseBackup()
    await expect(backup).resolves.toBe('backed-up')
    await expect(
      harness.coordinator.runProjectMutation('/novels/stars', async () => 'saved'),
    ).resolves.toBe('saved')
  })

  test('rejects backup while a save or Agent run is active and releases locks after completion', async () => {
    const harness = await makeHarness()
    let releaseMutation!: () => void
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })
    const mutation = harness.coordinator.runProjectMutation('/novels/stars', async () => {
      await mutationGate
    })
    await Promise.resolve()
    await expect(
      harness.coordinator.runProjectBackup('/novels/stars', async () => undefined),
    ).rejects.toThrow('保存或恢复操作尚未完成')
    releaseMutation()
    await mutation

    const started = await harness.coordinator.startRun({
      requestId: 'request-before-backup',
      threadId: 'novel:stars',
      command: 'freeform',
      prompt: '正在运行',
      projectPath: '/novels/stars',
    })
    await expect(
      harness.coordinator.runProjectBackup('/novels/stars', async () => undefined),
    ).rejects.toThrow('当前小说已有 Agent 任务运行中')
    await harness.publish({
      type: 'run.completed',
      runId: started.runId,
      createdAt: '2026-07-24T12:01:00.000Z',
    })
    await expect(
      harness.coordinator.runProjectBackup('/novels/stars', async () => 'ok'),
    ).resolves.toBe('ok')
  })

  test('creates exactly one divider when starting a new conversation', async () => {
    const harness = await makeHarness()
    const started = await harness.coordinator.startRun({
      requestId: 'request-start-divider',
      threadId: 'novel:stars',
      command: 'freeform',
      prompt: '旧对话',
      projectPath: '/novels/stars',
    })
    await harness.publish({
      type: 'run.completed',
      runId: started.runId,
      createdAt: '2026-07-24T12:01:00.000Z',
    })

    const next = await harness.coordinator.startNewConversation({
      threadId: 'novel:stars',
      requestId: 'request-new-conversation',
    })
    expect(next.history.map((message) => message.role)).toEqual(['divider'])
    expect(next.previousSegmentId).toBeDefined()

    const previous = await harness.coordinator.getThreadSnapshot(
      'novel:stars',
      next.previousSegmentId,
    )
    expect(previous.history.filter((message) => message.role === 'divider')).toEqual([])
  })
})
