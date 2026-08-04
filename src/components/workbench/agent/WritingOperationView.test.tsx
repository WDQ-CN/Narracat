import { beforeEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WritingOperationView } from './WritingOperationView'
import { createEmptyAgentThread, reduceAgentEvent } from '@/lib/agent-events'
import { useAgentStore } from '@/lib/agent-store'
import { useNovelStore } from '@/lib/novel-store'
import type { AgentEvent } from '@shared/types/agent'
import type { NovelChapterArtifacts } from '@shared/types/novel'

beforeEach(() => {
  useAgentStore.getState().resetAgentState()
  useNovelStore.getState().resetNovelState()
})

describe('WritingOperationView', () => {
  test('renders idle operation console without replacing chat', () => {
    const html = renderToStaticMarkup(<WritingOperationView />)

    expect(html).toContain('写作操作台')
    expect(html).toContain('阶段流')
    expect(html).toContain('产物')
    expect(html).toContain('自然语言对话仍然可用')
    expect(html).not.toContain('高级日志')
  })

  test('renders active write-next phases', () => {
    const thread = [
      {
        type: 'run.started',
        runId: 'run-1',
        threadId: 'thread-1',
        command: 'write-next',
        prompt: '继续写下一章',
        projectPath: '/novels/stars',
        selectedChapter: 1,
        createdAt: '2026-05-03T00:00:00.000Z',
      } satisfies AgentEvent,
    ].reduce(reduceAgentEvent, createEmptyAgentThread('thread-1'))

    const html = renderToStaticMarkup(<WritingOperationView thread={thread} />)
    expect(html).toContain('第 1 章写作中')
    expect(html).toContain('写前预检')
    expect(html).toContain('上下文包')
    expect(html).toContain('章节正文')
    expect(html).toContain('审修报告')
  })

  test('renders artifact card availability', () => {
    const chapterArtifacts = {
      projectPath: '/novels/stars',
      chapterNumber: 1,
      artifacts: [
        { kind: 'context-pack', title: '上下文包', path: '/novels/stars/context.json', exists: true },
        { kind: 'manuscript', title: '正文', path: '/novels/stars/chapter.md', exists: false },
      ],
    } satisfies NovelChapterArtifacts

    const html = renderToStaticMarkup(<WritingOperationView chapterArtifacts={chapterArtifacts} />)
    expect(html).toContain('产物')
    expect(html).toContain('已生成 1 个')
    expect(html).toContain('等待 1 个')
    expect(html).toContain('已生成')
    expect(html).toContain('等待生成')
  })
})
