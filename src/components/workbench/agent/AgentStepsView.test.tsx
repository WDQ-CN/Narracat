import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentStepsView } from './AgentStepsView'
import type { AgentStep } from '@/lib/agent-panel'

describe('AgentStepsView', () => {
  test('uses compact horizontal padding for step rows', () => {
    const steps: AgentStep[] = [
      {
        id: 'step-1',
        title: '准备上下文包',
        detail: '正在整理章节资料',
        status: 'running',
      },
      {
        id: 'step-2',
        title: '生成草稿',
        detail: '等待执行',
        status: 'complete',
      },
    ]

    const html = renderToStaticMarkup(<AgentStepsView steps={steps} />)

    expect(html).toContain('overflow-auto px-3 py-3')
    expect(html).toContain('rounded-row px-2')
    expect(html).not.toContain('overflow-auto px-4')
  })
})
