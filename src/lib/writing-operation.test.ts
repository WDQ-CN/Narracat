import { describe, expect, test } from 'bun:test'
import { createEmptyAgentThread, reduceAgentEvent } from './agent-events'
import { getWritingOperationState } from './writing-operation'
import type { AgentEvent } from '@shared/types/agent'
import type { NovelChapterArtifacts } from '@shared/types/novel'

const started: AgentEvent = {
  type: 'run.started',
  runId: 'run-1',
  threadId: 'thread-1',
  command: 'write-next',
  prompt: '继续写下一章',
  projectPath: '/novels/stars',
  selectedChapter: 1,
  createdAt: '2026-05-03T00:00:00.000Z',
}

describe('writing operation model', () => {
  test('returns idle copy when no side-effect operation exists', () => {
    expect(getWritingOperationState(createEmptyAgentThread('thread-1'), null)).toMatchObject({
      status: 'idle',
      title: '写作操作台',
      canRetry: false,
    })
  })

  test('shows active write-next phases', () => {
    const thread = [started].reduce(reduceAgentEvent, createEmptyAgentThread('thread-1'))
    const state = getWritingOperationState(thread, null)

    expect(state.status).toBe('running')
    expect(state.title).toBe('第 1 章写作中')
    expect(state.phases.map((phase) => phase.id)).toEqual(['preflight', 'context', 'manuscript', 'review', 'project'])
    expect(state.phases[0]).toMatchObject({ status: 'running' })
  })

  test('shows active recover-write phases as chapter recovery', () => {
    const thread = [
      {
        ...started,
        command: 'recover-write',
        prompt: '继续完成本章',
      } satisfies AgentEvent,
    ].reduce(reduceAgentEvent, createEmptyAgentThread('thread-1'))
    const state = getWritingOperationState(thread, null)

    expect(state.status).toBe('running')
    expect(state.title).toBe('第 1 章恢复中')
    expect(state.phases.map((phase) => phase.id)).toEqual(['preflight', 'context', 'manuscript', 'review', 'project'])
  })

  test('keeps an interrupted recovery title on its run target while another chapter is open', () => {
    const thread = [
      {
        ...started,
        command: 'recover-write',
        prompt: '继续完成第 3 章',
        selectedChapter: undefined,
        target: {
          sectionId: 'blueprint',
          tabId: 'chapter-3',
          objectId: 'chapter-3',
        },
      } satisfies AgentEvent,
      {
        type: 'run.interrupted',
        runId: 'run-1',
        error: 'App restarted',
        createdAt: '2026-05-03T00:01:00.000Z',
      } satisfies AgentEvent,
    ].reduce(reduceAgentEvent, createEmptyAgentThread('thread-1'))
    const chapterTwoArtifacts: NovelChapterArtifacts = {
      projectPath: '/novels/stars',
      chapterNumber: 2,
      artifacts: [],
    }

    const state = getWritingOperationState(thread, chapterTwoArtifacts)

    expect(state.title).toBe('第 3 章恢复已中断')
  })

  test('marks artifact cards from normalized chapter artifacts', () => {
    const artifacts: NovelChapterArtifacts = {
      projectPath: '/novels/stars',
      chapterNumber: 1,
      artifacts: [
        { kind: 'context-pack', title: '上下文包', path: '/novels/stars/chapters/ch001/context-pack.json', exists: true },
        { kind: 'manuscript', title: '正文', path: '/novels/stars/chapters/ch001/chapter.md', exists: true, content: '正文' },
        { kind: 'review', title: '审修报告', path: '/novels/stars/chapters/ch001/review.md', exists: false },
      ],
    }

    const state = getWritingOperationState(createEmptyAgentThread('thread-1'), artifacts)
    expect(state.availableArtifactCount).toBe(2)
    expect(state.missingArtifactCount).toBe(1)
    expect(state.artifacts).toMatchObject([
      { kind: 'context-pack', status: 'available' },
      { kind: 'manuscript', status: 'available' },
      { kind: 'review', status: 'missing' },
    ])
  })

  test('exposes retry after failed write-next run', () => {
    const thread = [
      {
        ...started,
        target: {
          sectionId: 'settings',
          tabId: 'foundation',
          objectId: 'foundation',
        },
      } satisfies AgentEvent,
      {
        type: 'run.failed',
        runId: 'run-1',
        error: 'outline missing',
        createdAt: '2026-05-03T00:01:00.000Z',
      } satisfies AgentEvent,
    ].reduce(reduceAgentEvent, createEmptyAgentThread('thread-1'))

    const state = getWritingOperationState(thread, null)
    expect(state.status).toBe('failed')
    expect(state.canRetry).toBe(true)
    expect(state.retryRequest).toMatchObject({
      command: 'write-next',
      projectPath: '/novels/stars',
      selectedChapter: 1,
      target: {
        sectionId: 'settings',
        tabId: 'foundation',
        objectId: 'foundation',
      },
    })
  })

  test('routes an interrupted write through recover-write instead of replaying write-next', () => {
    const thread = [
      started,
      {
        type: 'run.interrupted',
        runId: 'run-1',
        error: 'App restarted',
        createdAt: '2026-05-03T00:01:00.000Z',
      } satisfies AgentEvent,
    ].reduce(reduceAgentEvent, createEmptyAgentThread('thread-1'))

    const state = getWritingOperationState(thread, null)
    expect(state.retryLabel).toBe('继续完成本章')
    expect(state.retryRequest).toMatchObject({
      command: 'recover-write',
      prompt: '继续完成本章',
      projectPath: '/novels/stars',
      selectedChapter: 1,
    })
  })

  test('checks existing artifacts before continuing another interrupted project mutation', () => {
    const thread = [
      {
        ...started,
        command: 'world',
        prompt: '完善世界观',
        projectPath: undefined,
      } satisfies AgentEvent,
      {
        type: 'run.interrupted',
        runId: 'run-1',
        error: 'App restarted',
        createdAt: '2026-05-03T00:01:00.000Z',
      } satisfies AgentEvent,
    ].reduce(reduceAgentEvent, createEmptyAgentThread('thread-1'))

    const state = getWritingOperationState(thread, null, '/novels/stars')
    expect(state.retryLabel).toBe('检查并继续')
    expect(state.retryRequest).toMatchObject({
      command: 'freeform',
      engineContext: true,
      projectPath: '/novels/stars',
    })
    expect(state.retryRequest?.prompt).toContain('先检查项目中已经生成或修改的产物')
  })
})
