// 展开态渲染断言走 SSR + 独立导出的 AgentSubagentGroupChildren（不摸真实 DOM click）——同
// LearnFromBookView.test.tsx 的打法：折叠/展开是纯 useState 驱动的 UI 细节，SSR 测不到点击后的
// 状态转换，但 children 明细行的渲染逻辑本身是纯展示，拆出来单独按 props 断言就够。
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentSubagentGroupChildren, AgentSubagentGroupRow } from './AgentSubagentGroupRow'
import type { AgentMessagePart } from '@shared/types/agent'

type TaskPart = Extract<AgentMessagePart, { type: 'tool-call' }>

describe('AgentSubagentGroupRow', () => {
  test('折叠态渲染 agent 名 + 最后一个 running 子项的 toolPhrase', () => {
    const part: TaskPart = {
      id: 'task-1',
      type: 'tool-call',
      toolCallId: 'task-1',
      toolName: 'Task',
      title: '派发子 agent',
      status: 'running',
      input: { subagent_type: 'narracat:chapter-writer' },
      children: [
        {
          toolCallId: 'child-1',
          toolName: 'Read',
          title: '读取大纲',
          status: 'complete',
          input: { file_path: 'outline.md' },
        },
        {
          toolCallId: 'child-2',
          toolName: 'Write',
          title: '写入草稿',
          status: 'running',
          input: { file_path: 'manuscript/ch001.md' },
        },
      ],
    }

    const html = renderToStaticMarkup(<AgentSubagentGroupRow part={part} />)

    expect(html).toContain('章节写手Agent')
    expect(html).toContain('正在写入 ch001.md')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('读取大纲')
  })

  test('无 children 时显示「正在准备」态，不带展开箭头', () => {
    const part: TaskPart = {
      id: 'task-2',
      type: 'tool-call',
      toolCallId: 'task-2',
      toolName: 'Task',
      title: '派发子 agent',
      status: 'running',
      input: { subagent_type: 'narracat:chapter-writer' },
    }

    const html = renderToStaticMarkup(<AgentSubagentGroupRow part={part} />)

    expect(html).toContain('章节写手Agent')
    expect(html).toContain('正在准备')
    // 无 children 时没有可展开的明细，AgentProcessRow 不渲染 aria-expanded（也不渲染展开箭头）。
    expect(html).not.toContain('aria-expanded')
  })

  test('status=failed 渲染失败态', () => {
    const part: TaskPart = {
      id: 'task-3',
      type: 'tool-call',
      toolCallId: 'task-3',
      toolName: 'Task',
      title: '派发子 agent',
      status: 'failed',
      input: { subagent_type: 'narracat:chapter-writer' },
      error: '子 agent 中断',
      children: [
        {
          toolCallId: 'child-1',
          toolName: 'Write',
          title: '写入草稿',
          status: 'failed',
          error: '写入失败',
        },
      ],
    }

    const html = renderToStaticMarkup(<AgentSubagentGroupRow part={part} />)

    expect(html).toContain('章节写手Agent')
    expect(html).toContain('中断')
    expect(html).toContain('text-warning')
  })

  test('展开态逐行列出 children 明细（复用 AgentToolCallRow）', () => {
    const html = renderToStaticMarkup(
      <AgentSubagentGroupChildren
        children={[
          {
            toolCallId: 'child-1',
            toolName: 'Read',
            title: '读取大纲',
            status: 'complete',
            input: { file_path: 'outline.md' },
          },
          {
            toolCallId: 'child-2',
            toolName: 'Write',
            title: '写入草稿',
            status: 'complete',
            input: { file_path: 'manuscript/ch001.md' },
          },
        ]}
      />,
    )

    expect(html).toContain('读取 outline.md')
    expect(html).toContain('写入 ch001.md')
  })

  test('未登记的 subagent_type 回退展示 normalizeAgentType 结果', () => {
    const part: TaskPart = {
      id: 'task-5',
      type: 'tool-call',
      toolCallId: 'task-5',
      toolName: 'Agent',
      title: '派发子 agent',
      status: 'running',
      input: { subagent_type: 'unknown-role' },
    }

    const html = renderToStaticMarkup(<AgentSubagentGroupRow part={part} />)

    expect(html).toContain('unknown-role')
  })
})
