import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AgentProfileInspector, NARRACAT_AGENT_PROFILES } from './AgentProfileInspector'

// AuthorRequestPanel（作者「我对它的要求」面板）用 IconTooltip 做说明气泡，SSR 需 TooltipProvider 上下文
function renderInspector(node: ReactElement): string {
  return renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
}

describe('AgentProfileInspector', () => {
  test('keeps the five built-in NarraCat Agent profiles in workflow order', () => {
    expect(NARRACAT_AGENT_PROFILES.map((agent) => agent.id)).toEqual([
      'outline-architect',
      'world-curator',
      'chapter-writer',
      'continuity-editor',
      'memory-keeper',
    ])

    expect(NARRACAT_AGENT_PROFILES.map((agent) => agent.name)).toEqual([
      '大纲架构师',
      '世界观策展人',
      '章节写手',
      '审校编辑',
      '记忆管理员',
    ])

    for (const agent of NARRACAT_AGENT_PROFILES) {
      expect(agent.introduction.length).toBeGreaterThan(0)
      expect(agent.imageUrl).toContain(`${agent.id}.webp`)
    }
  })

  test('renders prototype D structure with an integrated Agent introduction and skill list', () => {
    const html = renderInspector(<AgentProfileInspector />)

    expect(html).toContain('data-agent-profile-inspector="true"')
    expect(html).toContain('data-agent-profile-tabs="true"')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('data-agent-profile-panel="chapter-writer"')
    expect(html).toContain('animate-agent-profile-enter')
    expect(html).toContain('data-agent-profile-stage="true"')
    expect(html).toContain('data-agent-profile-portrait="true"')
    expect(html).toContain('章节写手')
    expect(html).toContain('data-agent-profile-introduction="true"')
    expect(html).toContain('在大纲和上下文约束下生成章节正文')
    expect(html).toContain('边界是不改大纲、设定、审修报告或 NovelMemory')
    expect(html).not.toContain('data-agent-profile-inspector-notice="true"')
    expect(html).not.toContain('data-agent-profile-ground-shadow="true"')
    expect(html).not.toContain('bg-foreground/10 blur-2xl')
    expect(html).not.toContain('应用级只读视图')
    expect(html).not.toContain('当前版本不可查看、禁用或编辑')
    expect(html).not.toContain('data-agent-profile-info-list="true"')
    expect(html).not.toContain('能力边界')
    expect(html).not.toContain('内部职责')
    expect(html).not.toContain('sm:w-[520px] sm:max-w-[64%]')
    expect(html).not.toContain('sm:grid-cols-[8rem_minmax(0,1fr)]')
    expect(html).not.toContain('font-mono text-xs font-semibold leading-5')
    expect(html).not.toContain('原始 prompt')
    expect(html).not.toContain('创建 Skill')
    expect(html).not.toContain('role="switch"')
  })

  test('档案页含「我对它的要求」区块', () => {
    const html = renderInspector(<AgentProfileInspector initialAgentId="chapter-writer" />)
    expect(html).toContain('我对它的要求')
  })
})
