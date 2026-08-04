import { afterEach, describe, expect, test } from 'bun:test'

import { __resetPackLearnSubscriptionForTest, ensurePackLearnSubscription, usePackLearnStore } from './pack-learn-store'
import type { PackLearnEvent, PackLearnResult, PackLearnSource } from '@shared/types/capability-pack'
import type { ResultNotification, ResultNotificationList } from '@shared/types/notifications'

const EMPTY_NOTIFICATION_LIST: ResultNotificationList = { notifications: [], totalCount: 0, unreadCount: 0 }

const originalWindow = globalThis.window

function mockElectron(electron: Record<string, unknown>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { electron },
  })
}

const NOVEL_SOURCE: PackLearnSource = { kind: 'novel', projectPath: '/novels/p1', title: '试书' }

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  usePackLearnStore.setState({ session: null })
  __resetPackLearnSubscriptionForTest()
})

describe('usePackLearnStore', () => {
  test('startLearning 立刻建会话，Promise resolve 后把终态写回 session.result', async () => {
    let resolveStart!: (result: PackLearnResult) => void
    const pending = new Promise<PackLearnResult>((resolve) => {
      resolveStart = resolve
    })
    mockElectron({ startLearn: () => pending })

    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    expect(usePackLearnStore.getState().session).toEqual({ source: NOVEL_SOURCE, tier: 'skim', event: null, result: null })

    resolveStart({ status: 'ok', draftId: 'draft-1', report: { cardsKept: 3, cardsDropped: 1, chaptersSampled: 5 } })
    await pending

    // 让 microtask（.then 回调）先跑完再断言
    await Promise.resolve()
    expect(usePackLearnStore.getState().session?.result).toEqual({
      status: 'ok',
      draftId: 'draft-1',
      report: { cardsKept: 3, cardsDropped: 1, chaptersSampled: 5 },
    })
  })

  test('已有会话在跑（result 未到达）时，重复 startLearning 被忽略', () => {
    mockElectron({ startLearn: () => new Promise<PackLearnResult>(() => {}) })

    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    const firstSession = usePackLearnStore.getState().session

    usePackLearnStore.getState().startLearning({ kind: 'txt', filePath: '/tmp/x.txt', title: '别的书' }, 'deep')
    expect(usePackLearnStore.getState().session).toBe(firstSession)
  })

  test('会话到终态后，startLearning 可以重新起（重试语义）', async () => {
    mockElectron({ startLearn: () => Promise.resolve({ status: 'error', message: '读不出这本书的正文。' } as PackLearnResult) })

    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    await Promise.resolve()
    await Promise.resolve()
    expect(usePackLearnStore.getState().session?.result).toEqual({ status: 'error', message: '读不出这本书的正文。' })

    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    expect(usePackLearnStore.getState().session?.result).toBeNull()
  })

  test('startLearn 的 Promise reject 时，session.result 落成带人话 message 的 error 终态', async () => {
    mockElectron({ startLearn: () => Promise.reject(new Error('IPC 挂了')) })

    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    await Promise.resolve()
    await Promise.resolve()
    expect(usePackLearnStore.getState().session?.result).toEqual({ status: 'error', message: 'IPC 挂了' })
  })

  test('clearSession 在会话已到终态时清空；仍在跑时保留（不留孤儿态）', () => {
    mockElectron({ startLearn: () => new Promise<PackLearnResult>(() => {}) })
    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')

    usePackLearnStore.getState().clearSession()
    expect(usePackLearnStore.getState().session).not.toBeNull()

    usePackLearnStore.setState((state) => ({
      session: state.session ? { ...state.session, result: { status: 'error', message: '读不出这本书的正文。' } } : null,
    }))
    usePackLearnStore.getState().clearSession()
    expect(usePackLearnStore.getState().session).toBeNull()
  })

  test('cancelled 终态：startLearn resolve cancelled 后 session 直接清空，不落进 session.result（产品裁决 follow-up C）', async () => {
    mockElectron({ startLearn: () => Promise.resolve({ status: 'cancelled' } as PackLearnResult) })

    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    expect(usePackLearnStore.getState().session).not.toBeNull()

    await Promise.resolve()
    await Promise.resolve()
    expect(usePackLearnStore.getState().session).toBeNull()
  })

  test('cancelled 清空后，迟到的进度事件不会复活 session', async () => {
    let handler: ((event: PackLearnEvent) => void) | null = null
    mockElectron({
      startLearn: () => Promise.resolve({ status: 'cancelled' } as PackLearnResult),
      onPackLearnEvent: (cb: (event: PackLearnEvent) => void) => {
        handler = cb
        return () => {}
      },
    })
    ensurePackLearnSubscription()

    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    await Promise.resolve()
    await Promise.resolve()
    expect(usePackLearnStore.getState().session).toBeNull()

    handler?.({ phase: 'error', message: '不该出现的迟到事件' })
    expect(usePackLearnStore.getState().session).toBeNull()
  })

  test('done（ok）/error 终态不受 cancelled 自动清空逻辑影响：session 保留、result 落定，等用户自己 clearSession', async () => {
    mockElectron({
      startLearn: () =>
        Promise.resolve({ status: 'ok', draftId: 'draft-2', report: { cardsKept: 2, cardsDropped: 0, chaptersSampled: 3 } } as PackLearnResult),
    })
    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    await Promise.resolve()
    await Promise.resolve()
    expect(usePackLearnStore.getState().session).not.toBeNull()
    expect(usePackLearnStore.getState().session?.result?.status).toBe('ok')

    usePackLearnStore.setState({ session: null })
    mockElectron({ startLearn: () => Promise.resolve({ status: 'error', message: '模型服务超时' } as PackLearnResult) })
    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    await Promise.resolve()
    await Promise.resolve()
    expect(usePackLearnStore.getState().session).not.toBeNull()
    expect(usePackLearnStore.getState().session?.result?.status).toBe('error')
  })

  test('cancelLearning 调用 window.electron.cancelLearn', () => {
    let called = false
    mockElectron({ cancelLearn: () => { called = true; return Promise.resolve({ ok: true }) } })

    usePackLearnStore.getState().cancelLearning()
    expect(called).toBe(true)
  })

  test('ensurePackLearnSubscription 只订阅一次，事件回填进当前会话', () => {
    let handler: ((event: PackLearnEvent) => void) | null = null
    let unsubscribeCalls = 0
    mockElectron({
      startLearn: () => new Promise<PackLearnResult>(() => {}),
      onPackLearnEvent: (cb: (event: PackLearnEvent) => void) => {
        handler = cb
        return () => {
          unsubscribeCalls += 1
        }
      },
    })

    ensurePackLearnSubscription()
    ensurePackLearnSubscription() // 第二次调用不应重新订阅
    expect(handler).not.toBeNull()

    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    handler?.({ phase: 'reading', message: '正在读书学写法（抽样 5 章）……' })
    expect(usePackLearnStore.getState().session?.event).toEqual({
      phase: 'reading',
      message: '正在读书学写法（抽样 5 章）……',
    })
    expect(unsubscribeCalls).toBe(0)
  })

  test('已到终态后收到的事件不再回填（终态之后不会再推进）', () => {
    let handler: ((event: PackLearnEvent) => void) | null = null
    mockElectron({
      startLearn: () => new Promise<PackLearnResult>(() => {}),
      onPackLearnEvent: (cb: (event: PackLearnEvent) => void) => {
        handler = cb
        return () => {}
      },
    })
    ensurePackLearnSubscription()
    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    usePackLearnStore.setState((state) => ({
      session: state.session ? { ...state.session, result: { status: 'error', message: '模型服务超时' } } : null,
    }))

    handler?.({ phase: 'error', message: '不该出现的迟到事件' })
    expect(usePackLearnStore.getState().session?.event).toBeNull()
  })
})

