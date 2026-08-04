import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AgentMessageItem, getProcessGroupCollapseKey, getProcessGroupKey } from './AgentMessageItem'
import type { AgentMessage, AgentMessagePart } from '@shared/types/agent'

describe('AgentMessageItem', () => {
  test('groups assistant thinking and tool calls into one compact process row before text output', () => {
    const message: AgentMessage = {
      id: 'assistant-run-2',
      role: 'assistant',
      createdAt: '2026-04-27T00:00:00.000Z',
      status: 'running',
      parts: [
        {
          id: 'reasoning-1',
          type: 'reasoning',
          text: '需要先检查项目结构',
          status: 'complete',
        },
        {
          id: 'tool-1',
          type: 'tool-call',
          toolCallId: 'tool-1',
          toolName: 'Read',
          title: 'Read',
          status: 'complete',
          input: { file_path: 'bible/premise.md' },
          summary: '读取文件',
        },
        {
          id: 'tool-2',
          type: 'tool-call',
          toolCallId: 'tool-2',
          toolName: 'Bash',
          title: 'Bash',
          status: 'running',
          input: { command: 'ls bible' },
        },
        {
          id: 'text-1',
          type: 'text',
          text: '前置检查完成：\n\n| 检查项 | 状态 |\n|---|---|\n| `bible/premise.md` | 📝 空模板 |',
          status: 'running',
        },
      ],
    }

    const html = renderToStaticMarkup(<AgentMessageItem message={message} />)

    expect(html).toContain('data-agent-process-stream="true"')
    expect(html.match(/data-agent-process-stream="true"/g)).toHaveLength(1)
    expect(html).toContain('执行过程：正在执行 ls bible... · 已完成 2 项')
    expect(html).toContain('data-agent-running-markdown="true"')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('<td')
    expect(html).not.toContain('需要先检查项目结构')
    expect(html).not.toContain('读取文件')
  })

  test('keeps Agent text and questions outside process compaction boundaries', () => {
    const message: AgentMessage = {
      id: 'assistant-run-3',
      role: 'assistant',
      createdAt: '2026-04-27T00:00:00.000Z',
      status: 'running',
      parts: [
        {
          id: 'tool-1',
          type: 'tool-call',
          toolCallId: 'tool-1',
          toolName: 'Read',
          title: 'Read',
          status: 'complete',
          input: { file_path: 'bible/world.md' },
          summary: '读取 world.md',
        },
        {
          id: 'text-1',
          type: 'text',
          text: '我已经读完世界观，下面需要确认方向。',
          status: 'complete',
        },
        {
          id: 'question-1',
          type: 'question',
          questionRequestId: 'tool-question-1',
          toolCallId: 'tool-question-1',
          status: 'running',
          questions: [
            {
              header: '方向',
              question: '下一步优先推进什么？',
              options: [
                { label: '主线', description: '先推进主线冲突' },
                { label: '人物', description: '先补角色动机' },
              ],
            },
          ],
        },
        {
          id: 'tool-2',
          type: 'tool-call',
          toolCallId: 'tool-2',
          toolName: 'Write',
          title: 'Write',
          status: 'running',
          input: { file_path: 'bible/characters.md', content: '角色设定' },
        },
      ],
    }

    const html = renderToStaticMarkup(<AgentMessageItem message={message} />)

    expect(html.match(/data-agent-process-stream="true"/g)).toHaveLength(2)
    expect(html).toContain('执行过程已完成 · 1 项')
    expect(html).toContain('执行过程：正在写入 characters.md +1... · 已完成 0 项')
    expect(html).toContain('我已经读完世界观，下面需要确认方向。')
    expect(html).toContain('NarraCat 需要你选择')
    expect(html).toContain('下一步优先推进什么？')
  })

  test('shows a lightweight process row for a running assistant message with no parts', () => {
    const message: AgentMessage = {
      id: 'assistant-run-1',
      role: 'assistant',
      createdAt: '2026-04-27T00:00:00.000Z',
      status: 'running',
      parts: [],
    }

    const html = renderToStaticMarkup(<AgentMessageItem message={message} />)

    expect(html).toContain('思考中...')
    expect(html).toContain('animate-spin')
    expect(html).not.toContain('Agent 正在思考')
    expect(html).not.toContain('rounded-full')
    expect(html).not.toContain('ring-1')
  })

  test('renders user messages as design-system chat bubbles', () => {
    const message: AgentMessage = {
      id: 'user-run-1',
      role: 'user',
      createdAt: '2026-04-27T00:00:00.000Z',
      status: 'complete',
      parts: [
        {
          id: 'text-1',
          type: 'text',
          text: '帮我审修当前章节',
          status: 'complete',
        },
      ],
    }

    const html = renderToStaticMarkup(<AgentMessageItem message={message} />)

    expect(html).toContain('rounded-bubble')
    expect(html).toContain('bg-active')
    expect(html).not.toContain('bg-floating')
    expect(html).not.toContain('border-border-strong')
    expect(html).not.toContain('shadow-')
    expect(html).not.toContain('rounded-card border border-border bg-active')
    expect(html).not.toContain('data-agent-task-card="true"')
  })

  test('renders action-origin user messages as a task card instead of a chat bubble', () => {
    const message: AgentMessage = {
      id: 'user-run-2',
      role: 'user',
      createdAt: '2026-04-27T00:00:00.000Z',
      status: 'complete',
      origin: 'action',
      command: 'write-next',
      parts: [
        {
          id: 'text-1',
          type: 'text',
          text: '继续写下一章',
          status: 'complete',
        },
      ],
    }

    const html = renderToStaticMarkup(<AgentMessageItem message={message} />)

    expect(html).toContain('data-agent-task-card="true"')
    expect(html).toContain('继续写下一章')
    expect(html).not.toContain('rounded-bubble')
  })

  test('keeps the same process stream key while new process steps append', () => {
    const firstPart: AgentMessagePart = {
      id: 'tool-1',
      type: 'tool-call',
      toolCallId: 'tool-1',
      toolName: 'Read',
      title: 'Read',
      status: 'complete',
      input: { file_path: 'bible/world.md' },
    }
    const nextPart: AgentMessagePart = {
      id: 'tool-2',
      type: 'tool-call',
      toolCallId: 'tool-2',
      toolName: 'Write',
      title: 'Write',
      status: 'running',
      input: { file_path: 'bible/characters.md', content: '角色设定' },
    }

    expect(getProcessGroupKey([firstPart])).toBe(getProcessGroupKey([firstPart, nextPart]))
    expect(getProcessGroupCollapseKey([firstPart, nextPart], undefined)).toBeUndefined()
  })

  test('renders a conversation divider for divider-role messages', () => {
    const message: AgentMessage = {
      id: 'divider-1',
      role: 'divider',
      createdAt: '2026-06-25T00:00:00.000Z',
      status: 'complete',
      parts: [],
    }

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AgentMessageItem message={message} />
      </TooltipProvider>
    )

    expect(html).toContain('data-agent-conversation-divider="true"')
    expect(html).toContain('新对话')
    // 不套用 user/assistant 气泡外壳
    expect(html).not.toContain('rounded-bubble')
  })

  test('collapses a completed process segment only when assistant text follows it', () => {
    const processParts: AgentMessagePart[] = [
      {
        id: 'tool-1',
        type: 'tool-call',
        toolCallId: 'tool-1',
        toolName: 'Read',
        title: 'Read',
        status: 'complete',
        input: { file_path: 'bible/world.md' },
      },
    ]
    const textPart: AgentMessagePart = {
      id: 'text-1',
      type: 'text',
      text: '我已经整理完。',
      status: 'running',
    }
    const questionPart: AgentMessagePart = {
      id: 'question-1',
      type: 'question',
      questionRequestId: 'question-1',
      toolCallId: 'question-1',
      status: 'running',
      questions: [],
    }

    expect(getProcessGroupCollapseKey(processParts, undefined)).toBeUndefined()
    expect(getProcessGroupCollapseKey(processParts, questionPart)).toBeUndefined()
    expect(getProcessGroupCollapseKey(processParts, textPart)).toBe('process-tool-1-after-output')
  })
})
