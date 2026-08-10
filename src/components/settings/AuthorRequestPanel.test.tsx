import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Dialog } from '@/components/ui/dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthorRequestDetailBody, AuthorRequestPanelView, summarizeRequest } from './AuthorRequestPanel'
import type { AuthorRequest } from '@shared/types/author-request'

const ONE: AuthorRequest = {
  id: 'a',
  agentId: 'chapter-writer',
  text: '少写环境描写，多写对话',
  createdAt: '2026-08-07T00:00:00.000Z',
}

// AuthorRequestPanelView 的「+」入口走 IconTooltip，SSR 需 TooltipProvider 上下文（同
// AgentProfileInspector.test.tsx 的既有写法）。
function renderPanel(node: ReactElement): string {
  return renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
}

describe('summarizeRequest（列表行摘要）', () => {
  test('单行原样返回', () => {
    expect(summarizeRequest('少写环境描写')).toBe('少写环境描写')
  })

  test('多行只取第一行', () => {
    expect(summarizeRequest('第一行\n第二行')).toBe('第一行')
  })

  test('超长截断并加省略号', () => {
    expect(summarizeRequest('很'.repeat(60))).toBe(`${'很'.repeat(40)}…`)
  })

  test('首行为空时跳到第一段有内容的行', () => {
    expect(summarizeRequest('\n\n真正的内容')).toBe('真正的内容')
  })
})

describe('AuthorRequestPanelView', () => {
  test('有要求时逐条列出摘要', () => {
    const html = renderPanel(<AuthorRequestPanelView requests={[ONE]} />)
    expect(html).toContain('我对它的要求')
    expect(html).toContain('少写环境描写，多写对话')
  })

  test('没有要求时给空状态与示例引导', () => {
    const html = renderPanel(<AuthorRequestPanelView requests={[]} />)
    expect(html).toContain('还没有')
    expect(html).toContain('少写环境描写')
  })

  test('超预算时给一句大白话提示，且不出现 token 字样', () => {
    const html = renderPanel(
      <AuthorRequestPanelView requests={[{ ...ONE, text: '很'.repeat(9000) }]} personaText="" />,
    )
    expect(html).toContain('顾不过来')
    expect(html).not.toContain('token')
  })

  test('未超预算时不出现提示', () => {
    const html = renderPanel(<AuthorRequestPanelView requests={[ONE]} personaText="" />)
    expect(html).not.toContain('顾不过来')
  })
})

describe('AuthorRequestDetailBody', () => {
  // 注：DialogTitle/DialogFooter 走 Radix Dialog.Root 上下文，脱离 <Dialog> 会抛错（同
  // AgentProseBlockPanel.test.tsx 里 ProseBlockDetailBody 的既有写法），这里同样包一层。
  test('编辑已有要求时给删除入口', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <AuthorRequestDetailBody draft={ONE.text} existing />
      </Dialog>,
    )
    expect(html).toContain('删除')
  })

  test('新增时不给删除入口', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <AuthorRequestDetailBody draft="" existing={false} />
      </Dialog>,
    )
    expect(html).not.toContain('删除')
  })

  test('不出现任何「Skill / 挂载」黑话', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <AuthorRequestDetailBody draft="" existing={false} />
      </Dialog>,
    )
    expect(html).not.toContain('Skill')
    expect(html).not.toContain('挂载')
  })
})
