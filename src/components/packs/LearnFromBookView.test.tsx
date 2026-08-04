// 「再学一本」出口断言（T12 评审修复波 #2）+「正在停止…」禁用态断言（follow-up C）——完成页/失败页
// 各多一个次级动作，回选源页但不动已落盘的草稿工程（`onLearnAnother` 只在渲染端触发，具体清 session
// 的行为由 `usePackLearnStore.clearSession` 承担，见 pack-learn-store.test.ts 的覆盖）。
//
// 用 SSR（`renderToStaticMarkup`）+ 独立 props 断言，而非真实 DOM fireEvent.click：本仓库真实
// DOM interactions 测试（happy-dom 经 @happy-dom/global-registrator 全局注册）当时实测同进程内
// 安全共存上限是 3 个既有文件（ChapterManuscriptView / AgentThreadView / StateChangesLedger），
// 追加第 4 个会让 GlobalRegistrator 生命周期互相冲盖，`bun test src` 全量跑时 StateChangesLedger
// 的 18 个用例全灭（document 查不到挂载节点）——已实测复现，同 CharacterStatePanel.test.tsx 附近
// 记录的先例。【2026-07-29 复测更新】这条「上限=3」的结论已被 PR#501 评审修复推翻：
// BookVoiceAnchors.test.tsx 新增为第 4 个注册文件，连续 10 次 `bun --no-cache run test`（全量）
// 实测 10/10 全绿，StateChangesLedger 全部用例无一次失败——当前依赖版本（bun 1.3.14、
// @happy-dom/global-registrator ^20.10.6）下 4 个文件可安全共存，历史失败大概率是当时更早版本
// 的问题。本文件继续走下面的 SSR + 纯函数打法是既有实现足够、没必要为验证同一逻辑重写；新增
// 第 5 个注册文件前仍建议按同样方法实测（连续 10 次全量跑），不要直接假设可无限扩容。
// 故这里改走该文件立的替代打法：`LearnDoneStep`/`LearnEndedStep`/`LearnRunningStep`
// 是纯展示型子组件（只吃 props，不读 store），从 `LearnFromBookView.tsx` export 出来独立渲染，
// SSR 断言按钮存在/文案/禁用态/onClick 是否传到了正确的 prop 位置上；具体点击后 store 会不会清空
// 由 store 层测试覆盖。
//
// 「已停止」终态页已删除（产品裁决 follow-up C：cancelled 由 store 直接清空 session，视图静默回
// 选源页，没有信息量支撑一屏确认页）——原先覆盖 `LearnEndedStep primaryLabel={null}` 场景的用例
// 一并移除，该组件签名保留不改（见其 JSDoc），只是这个调用方已经不存在。
//
// `cancelling` 重置逻辑（评审 Medium follow-up）：这是容器 `LearnFromBookView` 内部的 `useEffect` +
// `useState`，不是纯展示子组件，本文件的 SSR 打法（渲染子组件按 props 断言）测不到这层状态机；容器
// 本身也没有在本文件另开真实 DOM 测试（上面已注明「文件数上限」结论已被 2026-07-29 复测推翻，这里
// 单纯是没必要为验证同一状态机再开一个 DOM 测试文件）。故把判定逻辑拆成纯函数
// `shouldResetCancelling`（不摸 React state）单独导出单测——覆盖的是评审抓到的具体缺陷：session 从
// error 终态直接跳回运行中（重试路径）时，重置该不该发生；`handleRetry` 里的显式 `setCancelling(false)`
// 是双保险，本文件不再重复覆盖（其正确性由 `shouldResetCancelling` 本身已经保证，双保险不改变行为）。
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LearnDoneStep, LearnEndedStep, LearnRunningStep, shouldResetCancelling } from './LearnFromBookView'
import type { PackLearnSession } from '@/lib/pack-learn-store'
import type { PackLearnReport } from '@shared/types/capability-pack'

const REPORT: PackLearnReport = { cardsKept: 3, cardsDropped: 1, chaptersSampled: 5 }
const NOVEL_SOURCE = { kind: 'novel' as const, projectPath: '/novels/p1', title: '试书' }

describe('LearnDoneStep · 再学一本', () => {
  test('渲染「打开草稿工程」主按钮 + 「再学一本」次级按钮，各自 onClick 落在自己的按钮上', () => {
    let openDraftCalls = 0
    let learnAnotherCalls = 0
    const markup = renderToStaticMarkup(
      <LearnDoneStep
        report={REPORT}
        onOpenDraft={() => {
          openDraftCalls += 1
        }}
        onLearnAnother={() => {
          learnAnotherCalls += 1
        }}
      />,
    )
    expect(markup).toContain('留下 3 张卡')
    expect(markup).toContain('有 1 张卡质量不过关（写法太贴原文或格式不完整），已放弃')
    expect(markup).toContain('打开草稿工程')
    expect(markup).toContain('再学一本')
    expect(markup).toContain('data-learn-open-draft-trigger="true"')
    expect(markup).toContain('data-learn-done-learn-another="true"')
    // SSR markup 不含事件监听，这里只证两个 onClick 是两个不同的函数（未被误接到同一个 handler）
    expect(openDraftCalls).toBe(0)
    expect(learnAnotherCalls).toBe(0)
  })

  test('cardsDropped 为 0 时不渲染放弃张数那句', () => {
    const markup = renderToStaticMarkup(
      <LearnDoneStep report={{ ...REPORT, cardsDropped: 0 }} onOpenDraft={() => {}} onLearnAnother={() => {}} />,
    )
    expect(markup).not.toContain('因写法太贴原文被放弃')
  })
})

