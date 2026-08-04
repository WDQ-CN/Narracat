import { beforeEach, describe, expect, test } from 'bun:test'
import { useAgentStore } from './agent-store'

beforeEach(() => {
  useAgentStore.getState().resetAgentState()
})

describe('useAgentStore', () => {
  test('selects a project thread without clearing another novel transcript', () => {
    const projectA = { id: 'stars', path: '/novels/stars' }
    const projectB = { id: 'moon', path: '/novels/moon' }
    const threadA = 'novel:stars'
    const threadB = 'novel:moon'

    expect(typeof useAgentStore.getState().selectProjectThread).toBe('function')
    useAgentStore.getState().selectProjectThread(projectA)
    useAgentStore.getState().applyAgentEvent({
      type: 'run.started',
      runId: 'run-a',
      threadId: threadA,
      command: 'write-next',
      prompt: '写星河下一章',
      createdAt: '2026-04-27T00:00:00.000Z',
    })

    useAgentStore.getState().selectProjectThread(projectB)
    expect(useAgentStore.getState().activeThreadId).toBe(threadB)
    expect(useAgentStore.getState().threadsById[threadB]?.messages).toHaveLength(0)

    useAgentStore.getState().applyAgentEvent({
      type: 'run.started',
      runId: 'run-b',
      threadId: threadB,
      command: 'review',
      prompt: '审修月影当前章',
      createdAt: '2026-04-27T00:01:00.000Z',
    })

    useAgentStore.getState().selectProjectThread(projectA)
    expect(useAgentStore.getState().activeThreadId).toBe(threadA)
    expect(useAgentStore.getState().threadsById[threadA]?.activeRun?.id).toBe('run-a')
    expect(useAgentStore.getState().threadsById[threadB]?.activeRun?.id).toBe('run-b')
  })

  test('keeps the visible project thread active when background events arrive', () => {
    const projectA = { id: 'stars', path: '/novels/stars' }
    const projectB = { id: 'moon', path: '/novels/moon' }
    const threadA = 'novel:stars'
    const threadB = 'novel:moon'

    expect(typeof useAgentStore.getState().selectProjectThread).toBe('function')
    useAgentStore.getState().selectProjectThread(projectB)
    useAgentStore.getState().applyAgentEvent({
      type: 'run.started',
      runId: 'run-a',
      threadId: threadA,
      command: 'write-next',
      prompt: '写星河下一章',
      createdAt: '2026-04-27T00:00:00.000Z',
    })
    useAgentStore.getState().applyAgentEvent({
      type: 'message.delta',
      runId: 'run-a',
      messageId: 'assistant-run-a',
      text: '星河输出',
      createdAt: '2026-04-27T00:00:01.000Z',
    })

    expect(useAgentStore.getState().activeThreadId).toBe(threadB)
    expect(useAgentStore.getState().threadsById[threadA]?.messages.at(-1)?.parts).toContainEqual({
      id: 'part-assistant-run-a-text',
      type: 'text',
      text: '星河输出',
      status: 'running',
    })
    expect(useAgentStore.getState().threadsById[threadB]?.messages).toHaveLength(0)
  })

  test('applies events to the active workbench thread', () => {
    useAgentStore.getState().applyAgentEvent({
      type: 'run.started',
      runId: 'run-1',
      threadId: 'thread-1',
      command: 'write-next',
      prompt: '写下一章',
      createdAt: '2026-04-27T00:00:00.000Z',
    })

    const thread = useAgentStore.getState().threadsById['thread-1']
    expect(thread?.activeRun?.id).toBe('run-1')
    expect(useAgentStore.getState().activeThreadId).toBe('workbench-placeholder')
  })

  test('applies a batch of streaming events with one store notification', () => {
    let updateCount = 0
    const unsubscribe = useAgentStore.subscribe(() => {
      updateCount += 1
    })

    useAgentStore.getState().applyAgentEvents([
      {
        type: 'run.started',
        runId: 'run-batch',
        threadId: 'thread-batch',
        command: 'freeform',
        prompt: '生成长输出',
        createdAt: '2026-05-24T00:00:00.000Z',
      },
      {
        type: 'message.delta',
        runId: 'run-batch',
        messageId: 'assistant-run-batch',
        text: '第一段',
        createdAt: '2026-05-24T00:00:01.000Z',
      },
      {
        type: 'message.delta',
        runId: 'run-batch',
        messageId: 'assistant-run-batch',
        text: '第二段',
        createdAt: '2026-05-24T00:00:02.000Z',
      },
    ])
    unsubscribe()

    const thread = useAgentStore.getState().threadsById['thread-batch']
    expect(updateCount).toBe(1)
    expect(thread?.messages.at(-1)?.parts).toContainEqual({
      id: 'part-assistant-run-batch-text',
      type: 'text',
      text: '第一段第二段',
      status: 'running',
    })
  })

  test('scopes composer handoff and focused question state to the active project thread', () => {
    const projectA = { id: 'stars', path: '/novels/stars' }
    const projectB = { id: 'moon', path: '/novels/moon' }
    const threadA = 'novel:stars'
    const threadB = 'novel:moon'

    expect(typeof useAgentStore.getState().selectProjectThread).toBe('function')
    useAgentStore.getState().selectProjectThread(projectA)
    useAgentStore.getState().applyAgentEvent({
      type: 'run.started',
      runId: 'run-1',
      threadId: threadA,
      command: 'write-next',
      prompt: '写下一章',
      createdAt: '2026-04-27T00:00:00.000Z',
    })
    useAgentStore.getState().requestComposerHandoff({
      sourceActionId: 'adjust-chapter-manuscript',
      command: 'rewrite',
      prompt: '需要调整第 2 章正文，要求：',
      selectedChapter: 2,
      target: {
        sectionId: 'blueprint',
        tabId: 'chapter-2',
        objectId: 'chapter-2',
      },
    })
    useAgentStore.getState().focusQuestionRequest('question-run-1')

    useAgentStore.getState().selectProjectThread(projectB)
    expect(useAgentStore.getState().composerHandoffRequestsByThreadId[threadB]).toBeUndefined()
    expect(useAgentStore.getState().focusedQuestionRequestIdsByThreadId[threadB]).toBeUndefined()

    useAgentStore.getState().selectProjectThread(projectA)
    expect(useAgentStore.getState().composerHandoffRequestsByThreadId[threadA]).toEqual({
      id: expect.stringMatching(/^handoff-/),
      sourceActionId: 'adjust-chapter-manuscript',
      command: 'rewrite',
      prompt: '需要调整第 2 章正文，要求：',
      selectedChapter: 2,
      target: {
        sectionId: 'blueprint',
        tabId: 'chapter-2',
        objectId: 'chapter-2',
      },
    })
    expect(useAgentStore.getState().focusedQuestionRequestIdsByThreadId[threadA]).toBe('question-run-1')

    useAgentStore.getState().clearComposerHandoffRequest()
    expect(useAgentStore.getState().composerHandoffRequestsByThreadId[threadA]).toBeUndefined()

    useAgentStore.getState().clearFocusedQuestionRequest()
    expect(useAgentStore.getState().focusedQuestionRequestIdsByThreadId[threadA]).toBeUndefined()

    useAgentStore.getState().focusQuestionRequest('question-run-2')
    useAgentStore.getState().resetAgentState()
    expect(useAgentStore.getState().focusedQuestionRequestIdsByThreadId[threadA]).toBeUndefined()
  })

  test('replaces local history from the main-process conversation snapshot', () => {
    const threadId = 'novel:stars'
    useAgentStore.getState().replaceThreadFromSnapshot({
      schemaVersion: 1,
      threadId,
      segmentId: 'seg-11111111-1111-1111-1111-111111111111',
      lastSeq: 2,
      contextAvailable: false,
      history: [
        {
          id: 'divider-segment',
          role: 'divider',
          createdAt: '2026-07-24T00:00:00.000Z',
          status: 'complete',
          parts: [],
        },
      ],
      activeRun: null,
      lastRun: null,
      previousSegmentId: 'seg-00000000-0000-0000-0000-000000000000',
    })

    const state = useAgentStore.getState()
    expect(state.threadsById[threadId]?.messages.map((message) => message.role)).toEqual(['divider'])
    expect(state.segmentIdByThreadId[threadId]).toBe('seg-11111111-1111-1111-1111-111111111111')
    expect(state.lastSeqByThreadId[threadId]).toBe(2)
    expect(state.previousSegmentIdByThreadId[threadId]).toBe('seg-00000000-0000-0000-0000-000000000000')
  })
})
