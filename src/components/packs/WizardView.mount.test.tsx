// 「WizardView 挂载 → 水合」接线的回归保险（会话可恢复评审 Major-1）。
//
// 为什么需要这个文件：WizardView.test.tsx 全走 SSR（renderToStaticMarkup 不跑 effect），
// pack-wizard-store.test.ts 只测水合函数本身——「挂载会触发水合」这条接线在 mutation
// 「挂载不水合」下 61 用例全绿存活，而它正是重载死循环根治的入口。这里真实挂载 WizardView，
// 断言 snapshot IPC 被 invoke 且恢复出对应视图；删掉 WizardView 挂载 effect 里的
// `hydratePackWizardOnEnter()` 调用，本文件必红。
//
// 为什么不用 GlobalRegistrator + @testing-library/react（仓内 interactions 测试先例）：当时
// 同进程 GlobalRegistrator 安全共存上限实测是既有 3 个文件，追加第 4 个会让生命周期互相冲盖、
// 全量跑时 StateChangesLedger 18 用例全灭（见 LearnFromBookView.test.tsx 头注的实测记录）。
// 【2026-07-29 复测更新】这条「上限=3」结论已被 PR#501 评审修复推翻：BookVoiceAnchors.test.tsx
// 新增为第 4 个注册文件，连续 10 次 `bun --no-cache run test`（全量）实测 10/10 全绿，无一次
// StateChangesLedger 用例失败——当前依赖版本下 4 个文件可安全共存。这里仍保留手动挂载 harness
// 是因为它本身更轻量（不引入 @testing-library 的全局绑定），不是为了绕开一个已不存在的上限：
// 手动把 happy-dom 的 Window/Document 挂到 globalThis（保存原值、afterAll 恢复，不经
// GlobalRegistrator、不动它的内部状态），渲染用 react-dom/client 裸 createRoot + React.act。
//
// 与先例同款的模块加载纪律：全局挂载必须发生在 react-dom/client 等模块被 import 之前，而
// ES import 会提升到模块顶部——所以先同步挂全局，再顶层 await 动态 import。
import { Window } from 'happy-dom'

const happyWindow = new Window()
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'window', { configurable: true, value: happyWindow })
Object.defineProperty(globalThis, 'document', { configurable: true, value: happyWindow.document })
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { afterAll, afterEach, beforeEach, describe, expect, test } = await import('bun:test')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { WizardView } = await import('./WizardView')
const {
  __resetPackWizardHydrationForTest,
  __resetPackWizardSubscriptionForTest,
  usePackWizardStore,
} = await import('@/lib/pack-wizard-store')
// 类型走内联 import type（纯类型无运行时求值，不受「先挂全局再 import」纪律约束）
type PackWizardSnapshot = import('@shared/types/capability-pack').PackWizardSnapshot
type PackWizardAck = import('@shared/types/capability-pack').PackWizardAck

/** 每用例记数的 electron mock：挂到 happy-dom window 上（store 代码走全局 window.electron）。 */
function mockElectron(snapshot: PackWizardSnapshot | null) {
  let snapshotCalls = 0
  ;(happyWindow as unknown as { electron: unknown }).electron = {
    startWizard: () => new Promise<PackWizardAck>(() => {}),
    sendWizardMessage: () => new Promise<PackWizardAck>(() => {}),
    cancelWizard: () => Promise.resolve({ ok: true }),
    dismissWizard: () => Promise.resolve({ ok: true }),
    getWizardSnapshot: () => {
      snapshotCalls += 1
      return Promise.resolve(snapshot)
    },
    onPackWizardEvent: () => () => {},
  }
  return { getSnapshotCalls: () => snapshotCalls }
}

function liveSnapshot(): PackWizardSnapshot {
  return {
    phase: 'awaiting_user',
    messages: [
      { role: 'assistant', text: '你想沉淀什么写法？' },
      { role: 'user', text: '打脸场面的铺排' },
    ],
    draftId: null,
    cardCount: null,
    errorMessage: null,
    lastSeq: 5,
  }
}

let container: ReturnType<typeof happyWindow.document.createElement> | null = null
let root: ReturnType<typeof createRoot> | null = null

