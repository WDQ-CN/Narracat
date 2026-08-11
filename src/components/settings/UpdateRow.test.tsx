// UpdateRow 真实 DOM 挂载测试。
//
// 为什么不用 GlobalRegistrator（仓内 interactions 测试先例，如 StateChangesLedger.test.tsx /
// BookVoiceAnchors.test.tsx）：实测本仓同进程 GlobalRegistrator 安全共存上限=4（既有
// ChapterManuscriptView.interactions / StateChangesLedger / AgentThreadView.interactions /
// BookVoiceAnchors），追加第 5 个（本文件）会让生命周期互相冲盖，全量跑时前 4 个文件 25 个用例
// 全灭（`bun --no-cache run test` 实测：加本文件 3096 pass/25 fail，去掉本文件 3120 pass/0
// fail）。改走 WizardView.mount.test.tsx 的先例：手动把 happy-dom 的 Window/Document 挂到
// globalThis（保存原值、afterAll 恢复，不经 GlobalRegistrator、不动它的内部状态），更轻量、不
// 触碰全局注册计数。
//
// 与先例同款的模块加载纪律：全局挂载必须发生在 @testing-library/react 等模块被 import 之前，而
// ES import 会提升到模块顶部——所以先同步挂全局，再顶层 await 动态 import。
import { Window } from 'happy-dom'

const happyWindow = new Window()
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'window', { configurable: true, value: happyWindow })
Object.defineProperty(globalThis, 'document', { configurable: true, value: happyWindow.document })
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { afterAll, afterEach, describe, expect, test } = await import('bun:test')
const { cleanup, render, screen } = await import('@testing-library/react')
const { UpdateRow } = await import('./UpdateRow.tsx')

afterEach(() => {
  cleanup()
})

afterAll(async () => {
  if (originalWindowDescriptor) Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalDocumentDescriptor) Object.defineProperty(globalThis, 'document', originalDocumentDescriptor)
  else Reflect.deleteProperty(globalThis, 'document')
  await happyWindow.happyDOM.close()
})

describe('UpdateRow', () => {
  // 非 electron 环境下 useUpdater 返回兜底空闲态——组件测试因此不必 mock window.electron。
  test('非 electron 环境渲染为空闲态且不炸', () => {
    render(<UpdateRow />)
    expect(screen.getByText('已是最新')).toBeDefined()
    expect(screen.getByRole('button', { name: '检查更新' })).toBeDefined()
  })
})
