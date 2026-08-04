import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentDurableEventV1, AgentEventEnvelopeV1 } from '@shared/types/agent'
import { atomicWriteFile } from '../../atomic-write'
import {
  agentConversationThreadDir,
  createAgentConversationStore,
} from './agent-conversation-store'

const roots: string[] = []
const threadId = 'novel:test-history'
const segmentOne = 'seg-11111111-1111-1111-1111-111111111111'
const segmentTwo = 'seg-22222222-2222-2222-2222-222222222222'
const occurredAt = '2026-07-24T10:00:00.000Z'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narracat-agent-history-'))
  roots.push(root)
  return root
}

function envelope(
  segmentId: string,
  seq: number,
  payload: AgentDurableEventV1,
): AgentEventEnvelopeV1 {
  return {
    schemaVersion: 1,
    eventId: `${segmentId}:${seq}`,
    threadId,
    segmentId,
    ...('runId' in payload ? { runId: payload.runId } : {}),
    seq,
    durability: 'durable',
    occurredAt: payload.createdAt,
    payload,
  }
}

describe('agent conversation store', () => {
  test('recovers durable visible history from event files across store instances', async () => {
    const root = await createRoot()
    const store = createAgentConversationStore({
      rootDir: root,
      now: () => occurredAt,
      createSegmentId: () => segmentOne,
    })
    await store.ensureActiveSegment(threadId)
    await store.appendDurableEvent(
      envelope(segmentOne, 2, {
        type: 'run.accepted',
        runId: 'run-1',
        command: 'freeform',
        visiblePrompt: '继续写这一幕',
        createdAt: occurredAt,
      }),
    )
    await store.appendDurableEvent(
      envelope(segmentOne, 4, {
        type: 'run.completed',
        runId: 'run-1',
        assistantText: '已经把冲突推进到门口。',
        usage: { inputTokens: 10, outputTokens: 20 },
        createdAt: occurredAt,
      }),
    )

    const reloaded = createAgentConversationStore({ rootDir: root })
    const snapshot = await reloaded.getThreadSnapshot(threadId)
    expect(snapshot.segmentId).toBe(segmentOne)
    expect(snapshot.lastSeq).toBe(4)
    expect(snapshot.history.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(snapshot.history[1]?.parts).toContainEqual(
      expect.objectContaining({ type: 'text', text: '已经把冲突推进到门口。' }),
    )
    expect(snapshot.lastRun).toMatchObject({ id: 'run-1', status: 'complete' })
  })

  test('rebuilds a damaged projection cache from intact durable events', async () => {
    const root = await createRoot()
    const store = createAgentConversationStore({
      rootDir: root,
      now: () => occurredAt,
      createSegmentId: () => segmentOne,
    })
    await store.ensureActiveSegment(threadId)
    await store.appendDurableEvent(
      envelope(segmentOne, 2, {
        type: 'run.accepted',
        runId: 'run-1',
        command: 'freeform',
        visiblePrompt: '你好',
        createdAt: occurredAt,
      }),
    )
    const projectionPath = join(
      agentConversationThreadDir(root, threadId),
      'segments',
      segmentOne,
      'projection.json',
    )
    await writeFile(projectionPath, '{broken', 'utf8')

    const snapshot = await createAgentConversationStore({ rootDir: root }).getThreadSnapshot(threadId)
    expect(snapshot.history[0]?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: '你好' }))
    expect(JSON.parse(await readFile(projectionPath, 'utf8')).lastSeq).toBe(2)
  })

  test('does not reuse or overwrite a committed event sequence when cache refresh fails', async () => {
    const root = await createRoot()
    const cacheErrors: string[] = []
    let failProjectionRefresh = false
    const store = createAgentConversationStore({
      rootDir: root,
      now: () => occurredAt,
      createSegmentId: () => segmentOne,
      async writeAtomically(path, data) {
        if (failProjectionRefresh && path.endsWith('projection.json')) {
          throw Object.assign(new Error('projection cache unavailable'), { code: 'EIO' })
        }
        await atomicWriteFile(path, data)
      },
      onCacheWriteError(error) {
        cacheErrors.push((error as Error).message)
      },
    })
    await store.ensureActiveSegment(threadId)

    failProjectionRefresh = true
    await store.appendDurableEvent(
      envelope(segmentOne, 2, {
        type: 'run.accepted',
        runId: 'run-1',
        command: 'freeform',
        visiblePrompt: '第一条',
        createdAt: occurredAt,
      }),
    )
    failProjectionRefresh = false
    await store.appendDurableEvent(
      envelope(segmentOne, 3, {
        type: 'run.completed',
        runId: 'run-1',
        assistantText: '第二条',
        usage: { inputTokens: 1, outputTokens: 1 },
        createdAt: occurredAt,
      }),
    )

    const eventsDir = join(
      agentConversationThreadDir(root, threadId),
      'segments',
      segmentOne,
      'events',
    )
    expect((await readdir(eventsDir)).sort()).toEqual([
      '000000000001.json',
      '000000000002.json',
      '000000000003.json',
    ])
    expect(cacheErrors).toEqual(['projection cache unavailable'])
    await expect(createAgentConversationStore({ rootDir: root }).getThreadSnapshot(threadId)).resolves.toMatchObject({
      lastSeq: 3,
      lastRun: { id: 'run-1', status: 'complete' },
    })
  })

  test('quarantines a segment with a corrupt durable event and opens a fresh segment', async () => {
    const root = await createRoot()
    const ids = [segmentOne, segmentTwo]
    const store = createAgentConversationStore({
      rootDir: root,
      now: () => occurredAt,
      createSegmentId: () => ids.shift()!,
    })
    await store.ensureActiveSegment(threadId)
    const eventPath = join(
      agentConversationThreadDir(root, threadId),
      'segments',
      segmentOne,
      'events',
      '000000000001.json',
    )
    await writeFile(eventPath, '{broken', 'utf8')
    await writeFile(
      join(agentConversationThreadDir(root, threadId), 'segments', segmentOne, 'projection.json'),
      '{broken',
      'utf8',
    )

    const snapshot = await createAgentConversationStore({
      rootDir: root,
      now: () => occurredAt,
      createSegmentId: () => segmentTwo,
    }).getThreadSnapshot(threadId)
    expect(snapshot.segmentId).toBe(segmentTwo)
    expect(snapshot.hasUnreadableHistory).toBe(true)
    const quarantine = await readdir(join(root, 'agent-state', 'v1', 'quarantine'))
    expect(quarantine.some((name) => name.includes(segmentOne))).toBe(true)
  })

  test('keeps the previous segment read-only when starting a new conversation', async () => {
    const root = await createRoot()
    const ids = [segmentOne, segmentTwo]
    const store = createAgentConversationStore({
      rootDir: root,
      now: () => occurredAt,
      createSegmentId: () => ids.shift()!,
    })
    await store.ensureActiveSegment(threadId)
    await store.appendDurableEvent(
      envelope(segmentOne, 2, {
        type: 'run.accepted',
        runId: 'run-1',
        command: 'freeform',
        visiblePrompt: '旧对话',
        createdAt: occurredAt,
      }),
    )

    const current = await store.startNewConversation(threadId, occurredAt)
    expect(current.segmentId).toBe(segmentTwo)
    expect(current.previousSegmentId).toBe(segmentOne)
    expect(current.history.map((message) => message.role)).toEqual(['divider'])

    const previous = await store.getThreadSnapshot(threadId, segmentOne)
    expect(previous.history[0]?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: '旧对话' }))
  })

  test('fails closed when the thread index belongs to a newer schema', async () => {
    const root = await createRoot()
    const dir = agentConversationThreadDir(root, threadId)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'thread.json'),
      JSON.stringify({
        schemaVersion: 2,
        threadId,
        segmentIds: [segmentOne],
        activeSegmentId: segmentOne,
      }),
      'utf8',
    )
    await expect(createAgentConversationStore({ rootDir: root }).getThreadSnapshot(threadId)).rejects.toThrow(
      '更新版本',
    )
  })
})
