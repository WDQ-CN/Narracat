import { create } from 'zustand'
import type {
  PackWizardCardSummary,
  PackWizardEvent,
  PackWizardMessage,
  PackWizardPhase,
  PackWizardSnapshot,
} from '@shared/types/capability-pack'

/**
 * 「作家向导」访谈会话状态（B2 刀5 Task 5 + 会话可恢复重设计）。
 *
 * 为什么提到模块级 store 而不留在 WizardView 本地 state：访谈是分钟级多轮会话，主进程全程只认
 * 一个 wizard 实例（一次一场访谈，见 electron/main/ipc/packs.ts packWizardProvider）。用户切去别的子视图
 * 再回来时，消息流和进行到哪一步都必须还在——同 pack-learn-store 的会话提升先例。
 *
 * 会话可恢复三原则（页面重载后 store 清空但主进程会话还在，不能让用户撞「进行中」死循环）：
 * - 提示不如恢复：进向导先水合（hydratePackWizardOnEnter）——主进程有会话（进行中或终态）就
 *   取快照整体重建现场，直接给完整对话视图/终态页。
 * - 主进程单一真相源：快照带 lastSeq，水合期间入站事件先缓冲、快照落地后重放，seq 门去重——
 *   「快照 invoke 在途时事件先到」的竞态窗口由这一套顺序闭掉。
 * - 拒绝必须带出口：startWizard 收到 busy 拒绝 ack 不落 error 终态，转身水合恢复现场（正常
 *   不可达——入口已水合，这是竞态保险）。
 *
 * 事件归约纪律（对齐主进程 pack-wizard.ts 的终态单发不变量）：
 * - phase 事件只推进 phase；assistant 事件只追加消息；done/error/cancelled 各落一次终态。
 * - 迟到/重放事件以 seq 为准丢弃（`seq <= lastSeq`）；无会话（reset 后）与已终态仍不复活。
 * - 空卡路径主进程会先 emit phase 'saving' 再 done(draftId:null)（T3 评审观察）：done 事件把
 *   phase 覆盖成 'done' 终态，不残留 'saving'；UI 靠 draftId === null 区分「没聊出可炼的写法」。
 */

export type { PackWizardMessage }

interface PackWizardStore {
  /** 访谈消息流；用户消息在 sendMessage 时乐观追加，assistant 消息由事件追加，水合时整体替换。 */
  messages: PackWizardMessage[]
  /** null = 还没开始（空状态页）；终态三值（done/error/cancelled）也落在这里。 */
  phase: PackWizardPhase | null
  /** done 终态携带；null 且 phase='done' = 访谈没聊出可炼的写法（不落工程）。 */
  draftId: string | null
  /** done 终态携带的卡数。 */
  cardCount: number | null
  /** done 终态的卡级摘要（编译/预览命中逐卡记账）；旧事件形态缺省为 null。 */
  cards: PackWizardCardSummary[] | null
  /** done 终态里因格式不完整被放弃的卡数；旧事件形态缺省为 null。 */
  droppedCount: number | null
  /** error 终态的人话原因。 */
  error: string | null
  /** 本 store 是否持有一场会话（本地发起或水合恢复）；「再来一次」先 resetWizard。 */
  started: boolean
  /** 已应用的最大事件序号（主进程会话实例内单调递增）；迟到丢弃与水合重放去重都以它为准。 */
  lastSeq: number
  /** 发起一次访谈；已持有会话（无论进行中还是终态）忽略。 */
  startWizard: () => void
  /** 发消息：乐观追加用户消息 + 调 IPC；仅 phase='awaiting_user' 时受理（向导忙/终态一律拒）。 */
  sendMessage: (text: string) => void
  /** 请求停止；cancelled 终态经事件流回来，这里不本地预判。 */
  cancelWizard: () => void
  /** 「再来一次」：仅终态允许——先请主进程 dismiss 清掉终态实例（防重载复活），再清本地。 */
  resetWizard: () => void
}

const TERMINAL_PHASES: readonly PackWizardPhase[] = ['done', 'error', 'cancelled']

export function isWizardTerminalPhase(phase: PackWizardPhase | null): boolean {
  return phase !== null && TERMINAL_PHASES.includes(phase)
}

