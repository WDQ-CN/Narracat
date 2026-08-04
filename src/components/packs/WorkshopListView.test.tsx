// 「我的创作」两进料器入口文案断言（刀5 Task 6）：spec §1 两句话分工文案逐字，两个入口各配自己
// 那句——入口分不清是 dogfood 观察项（spec §10），文案先钉死不许漂移。SSR 渲染（effect 不跑，
// 不摸 window.electron），打法同 LearnFromBookView.test.tsx（当时 GlobalRegistrator 3 文件上限
// 已满；该限制已被 2026-07-29 复测推翻，详见该文件头注——这里继续用 SSR 只是因为本文件断言的是
// 纯静态文案，没必要为此另开真实 DOM 测试）。
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkshopListView } from './WorkshopListView'

function renderList(): string {
  return renderToStaticMarkup(
    <WorkshopListView onOpenDraft={() => {}} onOpenLearn={() => {}} onOpenWizard={() => {}} />,
  )
}

describe('WorkshopListView · 两进料器入口并列（spec §1 分工文案逐字）', () => {
  test('「从书学写法」入口 + 自己那句', () => {
    const markup = renderList()
    expect(markup).toContain('data-workshop-learn-trigger="true"')
    expect(markup).toContain('从书学写法')
    expect(markup).toContain('把一本书的写法炼成你的能力卡。')
  })

  test('「作家向导」入口 + 自己那句（不需要范本书）', () => {
    const markup = renderList()
    expect(markup).toContain('data-workshop-wizard-trigger="true"')
    expect(markup).toContain('作家向导')
    expect(markup).toContain('把你脑子里的写法聊出来炼成卡——不需要范本书。')
  })

  test('两入口同构并列在同一入口区', () => {
    const markup = renderList()
    expect(markup).toContain('data-workshop-feeder-entries="true"')
    expect(markup).toContain('data-workshop-learn-entry="true"')
    expect(markup).toContain('data-workshop-wizard-entry="true"')
  })

  test('与工作台「参考作品」的边界句保留', () => {
    expect(renderList()).toContain('要给某一本书定调找灵感？用工作台里的「参考作品」——它隐形注入、不产资产。')
  })
})
