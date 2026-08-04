import { afterEach, describe, expect, test } from 'bun:test'

import {
  __resetPackWizardHydrationForTest,
  __resetPackWizardSubscriptionForTest,
  ensurePackWizardSubscription,
  hydratePackWizardOnEnter,
  isWizardTerminalPhase,
  usePackWizardStore,
} from './pack-wizard-store'
import type { PackWizardAck, PackWizardEvent, PackWizardSnapshot } from '@shared/types/capability-pack'

const originalWindow = globalThis.window

function mockElectron(electron: Record<string, unknown>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { electron },
  })
}

/** 装一套「订阅可捕获 handler」的 mock，返回事件注入口与调用计数。 */
function mockWizardElectron(overrides: Record<string, unknown> = {}) {
  let handler: ((event: PackWizardEvent) => void) | null = null
  let subscribeCalls = 0
  let dismissCalls = 0
  mockElectron({
    startWizard: () => new Promise<PackWizardAck>(() => {}),
    sendWizardMessage: () => new Promise<PackWizardAck>(() => {}),
    cancelWizard: () => Promise.resolve({ ok: true }),
    // 缺省无主进程会话：入口水合拿到 null → 干净开场
    getWizardSnapshot: () => Promise.resolve(null),
    dismissWizard: () => {
      dismissCalls += 1
      return Promise.resolve({ ok: true } as PackWizardAck)
    },
    onPackWizardEvent: (cb: (event: PackWizardEvent) => void) => {
      subscribeCalls += 1
      handler = cb
      return () => {}
    },
    ...overrides,
  })
  return {
    emit: (event: PackWizardEvent) => handler?.(event),
    getSubscribeCalls: () => subscribeCalls,
    getDismissCalls: () => dismissCalls,
  }
}

/** 进行中会话快照样例（重载恢复用例的主进程侧真相）。 */
function liveSnapshot(overrides: Partial<PackWizardSnapshot> = {}): PackWizardSnapshot {
  return {
    phase: 'awaiting_user',
    messages: [
      { role: 'assistant', text: '你想沉淀什么写法？' },
      { role: 'user', text: '打脸场面的铺排' },
      { role: 'assistant', text: '展开说说你的习惯？' },
    ],
    draftId: null,
    cardCount: null,
    errorMessage: null,
    lastSeq: 6,
    ...overrides,
  }
}