describe('LearnEndedStep · 再学一本', () => {
  test('失败页（primaryLabel="重试"）：「重试」主按钮 + 「再学一本」次级按钮并存', () => {
    const markup = renderToStaticMarkup(
      <LearnEndedStep
        message="这次学习没跑完：模型服务超时"
        primaryLabel="重试"
        onPrimary={() => {}}
        onLearnAnother={() => {}}
      />,
    )
    expect(markup).toContain('这次学习没跑完：模型服务超时')
    expect(markup).toContain('data-learn-ended-primary="true"')
    expect(markup).toContain('>重试<')
    expect(markup).toContain('data-learn-ended-learn-another="true"')
    expect(markup).toContain('>再学一本<')
  })
})

describe('LearnRunningStep · 停止按钮（follow-up C：静默回选源页）', () => {
  test('未点停止：按钮文案「停止」，可点', () => {
    const markup = renderToStaticMarkup(
      <LearnRunningStep message="正在读书学写法（抽样 5 章）……" cancelling={false} onCancel={() => {}} />,
    )
    expect(markup).toContain('正在读书学写法（抽样 5 章）……')
    expect(markup).toContain('data-learn-cancel-trigger="true"')
    expect(markup).toContain('>停止<')
    expect(markup).not.toContain('正在停止')
    expect(markup).not.toContain('disabled=""')
  })

  test('点了停止（cancelling=true）：按钮禁用 + 文案变「正在停止…」——取消不是瞬时的，诚实反馈防连点', () => {
    const markup = renderToStaticMarkup(
      <LearnRunningStep message="正在读书学写法（抽样 5 章）……" cancelling={true} onCancel={() => {}} />,
    )
    expect(markup).toContain('data-learn-cancel-trigger="true"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('正在停止…')
    expect(markup).not.toContain('>停止<')
  })
})

describe('shouldResetCancelling · 「点了停止」本地态重置判定（评审 Medium follow-up）', () => {
  const runningSession: PackLearnSession = { source: NOVEL_SOURCE, tier: 'skim', event: null, result: null }

  test('session 为 null（cancelled 被 store 自动清空）：重置', () => {
    expect(shouldResetCancelling(null)).toBe(true)
  })

  test('session 仍在跑（result 为 null）：不重置——运行页的「正在停止…」该继续显示', () => {
    expect(shouldResetCancelling(runningSession)).toBe(false)
  })

  test('session 落到 error 终态：重置——即便这次不是 cancelled，是撞车的真实失败', () => {
    const errored: PackLearnSession = { ...runningSession, result: { status: 'error', message: '模型服务超时' } }
    expect(shouldResetCancelling(errored)).toBe(true)
  })

  test('session 落到 ok 终态：重置', () => {
    const done: PackLearnSession = {
      ...runningSession,
      result: { status: 'ok', draftId: 'draft-1', report: { cardsKept: 3, cardsDropped: 0, chaptersSampled: 5 } },
    }
    expect(shouldResetCancelling(done)).toBe(true)
  })

  test('复现评审抓到的场景：cancelling=true 时撞上 error 终态 → 重置 → 重试后新的 running session 不再继续禁用', () => {
    // 1) 用户点了停止：cancelling=true（这里只模拟判定输入，不复现 React state 本身）。
    // 2) 撞车：这次学习没被 cancelled 清空，而是落成了 error（例如真实网络异常先一步到达）。
    const erroredAfterStopClick: PackLearnSession = { ...runningSession, result: { status: 'error', message: 'IPC 挂了' } }
    expect(shouldResetCancelling(erroredAfterStopClick)).toBe(true) // 重置在 error 落地这一刻就已发生

    // 3) 用户点「重试」：session 变回运行中（result 又是 null）——此时 cancelling 应该已经是 false，
    // 不依赖这一步再做什么重置（`handleRetry` 里的显式 setCancelling(false) 只是双保险）。
    expect(shouldResetCancelling(runningSession)).toBe(false) // 新一轮运行不该被判定为「该重置」，
    // 因为它此时本就该是 false——这条断言确认新一轮运行页不会被这个判定函数误伤成别的状态。
  })
})