const INITIAL_STATE = {
  messages: [] as PackWizardMessage[],
  phase: null as PackWizardPhase | null,
  draftId: null as string | null,
  cardCount: null as number | null,
  cards: null as PackWizardCardSummary[] | null,
  droppedCount: null as number | null,
  error: null as string | null,
  started: false,
  lastSeq: 0,
}

export const usePackWizardStore = create<PackWizardStore>((set, get) => ({
  ...INITIAL_STATE,

  startWizard: () => {
    if (get().started) return
    set({ ...INITIAL_STATE, started: true, phase: 'preparing' })
    // 主进程 start() 会 await 完整首轮才 resolve（分钟级），进度全靠事件流；ack 只用来接「被拒/IPC 挂」。
    window.electron
      .startWizard()
      .then((ack) => {
        if (ack.ok) return
        if (isWizardTerminalPhase(usePackWizardStore.getState().phase)) return
        // busy 竞态兜底（正常不可达，入口已水合）：主进程已有会话却被本地当新会话开——
        // 不落 error 死路，转身取快照把现场恢复回来；快照若已空（会话恰好收尾被清）则回干净开场。
        void runWizardHydration()
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : '向导没能启动，请重试。'
        set((state) => (isWizardTerminalPhase(state.phase) ? state : { phase: 'error', error: message }))
      })
  },

  sendMessage: (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (get().phase !== 'awaiting_user') return
    const userMessage: PackWizardMessage = { role: 'user', text: trimmed }
    // 乐观追加 + 本地先置 thinking：主进程的 thinking 事件要过一趟 IPC 才到，这个间隙里 phase 若还停在
    // awaiting_user，连点发送会重复受理；先置上，随后到达的同值 phase 事件幂等覆盖。
    set((state) => ({ messages: [...state.messages, userMessage], phase: 'thinking' }))
    window.electron
      .sendWizardMessage({ text: trimmed })
      .then((ack) => {
        if (!ack.ok) rollbackRejectedSend(userMessage)
      })
      .catch(() => rollbackRejectedSend(userMessage))
  },

  cancelWizard: () => {
    void window.electron.cancelWizard().catch(() => {
      // 取消失败无碍：主进程侧要么本就没在跑，要么会话很快自然到终态。
    })
  },

  resetWizard: () => {
    if (!isWizardTerminalPhase(get().phase)) return
    // 先请主进程丢弃终态实例引用（防「再来一次」后重载又复活旧终态），再清本地。dismiss 失败
    // 不阻断：下次 start 的 obtainForStart 一样会重建实例，最坏是重载后再看一次终态页。
    void window.electron.dismissWizard().catch(() => {})
    set({ ...INITIAL_STATE })
  },
}))

/**
 * send 被主进程拒绝（busy/时机竞态）或 IPC 出错：撤回乐观追加的那条用户消息，phase 若还停在
 * 本地预置的 thinking 则退回 awaiting_user（事件流已把会话推去别处/终态时不动，如实为准）。
 * 消息按引用比对撤回——只撤这一条，不误伤后续到达的 assistant 消息。
 */
function rollbackRejectedSend(userMessage: PackWizardMessage): void {
  usePackWizardStore.setState((state) => {
    if (isWizardTerminalPhase(state.phase)) return state
    return {
      messages: state.messages.filter((message) => message !== userMessage),
      phase: state.phase === 'thinking' ? 'awaiting_user' : state.phase,
    }
  })
}

/** 水合互斥（同刻只跑一次）与缓冲区：buffer 非 null = 水合在途，入站事件先存后放。 */
let hydrationPromise: Promise<void> | null = null
let hydrationBuffer: PackWizardEvent[] | null = null

/**
 * 进向导入口水合：store 里已持有会话（本页生命周期内的真相，事件流一直在续）就不动；
 * 否则取主进程快照重建现场——页面重载后进行中会话直接回到对话视图，终态会话回到终态页。
 */
export function hydratePackWizardOnEnter(): Promise<void> {
  ensurePackWizardSubscription()
  if (usePackWizardStore.getState().started) return hydrationPromise ?? Promise.resolve()
  return runWizardHydration()
}