/** 真实挂载 WizardView 并等水合链（snapshot invoke → setState → setEntering(false)）走完。 */
async function mountWizardView(): Promise<string> {
  container = happyWindow.document.createElement('div')
  happyWindow.document.body.appendChild(container)
  root = createRoot(container as unknown as Element)
  await act(async () => {
    root!.render(<WizardView onOpenDraft={() => {}} />)
  })
  // 水合是真实 promise 链（invoke resolve → 整体替换 → finally），宏任务一跳兜底微任务层数
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return container ? (container as unknown as { innerHTML: string }).innerHTML : ''
}

/** store 干净默认态：本文件跨用例（beforeEach）与跨文件（afterEach，见下）双向复用，防跑序污染。 */
function cleanStoreState() {
  return {
    messages: [],
    phase: null,
    draftId: null,
    cardCount: null,
    error: null,
    started: false,
    lastSeq: 0,
  }
}

beforeEach(() => {
  usePackWizardStore.setState(cleanStoreState())
})

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount()
    })
    root = null
  }
  if (container) {
    container.remove()
    container = null
  }
  __resetPackWizardSubscriptionForTest()
  __resetPackWizardHydrationForTest()
  // 本文件是仓内少数直接 setState 到 usePackWizardStore（模块级单例）的用例之一——最后一个
  // test（「store 已持有会话」）把 started 摆成 true 且不经 beforeEach 复位就结束。bun test
  // 同进程内跨文件共享该单例：若本文件在 WizardView.test.tsx 之前跑完，遗留的 started=true
  // 会让后者「首帧空白占位」用例里 entering 的懒初始化（读 live getState()）失真而假红
  // （该用例的 phase/started 走 SSR getInitialState 快照，与 entering 读到的 live 值不同源，
  // 两者错位时会漏判成「已水合」）。afterEach 而非只 afterAll 兜底，保证本文件任何一个用例
  // 提前失败退出时也不留脏状态。
  usePackWizardStore.setState(cleanStoreState())
})

afterAll(async () => {
  if (originalWindowDescriptor) Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalDocumentDescriptor) Object.defineProperty(globalThis, 'document', originalDocumentDescriptor)
  else Reflect.deleteProperty(globalThis, 'document')
  await happyWindow.happyDOM.close()
})

describe('WizardView 挂载 → 水合接线（真实挂载，Major-1 回归保险）', () => {
  test('挂载即水合：主进程有进行中快照 → snapshot IPC 恰好 invoke 一次，直接恢复完整对话视图', async () => {
    const { getSnapshotCalls } = mockElectron(liveSnapshot())
    const html = await mountWizardView()

    // 接线本体：挂载必须触发水合（删掉 WizardView effect 里的 hydratePackWizardOnEnter 调用即红）
    expect(getSnapshotCalls()).toBe(1)
    // 恢复语义：不是引导页，是带消息流的对话视图（重载死循环的根治出口）
    expect(html).toContain('data-wizard-conversation="true"')
    expect(html).toContain('你想沉淀什么写法？')
    expect(html).toContain('打脸场面的铺排')
    expect(html).not.toContain('data-wizard-intro-step')
    // store 侧同步恢复
    expect(usePackWizardStore.getState().started).toBe(true)
    expect(usePackWizardStore.getState().phase).toBe('awaiting_user')
    expect(usePackWizardStore.getState().lastSeq).toBe(5)
  })

  test('挂载水合快照 null（主进程无会话）→ 落到开场页（容器级「水合完→开场」分支）', async () => {
    const { getSnapshotCalls } = mockElectron(null)
    const html = await mountWizardView()

    expect(getSnapshotCalls()).toBe(1)
    expect(html).toContain('data-wizard-intro-step="true"')
    expect(html).not.toContain('data-wizard-conversation')
    expect(usePackWizardStore.getState().started).toBe(false)
  })

  test('store 已持有会话（本页内切走再回来）：挂载不再发 snapshot invoke，直接续用 store 现场', async () => {
    const { getSnapshotCalls } = mockElectron(liveSnapshot())
    usePackWizardStore.setState({
      messages: [{ role: 'assistant', text: '进行中的问题' }],
      phase: 'awaiting_user',
      started: true,
      lastSeq: 2,
    })
    const html = await mountWizardView()

    expect(getSnapshotCalls()).toBe(0)
    expect(html).toContain('进行中的问题')
    expect(html).toContain('data-wizard-conversation="true"')
  })
})