/** 等真实 promise 链（invoke → then → 水合 → setState）走完：宏任务一跳兜底微任务层数。 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function resetStore(): void {
  usePackWizardStore.setState({
    messages: [],
    phase: null,
    draftId: null,
    cardCount: null,
    error: null,
    started: false,
    lastSeq: 0,
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  resetStore()
  __resetPackWizardSubscriptionForTest()
  __resetPackWizardHydrationForTest()
})

describe('usePackWizardStore：正常访谈全径', () => {
  test('两轮消息归约：phase 推进 + assistant 追加 + 乐观 user 追加 + done 落终态携带 draftId/cardCount', () => {
    const { emit } = mockWizardElectron()
    ensurePackWizardSubscription()

    usePackWizardStore.getState().startWizard()
    expect(usePackWizardStore.getState().started).toBe(true)
    expect(usePackWizardStore.getState().phase).toBe('preparing')

    // 第一轮：主进程开场
    emit({ kind: 'phase', phase: 'thinking', seq: 1 })
    emit({ kind: 'assistant', text: '你平时写开头有什么自己的习惯？', seq: 2 })
    emit({ kind: 'phase', phase: 'awaiting_user', seq: 3 })
    expect(usePackWizardStore.getState().phase).toBe('awaiting_user')

    // 第二轮：用户作答（乐观追加 + 本地先置 thinking 堵连点间隙）
    usePackWizardStore.getState().sendMessage('我习惯先写一个冲突镜头。')
    expect(usePackWizardStore.getState().phase).toBe('thinking')
    emit({ kind: 'phase', phase: 'thinking', seq: 4 })
    emit({ kind: 'assistant', text: '明白了，帮你整理成卡。', seq: 5 })
    emit({ kind: 'phase', phase: 'saving', seq: 6 })
    emit({
      kind: 'done',
      draftId: 'draft-7',
      cardCount: 2,
      cards: [
        { name: '冲突开场', type: 'craft', compiled: true, previewHits: 0 },
        { name: '双线咬合', type: 'structure', compiled: true, previewHits: null },
      ],
      droppedCount: 1,
      seq: 7,
    })

    const state = usePackWizardStore.getState()
    expect(state.messages).toEqual([
      { role: 'assistant', text: '你平时写开头有什么自己的习惯？' },
      { role: 'user', text: '我习惯先写一个冲突镜头。' },
      { role: 'assistant', text: '明白了，帮你整理成卡。' },
    ])
    expect(state.phase).toBe('done')
    expect(state.draftId).toBe('draft-7')
    expect(state.cardCount).toBe(2)
    // done 摘要落 store（完成页警示行的数据源）
    expect(state.cards?.map((card) => card.previewHits)).toEqual([0, null])
    expect(state.droppedCount).toBe(1)
    expect(state.error).toBeNull()
    expect(state.lastSeq).toBe(7)
  })

  test('done 事件不带摘要（可选字段缺省）：cards/droppedCount 落 null，不残留旧值', () => {
    const { emit } = mockWizardElectron()
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'done', draftId: 'draft-8', cardCount: 1, seq: 1 })
    const state = usePackWizardStore.getState()
    expect(state.cards).toBeNull()
    expect(state.droppedCount).toBeNull()
  })

  test('started 门：已持有会话时重复 startWizard 被忽略，不重置消息也不重复调 IPC', () => {
    let startCalls = 0
    const { emit } = mockWizardElectron({
      startWizard: () => {
        startCalls += 1
        return new Promise<PackWizardAck>(() => {})
      },
    })
    ensurePackWizardSubscription()

    usePackWizardStore.getState().startWizard()
    emit({ kind: 'assistant', text: '开场问题', seq: 1 })

    usePackWizardStore.getState().startWizard()
    expect(startCalls).toBe(1)
    expect(usePackWizardStore.getState().messages).toEqual([{ role: 'assistant', text: '开场问题' }])
  })
})

describe('usePackWizardStore：sendMessage 门与乐观追加', () => {
  test('phase 非 awaiting_user（thinking）时拒绝：不追加消息、不调 IPC', () => {
    let sendCalls = 0
    const { emit } = mockWizardElectron({
      sendWizardMessage: () => {
        sendCalls += 1
        return new Promise<PackWizardAck>(() => {})
      },
    })
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'phase', phase: 'thinking', seq: 1 })

    usePackWizardStore.getState().sendMessage('向导还在想，这条不该发出去')
    expect(sendCalls).toBe(0)
    expect(usePackWizardStore.getState().messages).toEqual([])
  })

  test('空白文本拒绝：即使在 awaiting_user 也不追加、不调 IPC', () => {
    let sendCalls = 0
    const { emit } = mockWizardElectron({
      sendWizardMessage: () => {
        sendCalls += 1
        return new Promise<PackWizardAck>(() => {})
      },
    })
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'phase', phase: 'awaiting_user', seq: 1 })

    usePackWizardStore.getState().sendMessage('   ')
    expect(sendCalls).toBe(0)
    expect(usePackWizardStore.getState().messages).toEqual([])
  })

  test('ack ok:false 时撤回乐观消息并退回 awaiting_user（只撤这一条，不误伤 assistant 消息）', async () => {
    const { emit } = mockWizardElectron({
      sendWizardMessage: () => Promise.resolve({ ok: false, message: '向导正忙，等它回复后再发。' } as PackWizardAck),
    })
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'assistant', text: '开场问题', seq: 1 })
    emit({ kind: 'phase', phase: 'awaiting_user', seq: 2 })

    usePackWizardStore.getState().sendMessage('这条会被主进程拒收')
    expect(usePackWizardStore.getState().messages).toHaveLength(2)

    await settle()
    const state = usePackWizardStore.getState()
    expect(state.messages).toEqual([{ role: 'assistant', text: '开场问题' }])
    expect(state.phase).toBe('awaiting_user')
  })
})

describe('usePackWizardStore：终态单向 + seq 守卫（迟到/重放事件不复活）', () => {
  test('cancelled 后迟到的 assistant 事件丢弃：消息流不再增长', () => {
    const { emit } = mockWizardElectron()
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'assistant', text: '开场问题', seq: 1 })
    emit({ kind: 'cancelled', seq: 2 })
    expect(usePackWizardStore.getState().phase).toBe('cancelled')

    emit({ kind: 'assistant', text: '取消后迟到的回复', seq: 3 })
    expect(usePackWizardStore.getState().messages).toEqual([{ role: 'assistant', text: '开场问题' }])
    expect(usePackWizardStore.getState().phase).toBe('cancelled')
  })

  test('seq 门：不大于已应用序号的事件（重放/乱序）丢弃，更大的照常应用', () => {
    const { emit } = mockWizardElectron()
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'assistant', text: '第一问', seq: 1 })
    emit({ kind: 'phase', phase: 'awaiting_user', seq: 2 })
    expect(usePackWizardStore.getState().lastSeq).toBe(2)

    // 同 seq 重放与更旧的 seq：一律丢弃，不重复追加、不倒退 phase
    emit({ kind: 'assistant', text: '第一问', seq: 1 })
    emit({ kind: 'phase', phase: 'thinking', seq: 2 })
    expect(usePackWizardStore.getState().messages).toHaveLength(1)
    expect(usePackWizardStore.getState().phase).toBe('awaiting_user')

    emit({ kind: 'assistant', text: '第二问', seq: 3 })
    expect(usePackWizardStore.getState().messages).toHaveLength(2)
    expect(usePackWizardStore.getState().lastSeq).toBe(3)
  })

  test('契约防御（T5 评审 Minor-2）：终态值经 phase kind 下发时丢弃，随后的真 done 事件照常落', () => {
    const { emit } = mockWizardElectron()
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'phase', phase: 'awaiting_user', seq: 1 })

    // 主进程契约上不会发这个（emitPhase 只发非终态）；真发来了不该落成无 draftId 的假 done 终态
    emit({ kind: 'phase', phase: 'done', seq: 2 })
    expect(usePackWizardStore.getState().phase).toBe('awaiting_user')

    emit({ kind: 'done', draftId: 'draft-9', cardCount: 1, seq: 3 })
    expect(usePackWizardStore.getState().phase).toBe('done')
    expect(usePackWizardStore.getState().draftId).toBe('draft-9')
    expect(usePackWizardStore.getState().cardCount).toBe(1)
  })

  test('done 后迟到的 phase 事件丢弃：终态不被改写回进行中', () => {
    const { emit } = mockWizardElectron()
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'done', draftId: 'draft-1', cardCount: 3, seq: 1 })

    emit({ kind: 'phase', phase: 'thinking', seq: 2 })
    const state = usePackWizardStore.getState()
    expect(state.phase).toBe('done')
    expect(state.draftId).toBe('draft-1')
    expect(state.cardCount).toBe(3)
  })

  test('终态后 sendMessage 被 phase 门拒绝：不追加、不调 IPC', () => {
    let sendCalls = 0
    const { emit } = mockWizardElectron({
      sendWizardMessage: () => {
        sendCalls += 1
        return new Promise<PackWizardAck>(() => {})
      },
    })
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'error', message: '这轮对话没跑完', seq: 1 })

    usePackWizardStore.getState().sendMessage('终态后不该发得出去')
    expect(sendCalls).toBe(0)
    expect(usePackWizardStore.getState().messages).toEqual([])
  })
})

describe('usePackWizardStore：reset 门与 dismiss 链', () => {
  test('进行中（awaiting_user）reset 拒绝：状态原样保留，不调 dismiss', () => {
    const { emit, getDismissCalls } = mockWizardElectron()
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'assistant', text: '开场问题', seq: 1 })
    emit({ kind: 'phase', phase: 'awaiting_user', seq: 2 })

    usePackWizardStore.getState().resetWizard()
    const state = usePackWizardStore.getState()
    expect(state.started).toBe(true)
    expect(state.phase).toBe('awaiting_user')
    expect(state.messages).toHaveLength(1)
    expect(getDismissCalls()).toBe(0)
  })

  test('终态（error）reset：先 invoke dismiss 清主进程终态实例，再清本地；迟到事件不复活', () => {
    const { emit, getDismissCalls } = mockWizardElectron()
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'assistant', text: '开场问题', seq: 1 })
    emit({ kind: 'error', message: '模型服务超时', seq: 2 })
    expect(usePackWizardStore.getState().error).toBe('模型服务超时')

    usePackWizardStore.getState().resetWizard()
    expect(getDismissCalls()).toBe(1) // 「再来一次」必须清掉主进程终态实例，否则重载后旧终态复活
    expect(usePackWizardStore.getState()).toMatchObject({
      messages: [],
      phase: null,
      draftId: null,
      cardCount: null,
      error: null,
      started: false,
      lastSeq: 0,
    })

    emit({ kind: 'assistant', text: 'reset 后迟到的回复', seq: 3 })
    expect(usePackWizardStore.getState().messages).toEqual([])

    // reset 后可以「再来一次」
    usePackWizardStore.getState().startWizard()
    expect(usePackWizardStore.getState().started).toBe(true)
    expect(usePackWizardStore.getState().phase).toBe('preparing')
  })

  test('dismiss IPC 挂了不阻断 reset：本地照常清空', async () => {
    const { emit } = mockWizardElectron({
      dismissWizard: () => Promise.reject(new Error('IPC 挂了')),
    })
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'cancelled', seq: 1 })

    usePackWizardStore.getState().resetWizard()
    await settle()
    expect(usePackWizardStore.getState().started).toBe(false)
    expect(usePackWizardStore.getState().phase).toBeNull()
  })
})

describe('usePackWizardStore：空卡路径（T3 评审观察）', () => {
  test('saving → done(draftId:null)：phase 落成 done 终态不残留 saving，draftId=null 供 UI 判空卡', () => {
    const { emit } = mockWizardElectron()
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'assistant', text: '这次没聊出可以整理的写法。', seq: 1 })
    emit({ kind: 'phase', phase: 'saving', seq: 2 })
    emit({ kind: 'done', draftId: null, cardCount: 0, seq: 3 })

    const state = usePackWizardStore.getState()
    expect(state.phase).toBe('done')
    expect(state.draftId).toBeNull()
    expect(state.cardCount).toBe(0)
    expect(isWizardTerminalPhase(state.phase)).toBe(true)
  })
})

describe('usePackWizardStore：水合（重载恢复，主进程单一真相源）', () => {
  test('模拟重载：新 store + 主进程进行中快照 → 完整对话视图恢复，且恢复出的会话是活的', async () => {
    const { emit } = mockWizardElectron({
      getWizardSnapshot: () => Promise.resolve(liveSnapshot()),
    })

    await hydratePackWizardOnEnter()
    const state = usePackWizardStore.getState()
    expect(state.started).toBe(true)
    expect(state.phase).toBe('awaiting_user')
    expect(state.messages).toHaveLength(3)
    expect(state.messages[0]).toEqual({ role: 'assistant', text: '你想沉淀什么写法？' })
    expect(state.lastSeq).toBe(6)

    // 恢复后的会话照常续播事件流与发消息门
    emit({ kind: 'phase', phase: 'thinking', seq: 7 })
    emit({ kind: 'assistant', text: '继续追问', seq: 8 })
    expect(usePackWizardStore.getState().messages).toHaveLength(4)
    expect(usePackWizardStore.getState().phase).toBe('thinking')
  })

  test('终态快照恢复：done + draftId → 终态页状态（「查看草稿」可用），不落 error', async () => {
    mockWizardElectron({
      getWizardSnapshot: () =>
        Promise.resolve(
          liveSnapshot({ phase: 'done', draftId: 'draft-5', cardCount: 2, lastSeq: 9 }),
        ),
    })

    await hydratePackWizardOnEnter()
    const state = usePackWizardStore.getState()
    expect(state.phase).toBe('done')
    expect(state.draftId).toBe('draft-5')
    expect(state.cardCount).toBe(2)
    expect(state.error).toBeNull()
    expect(state.started).toBe(true)
  })

  test('快照 null（主进程无会话）→ 干净开场', async () => {
    mockWizardElectron()
    await hydratePackWizardOnEnter()
    expect(usePackWizardStore.getState().started).toBe(false)
    expect(usePackWizardStore.getState().phase).toBeNull()
  })

  test('水合竞态：「快照后事件先到」→ 先缓冲，快照落地后只重放 seq > lastSeq 的', async () => {
    let resolveSnapshot!: (snapshot: PackWizardSnapshot | null) => void
    const pending = new Promise<PackWizardSnapshot | null>((resolve) => {
      resolveSnapshot = resolve
    })
    const { emit } = mockWizardElectron({ getWizardSnapshot: () => pending })

    const hydration = hydratePackWizardOnEnter()
    // 快照 invoke 在途时事件先到：seq 5 已含在快照里（重复帧），seq 6 是快照之后的新帧
    emit({ kind: 'assistant', text: '重复帧（快照里已有）', seq: 5 })
    emit({ kind: 'assistant', text: '快照之后的新帧', seq: 6 })
    // 缓冲期间不落地
    expect(usePackWizardStore.getState().messages).toEqual([])

    resolveSnapshot(
      liveSnapshot({ messages: [{ role: 'assistant', text: '快照里的消息' }], lastSeq: 5 }),
    )
    await hydration

    const state = usePackWizardStore.getState()
    expect(state.messages).toEqual([
      { role: 'assistant', text: '快照里的消息' },
      { role: 'assistant', text: '快照之后的新帧' },
    ])
    expect(state.lastSeq).toBe(6)
  })

  test('store 已持有会话时入口水合不动状态（本页生命周期内 store 是真相）', async () => {
    let snapshotCalls = 0
    const { emit } = mockWizardElectron({
      getWizardSnapshot: () => {
        snapshotCalls += 1
        return Promise.resolve(null)
      },
    })
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'assistant', text: '开场问题', seq: 1 })

    await hydratePackWizardOnEnter()
    expect(snapshotCalls).toBe(0)
    expect(usePackWizardStore.getState().messages).toHaveLength(1)
  })

  test('水合 IPC 挂了 → 按无会话处理（开场页是永远可走的出口），不悬死', async () => {
    mockWizardElectron({ getWizardSnapshot: () => Promise.reject(new Error('IPC 挂了')) })
    await hydratePackWizardOnEnter()
    expect(usePackWizardStore.getState().started).toBe(false)
    expect(usePackWizardStore.getState().phase).toBeNull()
  })
})

describe('usePackWizardStore：busy 兜底自动恢复（拒绝必须带出口）', () => {
  test('startWizard 收到 busy 拒绝 ack → 不落 error 终态，转身水合恢复现场', async () => {
    mockWizardElectron({
      startWizard: () => Promise.resolve({ ok: false, message: '上一场访谈还没结束。' } as PackWizardAck),
      getWizardSnapshot: () => Promise.resolve(liveSnapshot()),
    })
    ensurePackWizardSubscription()

    usePackWizardStore.getState().startWizard()
    await settle()
    await settle()
    const state = usePackWizardStore.getState()
    expect(state.phase).toBe('awaiting_user') // 恢复出的进行中会话，不是 error 死路
    expect(state.error).toBeNull()
    expect(state.messages).toHaveLength(3)
    expect(state.lastSeq).toBe(6)
  })

  test('busy 拒绝但快照已空（会话恰好收尾被清）→ 回干净开场，可再点开始', async () => {
    mockWizardElectron({
      startWizard: () => Promise.resolve({ ok: false, message: '上一场访谈还没结束。' } as PackWizardAck),
      getWizardSnapshot: () => Promise.resolve(null),
    })
    ensurePackWizardSubscription()

    usePackWizardStore.getState().startWizard()
    await settle()
    await settle()
    expect(usePackWizardStore.getState().started).toBe(false)
    expect(usePackWizardStore.getState().phase).toBeNull()
    expect(usePackWizardStore.getState().error).toBeNull()
  })

  test('startWizard 的 Promise reject（IPC 挂了）：落 error 终态，不悬在 preparing', async () => {
    mockWizardElectron({ startWizard: () => Promise.reject(new Error('IPC 挂了')) })
    ensurePackWizardSubscription()

    usePackWizardStore.getState().startWizard()
    await settle()
    expect(usePackWizardStore.getState().phase).toBe('error')
    expect(usePackWizardStore.getState().error).toBe('IPC 挂了')
  })

  test('startWizard 的 ack 迟到时若事件流已先落终态（cancelled），不触发水合也不改写终态', async () => {
    let resolveAck!: (ack: PackWizardAck) => void
    const pending = new Promise<PackWizardAck>((resolve) => {
      resolveAck = resolve
    })
    let snapshotCalls = 0
    const { emit } = mockWizardElectron({
      startWizard: () => pending,
      getWizardSnapshot: () => {
        snapshotCalls += 1
        return Promise.resolve(null)
      },
    })
    ensurePackWizardSubscription()

    usePackWizardStore.getState().startWizard()
    emit({ kind: 'cancelled', seq: 1 })

    resolveAck({ ok: false, message: '迟到的拒绝' })
    await settle()
    expect(usePackWizardStore.getState().phase).toBe('cancelled')
    expect(usePackWizardStore.getState().error).toBeNull()
    expect(snapshotCalls).toBe(0)
  })

  test('cancelWizard 调用 window.electron.cancelWizard，不本地预判终态', () => {
    let called = false
    const { emit } = mockWizardElectron({
      cancelWizard: () => {
        called = true
        return Promise.resolve({ ok: true as const })
      },
    })
    ensurePackWizardSubscription()
    usePackWizardStore.getState().startWizard()
    emit({ kind: 'phase', phase: 'awaiting_user', seq: 1 })

    usePackWizardStore.getState().cancelWizard()
    expect(called).toBe(true)
    // 终态要等主进程 cancelled 事件，本地不抢跑
    expect(usePackWizardStore.getState().phase).toBe('awaiting_user')
  })
})

describe('usePackWizardStore：订阅与 IPC 边界', () => {
  test('ensurePackWizardSubscription 幂等：调两次只挂一个 listener，事件只归约一次', () => {
    const { emit, getSubscribeCalls } = mockWizardElectron()
    ensurePackWizardSubscription()
    ensurePackWizardSubscription()
    expect(getSubscribeCalls()).toBe(1)

    usePackWizardStore.getState().startWizard()
    emit({ kind: 'assistant', text: '开场问题', seq: 1 })
    expect(usePackWizardStore.getState().messages).toHaveLength(1)
  })

  test('hydratePackWizardOnEnter 订阅先行：水合前就挂上事件监听（缓冲不漏帧）', async () => {
    const { getSubscribeCalls } = mockWizardElectron()
    await hydratePackWizardOnEnter()
    expect(getSubscribeCalls()).toBe(1)
  })
})