describe('usePackLearnStore：学习终态接入全局结果通知（刀4 终审 follow-up）', () => {
  test('学习成功：发一条通知，标题带书名，摘要带留下的卡数，跳转指向该草稿', async () => {
    const notified: ResultNotification[] = []
    mockElectron({
      startLearn: () =>
        Promise.resolve({
          status: 'ok',
          draftId: 'draft-9',
          report: { cardsKept: 4, cardsDropped: 1, chaptersSampled: 6 },
        } as PackLearnResult),
      upsertResultNotification: (notification: ResultNotification) => {
        notified.push(notification)
        return Promise.resolve(EMPTY_NOTIFICATION_LIST)
      },
    })

    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    await Promise.resolve()
    await Promise.resolve()

    expect(notified).toHaveLength(1)
    expect(notified[0]).toMatchObject({
      status: 'success',
      title: '《试书》学完了',
      summary: '留下 4 张卡',
      projectName: '试书',
      href: `/settings?${new URLSearchParams({ section: 'packs', sub: 'draft:draft-9' }).toString()}`,
    })
  })

  test('学习失败（result.status=error）：发一条通知，标题带书名，摘要是失败原因', async () => {
    const notified: ResultNotification[] = []
    mockElectron({
      startLearn: () => Promise.resolve({ status: 'error', message: '读不出这本书的正文。' } as PackLearnResult),
      upsertResultNotification: (notification: ResultNotification) => {
        notified.push(notification)
        return Promise.resolve(EMPTY_NOTIFICATION_LIST)
      },
    })

    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    await Promise.resolve()
    await Promise.resolve()

    expect(notified).toHaveLength(1)
    expect(notified[0]).toMatchObject({
      status: 'failed',
      title: '《试书》这次没学成',
      summary: '读不出这本书的正文。',
      projectName: '试书',
      href: `/settings?${new URLSearchParams({ section: 'packs', sub: 'creations' }).toString()}`,
    })
  })

  test('startLearn 的 Promise reject（IPC 挂了）：也走一条失败通知', async () => {
    const notified: ResultNotification[] = []
    mockElectron({
      startLearn: () => Promise.reject(new Error('IPC 挂了')),
      upsertResultNotification: (notification: ResultNotification) => {
        notified.push(notification)
        return Promise.resolve(EMPTY_NOTIFICATION_LIST)
      },
    })

    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    await Promise.resolve()
    await Promise.resolve()

    expect(notified).toHaveLength(1)
    expect(notified[0]?.summary).toBe('IPC 挂了')
  })

  test('用户自己取消（result.status=cancelled）：不发通知——用户自己停的，不用提醒', async () => {
    let notifyCalls = 0
    mockElectron({
      startLearn: () => Promise.resolve({ status: 'cancelled' } as PackLearnResult),
      upsertResultNotification: () => {
        notifyCalls += 1
        return Promise.resolve(EMPTY_NOTIFICATION_LIST)
      },
    })

    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    await Promise.resolve()
    await Promise.resolve()

    expect(notifyCalls).toBe(0)
  })

  test('进度事件到达终态 phase（done）本身不触发通知——只认 session.result 落定这一个信号源，' +
    '避免「主进程事件通道」和「Promise 结果通道」各发一次撞车成重复通知', () => {
    let handler: ((event: PackLearnEvent) => void) | null = null
    let notifyCalls = 0
    mockElectron({
      startLearn: () => new Promise<PackLearnResult>(() => {}),
      upsertResultNotification: () => {
        notifyCalls += 1
        return Promise.resolve(EMPTY_NOTIFICATION_LIST)
      },
      onPackLearnEvent: (cb: (event: PackLearnEvent) => void) => {
        handler = cb
        return () => {}
      },
    })

    ensurePackLearnSubscription()
    usePackLearnStore.getState().startLearning(NOVEL_SOURCE, 'skim')
    handler?.({ phase: 'done', message: '学完了：留下 3 张卡。', draftId: 'draft-1' })

    expect(notifyCalls).toBe(0)
  })
})
