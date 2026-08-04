import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentThreadContent, AgentThreadView, isAgentThreadNearBottom } from './AgentThreadView'
import { useAgentStore } from '@/lib/agent-store'

beforeEach(() => {
  useAgentStore.getState().resetAgentState()
})

describe('AgentThreadView', () => {
  test('centers an empty-state guide for a new conversation', () => {
    const html = renderToStaticMarkup(<AgentThreadView />)

    expect(html).toContain('flex min-h-0 flex-1 items-center justify-center')
    expect(html).not.toContain('data-slot="scroll-area"')
    expect(html).toContain('data-brand-illustration="agent-ready"')
    expect(html).toContain('data-size="lg"')
    expect(html).toContain('laptop-chat.webp')
    expect(html).toContain('准备开始创作')
    expect(html).toContain('选择一个指令，或直接描述你想推进的章节')
  })

  test('renders a bottom anchor for auto-scrolling new messages into view', () => {
    const html = renderToStaticMarkup(
      <AgentThreadContent
        messages={[
          {
            id: 'assistant-run-1',
            role: 'assistant',
            createdAt: '2026-05-03T00:00:01.000Z',
            status: 'running',
            parts: [{ id: 'part-1', type: 'text', text: '你好，我在。', status: 'running' }],
          },
        ]}
      />,
    )

    expect(html).toContain('data-agent-thread-end="true"')
  })

  test('detects whether the agent thread viewport is near the bottom', () => {
    expect(isAgentThreadNearBottom({ clientHeight: 400, scrollHeight: 1000, scrollTop: 536 })).toBe(true)
    expect(isAgentThreadNearBottom({ clientHeight: 400, scrollHeight: 1000, scrollTop: 535 })).toBe(false)
    expect(isAgentThreadNearBottom({ clientHeight: 400, scrollHeight: 1000, scrollTop: 500 }, 100)).toBe(true)
  })

  test('constrains the conversation scroll area to the agent panel width', () => {
    const html = renderToStaticMarkup(
      <AgentThreadContent
        messages={[
          {
            id: 'assistant-run-1',
            role: 'assistant',
            createdAt: '2026-05-03T00:00:01.000Z',
            status: 'running',
            parts: [
              {
                id: 'part-1',
                type: 'text',
                text: '路径 /Users/writer/Documents/NarraCat/very-long-project-name/bible/extremely-long-file-name-that-should-not-expand-the-side-panel.md',
                status: 'running',
              },
            ],
          },
        ]}
      />,
    )

    expect(html).toContain('data-slot="scroll-area"')
    expect(html).toContain('min-h-0 min-w-0 max-w-full flex-1 overflow-hidden')
    expect(html).toContain('[&amp;&gt;div]:!block')
    expect(html).toContain('[&amp;&gt;div]:!min-w-0')
    expect(html).toContain('w-full max-w-full overflow-x-hidden')
    expect(html).toContain('[overflow-anchor:none]')
    expect(html).toContain('data-agent-message-visibility="auto"')
    expect(html).toContain('[content-visibility:auto]')
    expect(html).toContain('[contain-intrinsic-size:auto_1px_auto_160px]')
  })

  test('scrolls a notification-focused question card into the visible agent context', () => {
    const source = readFileSync(new URL('./AgentThreadView.tsx', import.meta.url), 'utf8')

    expect(source).toContain('focusedQuestionRequestId')
    expect(source).toContain('clearFocusedQuestionRequest')
    expect(source).toContain('[data-agent-question-card]')
    expect(source).toContain("scrollIntoView({ block: 'center'")
  })

  test('tracks manual scroll state before following streaming output', () => {
    const source = readFileSync(new URL('./AgentThreadView.tsx', import.meta.url), 'utf8')

    expect(source).toContain('viewportRef')
    expect(source).toContain('onViewportScroll={handleViewportScroll}')
    expect(source).toContain('shouldStickToBottomRef')
    expect(source).toContain('data-agent-jump-to-latest="true"')
    expect(source).toContain('viewport.scrollTop = viewport.scrollHeight')
  })

  test('re-pins to bottom on post-stream layout settling while still sticky', () => {
    const source = readFileSync(new URL('./AgentThreadView.tsx', import.meta.url), 'utf8')

    // 流式结束后内容高度异步变化（content-visibility 还原真实高度、过程块折叠）须重新钉底，
    // 否则结尾被顶到视口下方；用户上滑后 shouldStickToBottomRef 为 false 时只亮「最新」按钮，不打扰。
    expect(source).toContain('new ResizeObserver(')
    expect(source).toContain('contentRef')
    expect(source).toContain('if (shouldStickToBottomRef.current) {')
    expect(source).toContain('viewport.scrollTop = viewport.scrollHeight')
  })
})
