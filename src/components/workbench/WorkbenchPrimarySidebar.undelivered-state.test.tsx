// 章节目录「未兑现计划」橙点徽标测试（A4×D2 片3b，Task 8）。
//
// WorkbenchPrimarySidebar.test.tsx 整体走 renderToStaticMarkup（SSR）断言 HTML 字符串——SSR 不跑
// effect，usePlannedStateCounts 的第一次（也是唯一一次）同步渲染永远只能读到初始空映射，测不出
// 「拉取到计数后徽标真的出现」。真实 DOM（happy-dom）能跑 effect，但本仓 happy-dom +
// @testing-library/react 目前只安全共存 2 个文件（见 use-planned-state-counts.test.ts 顶部注释：
// 加入第 3/4 个 register()/unregister() 文件会让 StateChangesLedger.test.tsx 的真实 DOM 交互测试
// 随机读到空 DOM 挂掉，跟本文件内容无关，纯 bun test 调度 + happy-dom 全局单例的既有脆弱点）。
//
// 所以这里换一个不需要真实 DOM 的路子：用 bun:test 的 mock.module 把 usePlannedStateCounts
// 换成一个同步返回固定计数映射的假实现，再用 renderToStaticMarkup 渲染真实的
// WorkbenchPrimarySidebar——因为换掉的是 hook 本身（不是靠 effect 异步写回 state），mock 返回值在
// SSR 的这一次同步渲染里就直接参与 JSX 求值，能真实断言徽标是否出现在渲染输出里。
// mock.module 必须在动态 import 组件之前调用（ES 静态 import 会被提升，写在 mock.module 之后
// 也无效），所以本文件统一用顶层 await import()，不静态 import 任何东西。
import { describe, expect, mock, test } from 'bun:test'
import type { NovelProjectDetail } from '@shared/types/novel'

let plannedStateCountsFixture: Record<string, number> = {}

const usePlannedStateCountsMock = mock(
  (_projectPath: string | undefined, _reloadKey: unknown) => plannedStateCountsFixture,
)

// mock.module 在 bun test 里是进程级的，展开真实模块、只覆写 usePlannedStateCounts，
// 避免剥掉其余导出（runPlannedStateCountsEffect）炸掉同进程里的其它测试文件。
const actualModule = await import('@/lib/use-planned-state-counts')
mock.module('@/lib/use-planned-state-counts', () => ({
  ...actualModule,
  usePlannedStateCounts: usePlannedStateCountsMock,
}))

const { renderToStaticMarkup } = await import('react-dom/server')
const { MemoryRouter } = await import('react-router')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { usePlannedStateRefresh } = await import('@/lib/planned-state-refresh')
const { WorkbenchPrimarySidebar } = await import('./WorkbenchPrimarySidebar')

const project: NovelProjectDetail = {
  id: 'novel-1',
  title: '星辰大海',
  path: '/novels/stars',
  status: 'ready',
  chapterProgress: '2 / 3 章',
  wordCountLabel: '3000 字',
  tocItems: [
    { id: 'volume-1', kind: 'volume', title: '第 1 卷', volumeNumber: 1 },
    {
      id: 'chapter-1',
      kind: 'chapter',
      title: '第 001 章 · 初醒',
      chapterNumber: 1,
      volumeNumber: 1,
      status: 'completed',
    },
    {
      id: 'chapter-2',
      kind: 'chapter',
      title: '第 002 章 · 远行',
      chapterNumber: 2,
      volumeNumber: 1,
      status: 'completed',
    },
    {
      id: 'chapter-3',
      kind: 'chapter',
      title: '第 003 章 · 归潮',
      chapterNumber: 3,
      volumeNumber: 1,
      status: 'planned',
    },
  ],
  treeItems: [],
}

function renderSidebar(): string {
  // 与其它测试文件共享同一进程内的 zustand 模块单例（同 useAgentStore 的既有先例）：
  // 显式重置，不依赖测试执行顺序凑巧留在初始值 0。
  usePlannedStateRefresh.setState({ version: 0 })
  return renderToStaticMarkup(
    <TooltipProvider>
      <MemoryRouter>
        <WorkbenchPrimarySidebar
          error={null}
          hasProjectPath
          loading={false}
          project={project}
          selectedSectionId="blueprint"
          selectedObjectId="chapter-1"
        />
      </MemoryRouter>
    </TooltipProvider>,
  )
}

describe('WorkbenchPrimarySidebar 未兑现计划橙点徽标', () => {
  test('已完成章有未兑现计划（计数>0）时行尾出橙点，且落在对应章行内', () => {
    plannedStateCountsFixture = { '1': 2 }
    usePlannedStateCountsMock.mockClear()

    const html = renderSidebar()

    // 接线断言：hook 以 project.path 和 `${activeRunFlag}:${saveVersion}:${plannedStateVersion}` 形状的
    // reloadKey 被调用（SSR 下 zustand 读初始 store：activeRun 无 → false，saveVersion/plannedStateVersion
    // 初始均为 0）——第三分量是终审 Fix 1：账本区处置/保存成功后 bump，橙点才会重拉计数消失。
    expect(usePlannedStateCountsMock).toHaveBeenCalledWith('/novels/stars', 'false:0:0')
    expect(html.match(/data-undelivered-state-dot="true"/g) ?? []).toHaveLength(1)
    const chapterRowMatch = html.match(/<a[^>]*>(?:(?!<\/a>).)*?第 001 章 · 初醒(?:(?!<\/a>).)*?<\/a>/s)
    expect(chapterRowMatch?.[0]).toContain('data-undelivered-state-dot="true"')
    expect(html).toContain('title="2 项计划状态变更未兑现"')
    expect(html).toContain('aria-label="计划状态变更未兑现"')
  })

  test('已完成章计数为 0 时不出橙点', () => {
    plannedStateCountsFixture = { '1': 0, '2': 0 }

    const html = renderSidebar()

    expect(html).not.toContain('data-undelivered-state-dot')
  })

  test('未完成（planned）章即使有计数也不出橙点', () => {
    plannedStateCountsFixture = { '3': 5 }

    const html = renderSidebar()

    expect(html).not.toContain('data-undelivered-state-dot')
  })

  test('无计数（章号不在映射里）时不出橙点', () => {
    plannedStateCountsFixture = {}

    const html = renderSidebar()

    expect(html).not.toContain('data-undelivered-state-dot')
  })

  test('已完成章同时有记忆待同步与未兑现计划两个圆点时并列渲染，互不覆盖', () => {
    plannedStateCountsFixture = { '1': 1, '2': 3 }

    const html = renderSidebar()

    expect(html.match(/data-undelivered-state-dot="true"/g) ?? []).toHaveLength(2)
  })
})
