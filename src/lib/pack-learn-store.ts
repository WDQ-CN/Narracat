import { create } from 'zustand'
import { upsertResultNotification } from './ipc'
import { createPackLearnResultNotificationDraft } from '@shared/lib/result-notifications'
import type { PackLearnEvent, PackLearnResult, PackLearnSource, PackLearnTier } from '@shared/types/capability-pack'

/**
 * 「从书学写法」学习会话状态（B2 刀4 Task 12）。
 *
 * 为什么要提到 store 而不是留在 `LearnFromBookView` 的本地 state：`startLearn` 是分钟级长 Promise，
 * 主进程学习编排全程只认一个 learner 实例（一次只能学一本书，见 electron/main/ipc/packs.ts
 * `getPackLearner`）。若把在途会话状态放组件本地 state，用户切到设置页别的子视图（甚至只是切个
 * tab）会卸载 `LearnFromBookView`，重新进入时无从得知「刚才是不是还在跑、跑到哪了」——文案承诺的
 * 「学习在后台进行，你可以先去别处」就不成立。这里把会话提升到模块级 store，`startLearning` 发起后
 * 事件订阅与 Promise 结果都写回 store，组件卸载不影响会话，重新挂载读 store 就能接着看。
 *
 * `session.result` 只落 ok/error 两种终态——cancelled 不在这里出现（产品裁决 follow-up C：点「停止」
 * 就是不想要了，没有信息量支撑一屏「已停止」确认页）。用 `Exclude` 而非注释约定，让这件事在编译期
 * 成立：`startLearning` 收到 cancelled 结果时直接清空 session（见下方实现），任何试图把 cancelled
 * 塞进 session.result 的代码在 typecheck 就会炸。
 */
type PackLearnSessionResult = Exclude<PackLearnResult, { status: 'cancelled' }>

export interface PackLearnSession {
  source: PackLearnSource
  tier: PackLearnTier
  /** 最近一次进度事件（未到终态时展示 message）。 */
  event: PackLearnEvent | null
  /** 终态（ok/error），未到达为 null——`session.result` 是否非空即「是否已跑完」。 */
  result: PackLearnSessionResult | null
}

interface PackLearnStore {
  session: PackLearnSession | null
  /** 发起一次学习；已有会话在跑（result 未到达）时忽略，对齐主进程 isBusy 语义,不重复调用撞
   * 「已有一本书在学」错误。 */
  startLearning: (source: PackLearnSource, tier: PackLearnTier) => void
  /** 停止当前学习；主进程 cancel() 只 abort 信号，终态经 startLearning 的 Promise 回填。 */
  cancelLearning: () => void
  /** 清空已到终态的会话（回选源页 / 打开草稿工程后）；仍在跑时不清，不留孤儿态。 */
  clearSession: () => void
}

/**
 * 学习终态接入全局结果通知（刀4 终审 follow-up）：分钟级后台任务跑完/跑挂时，用户可能已经切去
 * 工作台写作，只靠 `LearnFromBookView` 页面内展示是看不到的——复用既有 `upsertResultNotification`
 * 全局通知（同 use-agent-events.ts 对 agent run 终态的先例）。cancelled 是用户自己停的，不通知。
 * 只在 `startLearning` 的 Promise 恰好 settle 一次的地方调用，天然不会对同一次学习重复通知。
 */
function notifyLearnResult(source: PackLearnSource, result: PackLearnResult): void {
  if (result.status === 'cancelled') return
  // 老版本 preload 没有这个通道时安静跳过——学习结果本身已经落进 session.result，通知只是锦上添花。
  if (typeof window === 'undefined' || !window.electron?.upsertResultNotification) return
  const notification = createPackLearnResultNotificationDraft({
    source,
    result,
    occurredAt: new Date().toISOString(),
  })
  void upsertResultNotification(notification).catch((error) => console.error(error))
}

export const usePackLearnStore = create<PackLearnStore>((set, get) => ({
  session: null,

  startLearning: (source, tier) => {
    const current = get().session
    if (current && !current.result) return
    set({ session: { source, tier, event: null, result: null } })
    window.electron
      .startLearn({ source, tier })
      .then((result) => {
        if (result.status === 'cancelled') {
          // 用户自己叫停：没有产出可回顾，也没有「重试」的对象——不落进 session.result 渲染一屏
          // 「已停止」确认页，直接清空会话，视图（订阅 session）自然弹回选源页。这也覆盖了用户点了
          // 停止就去忙别的、稍后回来的情况：回来时看到的是选源页，不是一个需要再点一次才能离开的尸体页。
          set({ session: null })
          return
        }
        set((state) => (state.session ? { session: { ...state.session, result } } : state))
        notifyLearnResult(source, result)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : '学习失败，请重试。'
        const result: PackLearnSessionResult = { status: 'error', message }
        set((state) => (state.session ? { session: { ...state.session, result } } : state))
        notifyLearnResult(source, result)
      })
  },

  cancelLearning: () => {
    void window.electron.cancelLearn().catch(() => {
      // 取消失败无碍：主进程侧要么本就没在跑，要么会话很快自然到终态。
    })
  },

  clearSession: () => {
    if (get().session && !get().session?.result) return
    set({ session: null })
  },
}))

/**
 * 模块级 once 守卫：首次调用即订阅主进程学习进度事件，订阅后 app 生命周期内常驻、永不取消
 * （同 `character-chat-store.ts` 的 `ensureCharacterChatSubscription` 先例）——`LearnFromBookView`
 * 卸载（切子视图/切设置页）不该丢事件，否则「去别处再回来」看到的进度会卡在离开前那一帧。
 */
let packLearnSubscriptionStarted = false
export function ensurePackLearnSubscription(): void {
  if (packLearnSubscriptionStarted) return
  packLearnSubscriptionStarted = true
  window.electron.onPackLearnEvent((event) => {
    usePackLearnStore.setState((state) =>
      state.session && !state.session.result ? { session: { ...state.session, event } } : state,
    )
  })
}

/** 仅供测试：重置 once 守卫，让下一次 ensure 重新订阅。生产不调用。 */
export function __resetPackLearnSubscriptionForTest(): void {
  packLearnSubscriptionStarted = false
}