function runWizardHydration(): Promise<void> {
  if (hydrationPromise) return hydrationPromise
  ensurePackWizardSubscription()
  hydrationBuffer = []
  hydrationPromise = (async () => {
    let snapshot: PackWizardSnapshot | null = null
    try {
      snapshot = await window.electron.getWizardSnapshot()
    } catch {
      // 快照拿不到按无会话处理：开场页永远是可走的出口；若主进程真有会话，start 的 busy 拒绝
      // 还会兜回这里再试一次。
      snapshot = null
    }
    const buffered = hydrationBuffer ?? []
    hydrationBuffer = null
    if (!snapshot) {
      usePackWizardStore.setState({ ...INITIAL_STATE })
      return
    }
    // 快照整体替换本地状态（主进程单一真相源），再重放缓冲事件——seq 门自动丢弃 <= lastSeq 的
    // 重复帧，只应用快照之后新到的。
    usePackWizardStore.setState({
      messages: snapshot.messages,
      phase: snapshot.phase,
      draftId: snapshot.draftId,
      cardCount: snapshot.cardCount,
      cards: snapshot.cards ?? null,
      droppedCount: snapshot.droppedCount ?? null,
      error: snapshot.errorMessage,
      started: true,
      lastSeq: snapshot.lastSeq,
    })
    for (const event of buffered) applyWizardEvent(event)
  })().finally(() => {
    hydrationPromise = null
  })
  return hydrationPromise
}

/** 事件入口：水合在途先缓冲（快照落地后按 seq 重放去重），否则直接归约。 */
function reduceWizardEvent(event: PackWizardEvent): void {
  if (hydrationBuffer) {
    hydrationBuffer.push(event)
    return
  }
  applyWizardEvent(event)
}

function applyWizardEvent(event: PackWizardEvent): void {
  usePackWizardStore.setState((state) => {
    // 三道守卫：无会话（reset 后）不复活；已终态不改写；seq 不大于已应用序号的（水合重放
    // 重复帧/IPC 迟到）丢弃。
    if (!state.started || isWizardTerminalPhase(state.phase)) return state
    if (event.seq <= state.lastSeq) return state
    switch (event.kind) {
      case 'phase':
        // 契约防御（T5 评审 Minor-2）：终态三值不经 phase kind 下发（capability-pack.ts 注释约定，
        // 主进程 emitPhase 点位全是非终态）。真发来了也丢弃——否则会落一个无 draftId/无原因的
        // 假终态，把随后的真终态事件挡在终态门外。靠代码不靠约定。
        if (isWizardTerminalPhase(event.phase)) return state
        return { phase: event.phase, lastSeq: event.seq }
      case 'assistant':
        return { messages: [...state.messages, { role: 'assistant' as const, text: event.text }], lastSeq: event.seq }
      case 'done':
        // 空卡路径主进程先 emit 'saving' 再 done(null)：这里终态覆盖 phase，不残留 saving。
        return {
          phase: 'done' as const,
          draftId: event.draftId,
          cardCount: event.cardCount,
          cards: event.cards ?? null,
          droppedCount: event.droppedCount ?? null,
          lastSeq: event.seq,
        }
      case 'error':
        return { phase: 'error' as const, error: event.message, lastSeq: event.seq }
      case 'cancelled':
        return { phase: 'cancelled' as const, lastSeq: event.seq }
      default:
        return state
    }
  })
}

/**
 * 模块级 once 守卫：首次调用即订阅主进程向导事件，订阅后 app 生命周期内常驻、永不取消
 * （pack-learn-store 的 ensurePackLearnSubscription 先例）——WizardView 卸载（切子视图/切页面）
 * 不该丢事件，否则「去别处再回来」看到的进度会卡在离开前那一帧。
 */
let packWizardSubscriptionStarted = false
export function ensurePackWizardSubscription(): void {
  if (packWizardSubscriptionStarted) return
  packWizardSubscriptionStarted = true
  window.electron.onPackWizardEvent(reduceWizardEvent)
}

/** 仅供测试：重置 once 守卫，让下一次 ensure 重新订阅。生产不调用。 */
export function __resetPackWizardSubscriptionForTest(): void {
  packWizardSubscriptionStarted = false
}

/** 仅供测试：清掉水合互斥与缓冲的模块级状态。生产不调用。 */
export function __resetPackWizardHydrationForTest(): void {
  hydrationPromise = null
  hydrationBuffer = null
}
