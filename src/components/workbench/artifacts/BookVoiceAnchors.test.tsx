// 本书样章面板测试。分两段：
// ① SSR（renderToStaticMarkup）——纯展示态断言（沿用 CharacterStatePanel.test.tsx 的套路）。
// ② 真实 DOM（happy-dom + @testing-library/react，沿用 StateChangesLedger.test.tsx 的先例）——
//   覆盖 projectPath 切换时的 reload 生命周期（PR#501 评审 P1：切换小说后不得残留展示上一部
//   小说的样章，读取失败也不得静默保留旧数据）。
//
// 本文件是本仓第 4 个注册 GlobalRegistrator 的真实 DOM 测试文件（既有 3 个：
// ChapterManuscriptView.interactions.test.tsx / StateChangesLedger.test.tsx /
// AgentThreadView.interactions.test.tsx）。仓内此前有多处注释记录「同进程安全共存上限=3，
// 追加第 4 个会导致 GlobalRegistrator 生命周期互相冲盖、StateChangesLedger 全部用例失败」
// （CharacterStatePanel.test.tsx / WizardView.test.tsx / WorkshopListView.test.tsx /
// WizardView.mount.test.tsx / LearnFromBookView.test.tsx）。PR#501 评审要求不能凭一次绿判定，
// 已连续跑 10 次 `bun --no-cache run test`（全量，2564 test / 275 files，bun 1.3.14 +
// @happy-dom/global-registrator ^20.10.6）——10/10 全绿，StateChangesLedger 全部用例无一次
// 失败（2026-07-29 实测，日志见该次 PR 修复报告）。据此判定「上限=3」这条经验对当前依赖版本
// 已不成立，上述 5 处注释已同步更新为复测结论；本文件保留真实 DOM 段。新增第 5 个注册文件前，
// 仍建议按同样方法（连续 10 次全量跑）实测验证，不要直接假设可无限扩容——4 个文件安全不代表
// N 个文件安全。
import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register()

const { afterAll, afterEach, beforeEach, describe, expect, mock, test } = await import('bun:test')
const { act, cleanup, render, waitFor } = await import('@testing-library/react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { BookVoiceAnchors } = await import('./BookVoiceAnchors')

type ElectronApi = typeof window.electron

const ONE_ANCHOR = [
  { anchorId: 'ch001-1-1', chapter: 1, excerpt: '林跃把便条叠好塞进口袋。', createdAt: '2026-07-28 10:00:00' },
]

describe('BookVoiceAnchors（SSR）', () => {
  test('有样章时列出章号与预览', () => {
    // Radix 组件（Tooltip / Dialog）要求祖先有 Provider，否则 SSR 抛错；
    // 同目录 StateChangesLedger.test.tsx 已是这个套路。
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <BookVoiceAnchors projectPath="/tmp/novel" initialAnchors={ONE_ANCHOR} max={3} />
      </TooltipProvider>,
    )
    expect(html).toContain('本书样章')
    expect(html).toContain('1/3')
    expect(html).toContain('第 1 章')
    expect(html).toContain('林跃把便条叠好塞进口袋。')
  })

  test('条目是可点开详情的按钮，详情弹窗默认不渲染', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <BookVoiceAnchors projectPath="/tmp/novel" initialAnchors={ONE_ANCHOR} max={3} />
      </TooltipProvider>,
    )
    expect(html).toContain('data-book-voice-anchor-row="true"')
    // 详情（含删除入口）只在弹窗里，列表本身不挂删除按钮，也不提前渲染弹窗正文
    expect(html).not.toContain('data-book-voice-anchor-excerpt')
    expect(html).not.toContain('删除这段样章')
  })

  test('列表与字段区不再用分隔线分组（UI 降噪）', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <BookVoiceAnchors projectPath="/tmp/novel" initialAnchors={ONE_ANCHOR} max={3} />
      </TooltipProvider>,
    )
    expect(html).not.toContain('divide-y')
  })

  test('零样章时整块不渲染', () => {
    const html = renderToStaticMarkup(<BookVoiceAnchors projectPath="/tmp/novel" initialAnchors={[]} max={3} />)
    expect(html).toBe('')
  })
})

// ---------------------------------------------------------------------------
// ② 真实 DOM：projectPath 切换的 reload 生命周期
// ---------------------------------------------------------------------------

const listStyleAnchorsMock = mock(async () => ({ ok: true as const, anchors: ONE_ANCHOR, max: 3 }))

;(window as unknown as { electron: Partial<ElectronApi> }).electron = {
  listStyleAnchors: listStyleAnchorsMock as unknown as ElectronApi['listStyleAnchors'],
}

beforeEach(() => {
  listStyleAnchorsMock.mockClear()
  listStyleAnchorsMock.mockImplementation(async () => ({ ok: true, anchors: ONE_ANCHOR, max: 3 }))
})

afterEach(() => {
  cleanup()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

function panelRoot(): Element | null {
  return document.querySelector('[data-book-voice-anchors="true"]')
}

describe('BookVoiceAnchors（真实 DOM：projectPath 切换）', () => {
  test('切换 projectPath 立即清空旧项目样章，不等新项目数据回来才切换', async () => {
    const { rerender } = render(
      <TooltipProvider>
        <BookVoiceAnchors projectPath="/novel-a" />
      </TooltipProvider>,
    )
    await waitFor(() => expect(panelRoot()).toBeTruthy())
    expect(panelRoot()?.textContent).toContain('林跃把便条叠好塞进口袋。')

    // 新项目的请求故意挂起不 resolve，模拟慢请求——断言发生在 rerender 后的下一个事件循环内，
    // 此时新项目的 listStyleAnchors 承诺还没有结果（永不 resolve：组件随测试结束卸载，
    // 不需要收尾这个 promise）
    listStyleAnchorsMock.mockImplementation(() => new Promise(() => {}))
    await act(async () => {
      rerender(
        <TooltipProvider>
          <BookVoiceAnchors projectPath="/novel-b" />
        </TooltipProvider>,
      )
    })
    // projectPath 变化的清空是同步发生的（reload(true) 里的 setAnchors([])），不需要等待新请求
    expect(panelRoot()).toBeNull()
  })

  test('新项目读取失败时不静默保留旧项目样章', async () => {
    const { rerender } = render(
      <TooltipProvider>
        <BookVoiceAnchors projectPath="/novel-a" />
      </TooltipProvider>,
    )
    await waitFor(() => expect(panelRoot()).toBeTruthy())

    listStyleAnchorsMock.mockImplementation(async () => ({ ok: false, message: '读取失败' }))
    await act(async () => {
      rerender(
        <TooltipProvider>
          <BookVoiceAnchors projectPath="/novel-b" />
        </TooltipProvider>,
      )
    })
    await waitFor(() => {
      expect(listStyleAnchorsMock).toHaveBeenCalledWith({ projectPath: '/novel-b' })
    })
    // 失败按不可用处理：不回退展示 /novel-a 的旧样章
    expect(panelRoot()).toBeNull()
  })
})
