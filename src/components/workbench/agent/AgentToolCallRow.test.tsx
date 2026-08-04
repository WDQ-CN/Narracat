import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentToolCallRow } from './AgentToolCallRow'
import type { AgentMessagePart } from '@shared/types/agent'

type ToolCallPart = Extract<AgentMessagePart, { type: 'tool-call' }>

describe('AgentToolCallRow', () => {
  test('collapses running tool calls by default', () => {
    const part: ToolCallPart = {
      id: 'tool-1',
      type: 'tool-call',
      toolCallId: 'tool-1',
      toolName: 'Read',
      title: '读取资料',
      status: 'running',
      input: { file_path: 'chapter.md' },
    }

    const html = renderToStaticMarkup(<AgentToolCallRow part={part} />)

    expect(html).toContain('正在读取 chapter.md...')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('等待工具返回结果')
    expect(html).not.toContain('rounded-card border')
  })

  test('collapses completed tool calls by default', () => {
    const part: ToolCallPart = {
      id: 'tool-2',
      type: 'tool-call',
      toolCallId: 'tool-2',
      toolName: 'NarraCat',
      title: '生成草稿',
      status: 'complete',
      summary: '生成完成',
      result: '完整工具结果',
    }

    const html = renderToStaticMarkup(<AgentToolCallRow part={part} />)

    expect(html).toContain('生成完成')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('工具调用已完成')
    expect(html).not.toContain('完整工具结果')
    expect(html).not.toContain('rounded-card border')
  })
})
