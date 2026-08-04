import { create } from 'zustand'

import {
  cancelCharacterChat,
  enrichCharacterStatuses,
  flushCharacterChatProfile,
  getConfig,
  listAppearedCharacters,
  readCharacterChatTranscript,
  saveCharacterChatTranscript,
  sendCharacterChatMessage,
} from '@/lib/ipc'
import { resolvePrimaryModel } from '@shared/lib/model-slots'
import type {
  CharacterChatMessage,
  CharacterChatStreamEvent,
  CharacterChatUserMode,
  CharacterContact,
} from '@shared/types/character-chat'

/**
 * 唠个嗑（Character chat）板块状态。
 *
 * 切片边界：
 * - #200 本切片：联系人加载（来自 Appeared character reader）、选中联系人、模型服务验证闸门。
 * - #201：在本 store 上叠加消息发送 / 流式回复 / 失败重试。
 * - #202：叠加 transcript 本机持久化与打磨交互。
 *
 * 联系人来自契约化 reader，renderer 不扫文件、不自行判定出场（ADR-0012）。
 */

export type CharacterChatContactsPhase = 'idle' | 'loading' | 'loaded' | 'failed'

/** 固定作者身份（MVP）；数据结构预留 reader（ADR-0010）。 */
const MVP_USER_MODE: CharacterChatUserMode = 'author'

// loadContacts 并发序号（review P3）：同项目连续刷新（「刷新角色状态」/ 重开板块）时，
// 旧 enrich 结果晚到不得覆盖新一批——每次 loadContacts ++ 此序号，写回前校验仍是当次。
let loadContactsRequestSeq = 0

/** 某个联系人的会话工作缓冲（#201 为内存态；#202 接入本机持久化）。 */
export interface CharacterChatConversation {
  messages: CharacterChatMessage[]
  /** 当前在途回复的 runId（null = 空闲）。 */
  activeRunId: string | null
  /** 最近一次用户消息文本，用于发送失败后重试。 */
  lastUserMessage: string | null
}

export interface CharacterChatStore {
  projectPath: string | null
  contactsPhase: CharacterChatContactsPhase
  contacts: CharacterContact[]
  knowledgeBoundaryChapter: number | null
  contactsError: string | null
  activeCharacterUid: string | null
  /** 模型服务是否已验证（null = 尚未读取 config）。未验证时聊天入口闸门关闭。 */
  modelServiceVerified: boolean | null
  /** 会话缓冲（按 character_uid）。 */
  conversations: Record<string, CharacterChatConversation>
  /** runId → character_uid 路由表（流事件回填用）。 */
  runRouting: Record<string, string>
  /** 已从本机存档恢复过的 character_uid（避免重复 restore 覆盖在途消息）。 */
  hydratedUids: string[]

  setProjectPath: (projectPath: string | null) => void
  loadContacts: (projectPath: string) => Promise<void>
  refreshModelServiceVerification: () => Promise<void>
  selectContact: (characterUid: string | null) => void
  restoreTranscript: (characterUid: string) => Promise<void>
  sendMessage: (characterUid: string, message: string) => Promise<void>
  retryLastMessage: (characterUid: string) => Promise<void>
  applyStreamEvent: (event: CharacterChatStreamEvent) => void
  /** 取消所有在途 run，并清空对应会话的 activeRunId（board 卸载时调用，避免孤儿在途态）。 */
  cancelActiveRuns: () => void
  reset: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function makeMessageId(): string {
  return `ccm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function makeRunId(): string {
  return `ccr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 气泡延迟播放（微信式「一条条蹦」）。runner 把多条 bubble 瞬间发来，这里排队、
 * 按打字停顿逐条上屏；停顿期间 UI 凭 activeRunId 显示「正在输入」。
 *
 * 调度器可注入：测试注入同步执行版，免 fake timer。生产默认 setTimeout。
 */
// 首条气泡：模型生成本身已让用户等过一段，故走快通道、尽快冒出来。
const FIRST_BUBBLE_MIN_MS = 250
const FIRST_BUBBLE_MAX_MS = 1100
// 后续气泡：模型早已生成完、全在队列里缓着，节奏全靠这里撑——给足「正在输入」时长，
// 否则一条接一条嗖嗖蹦，失去微信式「停顿→打字→蹦一条」的真人感。
const NEXT_BUBBLE_MIN_MS = 850
const NEXT_BUBBLE_MAX_MS = 2600
const BUBBLE_MS_PER_CHAR = 80

/**
 * 一条气泡上屏前「正在输入」停顿时长。按文本长度估打字耗时，并按是否首条夹在区间内：
 * 首条快（生成已让用户等过），后续条慢（撑起逐条节奏）。
 */
export function bubbleDelayMs(text: string, isFirst: boolean): number {
  const min = isFirst ? FIRST_BUBBLE_MIN_MS : NEXT_BUBBLE_MIN_MS
  const max = isFirst ? FIRST_BUBBLE_MAX_MS : NEXT_BUBBLE_MAX_MS
  return Math.min(max, Math.max(min, text.length * BUBBLE_MS_PER_CHAR))
}

type BubbleScheduleFn = (cb: () => void, delayMs: number) => void
function defaultBubbleSchedule(cb: () => void, delayMs: number): void {
  setTimeout(cb, delayMs)
}
let bubbleSchedule: BubbleScheduleFn = defaultBubbleSchedule

/** 仅供测试：注入同步/可控调度器；传 null 复位为 setTimeout。生产不调用。 */
export function __setBubbleScheduleForTest(fn: BubbleScheduleFn | null): void {
  bubbleSchedule = fn ?? defaultBubbleSchedule
}

interface BubblePlayback {
  characterUid: string
  queue: string[]
  draining: boolean
  completed: boolean
  /** 本 run 已上屏几条——首条走快通道，第 2 条起走慢通道。 */
  played: number
}
const bubblePlaybacks = new Map<string, BubblePlayback>()

/** 往会话末尾 append 一条 complete 角色气泡（由播放队列驱动）。 */
function appendCharacterBubble(characterUid: string, text: string): void {
  const message: CharacterChatMessage = {
    id: makeMessageId(),
    role: 'character',
    text,
    status: 'complete',
    createdAt: new Date().toISOString(),
  }
  // 函数式更新保证读改写原子：避免两次 getState() 快照之间被其他 setState 插入而丢气泡。
  useCharacterChatStore.setState((state) => {
    const conversation = state.conversations[characterUid]
    if (!conversation) return state
    return {
      conversations: {
        ...state.conversations,
        [characterUid]: { ...conversation, messages: [...conversation.messages, message] },
      },
    }
  })
}

/** 收尾一次 run：清 activeRunId + runRouting，整段落盘。 */
function finalizeBubbleRun(runId: string): void {
  const playback = bubblePlaybacks.get(runId)
  bubblePlaybacks.delete(runId)
  const state = useCharacterChatStore.getState()
  const characterUid = playback?.characterUid ?? state.runRouting[runId]
  if (!characterUid) return
  const conversation = state.conversations[characterUid]
  if (!conversation) return
  const { [runId]: _done, ...runRouting } = state.runRouting
  useCharacterChatStore.setState({
    conversations: {
      ...state.conversations,
      [characterUid]: { ...conversation, activeRunId: null },
    },
    runRouting,
  })
  const projectPath = useCharacterChatStore.getState().projectPath
  if (projectPath) {
    persistTranscript(projectPath, characterUid, useCharacterChatStore.getState().conversations[characterUid].messages)
  }
}

/** 逐条把队列里的气泡按停顿上屏；队列空且已 completed 则收尾。 */
function drainBubblePlayback(runId: string): void {
  const playback = bubblePlaybacks.get(runId)
  if (!playback) return
  if (playback.queue.length === 0) {
    playback.draining = false
    if (playback.completed) finalizeBubbleRun(runId)
    return
  }
  playback.draining = true
  const text = playback.queue.shift() as string
  const isFirst = playback.played === 0
  playback.played += 1
  bubbleSchedule(() => {
    // cancel / failed 已清掉该 playback 则丢弃这条（无 clearTimeout，靠存在性守卫）。
    if (!bubblePlaybacks.has(runId)) return
    appendCharacterBubble(playback.characterUid, text)
    drainBubblePlayback(runId)
  }, bubbleDelayMs(text, isFirst))
}

function emptyConversation(): CharacterChatConversation {
  return { messages: [], activeRunId: null, lastUserMessage: null }
}

const initialState = {
  projectPath: null as string | null,
  contactsPhase: 'idle' as CharacterChatContactsPhase,
  contacts: [] as CharacterContact[],
  knowledgeBoundaryChapter: null as number | null,
  contactsError: null as string | null,
  activeCharacterUid: null as string | null,
  modelServiceVerified: null as boolean | null,
  conversations: {} as Record<string, CharacterChatConversation>,
  runRouting: {} as Record<string, string>,
  hydratedUids: [] as string[],
}

/** MVP 固定 author；统一 transcript 持久化的归属用模式。 */
function persistTranscript(projectPath: string, characterUid: string, messages: CharacterChatMessage[]): void {
  // 只落 complete 终态消息：streaming 尚未定型、failed 是失败气泡——两者都不入档（对齐「失败气泡不入档」）。
  // 失败气泡只在内存存活（当前会话可点重试，lastUserMessage 还在），永不持久化、恢复后永不出现点不动的重试。
  try {
    void saveCharacterChatTranscript({
      projectPath,
      characterUid,
      userMode: MVP_USER_MODE,
      messages: messages.filter((message) => message.status === 'complete'),
    })?.catch?.(() => {
      // 存档失败不影响聊天体验：下次成功回合会再次整段落盘。
    })
  } catch {
    // IPC 缺失等同步异常同样吞掉，聊天体验优先。
  }
}

export const useCharacterChatStore = create<CharacterChatStore>((set, get) => ({
  ...initialState,

  setProjectPath: (projectPath) => {
    const prev = get()
    if (prev.projectPath === projectPath) return
    // 切项目前对上一个 active 会话 flush 一次（兜底触发提炼；无 active 则跳过）。
    if (prev.projectPath && prev.activeCharacterUid) {
      const contact = prev.contacts.find((c) => c.characterUid === prev.activeCharacterUid)
      void flushCharacterChatProfile({
        projectPath: prev.projectPath,
        characterUid: prev.activeCharacterUid,
        characterName: contact?.name ?? '这个角色',
      }).catch(() => {})
    }
    // 清掉模块级播放队列：否则旧项目排队中的延迟气泡回调（靠 has(runId) 存活）
    // 会在切项目后写进新项目的同 uid 会话（复制项目场景）。与 reset() 一致。
    bubblePlaybacks.clear()
    set({
      ...initialState,
      projectPath,
    })
  },

  loadContacts: async (projectPath) => {
    const requestSeq = ++loadContactsRequestSeq
    set({ projectPath, contactsPhase: 'loading', contactsError: null })
    try {
      const result = await listAppearedCharacters(projectPath)
      // 切到别的项目、或同项目又发起新一次 loadContacts → 丢弃过期响应（review P3）。
      if (get().projectPath !== projectPath || loadContactsRequestSeq !== requestSeq) return

      const activeStillValid =
        get().activeCharacterUid !== null &&
        result.contacts.some((contact) => contact.characterUid === get().activeCharacterUid)

      const nextActiveCharacterUid = activeStillValid
        ? get().activeCharacterUid
        : (result.contacts[0]?.characterUid ?? null)

      set({
        contactsPhase: 'loaded',
        contacts: result.contacts,
        knowledgeBoundaryChapter: result.knowledgeBoundaryChapter,
        contactsError: null,
        activeCharacterUid: nextActiveCharacterUid,
      })

      // 默认/保留选中的联系人也要恢复历史：否则重开板块时默认角色看似无历史，
      // 必须手动切换才加载（#202 回归）。restoreTranscript 自带 hydratedUids/在途守卫，
      // 不会覆盖在途消息或重复 restore。
      if (nextActiveCharacterUid) void get().restoreTranscript(nextActiveCharacterUid)

      // currentStatus 富化要 spawn 引擎进程（~2s）：不阻塞列表渲染，后台拉回后按 uid merge。
      // 切项目则丢弃；空结果/失败保持无 status，列表照常（currentStatus 是可选富化字段）。
      void (async () => {
        const characterUids = result.contacts.map((contact) => contact.characterUid)
        if (characterUids.length === 0) return
        try {
          const statusByUid = await enrichCharacterStatuses({
            projectPath,
            characterUids,
            knowledgeBoundaryChapter: result.knowledgeBoundaryChapter,
          })
          if (
            get().projectPath !== projectPath ||
            loadContactsRequestSeq !== requestSeq ||
            Object.keys(statusByUid).length === 0
          )
            return
          set({
            contacts: get().contacts.map((contact) => ({
              ...contact,
              currentStatus: statusByUid[contact.characterUid] ?? contact.currentStatus ?? null,
            })),
          })
        } catch {
          // 富化失败：保持无 status，列表照常。
        }
      })()
    } catch (error) {
      if (get().projectPath !== projectPath || loadContactsRequestSeq !== requestSeq) return
      set({
        contactsPhase: 'failed',
        contactsError: errorMessage(error),
      })
    }
  },

  refreshModelServiceVerification: async () => {
    try {
      const payload = await getConfig()
      set({ modelServiceVerified: resolvePrimaryModel(payload.config)?.verified === true })
    } catch {
      // 读取失败按未验证处理：宁可闸门关闭也不放行未验证调用。
      set({ modelServiceVerified: false })
    }
  },

  selectContact: (characterUid) => {
    set({ activeCharacterUid: characterUid })
    if (characterUid) void get().restoreTranscript(characterUid)
  },

  restoreTranscript: async (characterUid) => {
    const { projectPath, hydratedUids, conversations } = get()
    if (!projectPath) return
    // 已恢复过，或已有在途/本地消息，则不覆盖（避免抹掉用户刚发的内容）。
    if (hydratedUids.includes(characterUid)) return
    const existing = conversations[characterUid]
    if (existing && (existing.messages.length > 0 || existing.activeRunId)) {
      set({ hydratedUids: [...hydratedUids, characterUid] })
      return
    }

    try {
      const transcript = await readCharacterChatTranscript({ projectPath, characterUid, userMode: MVP_USER_MODE })
      // 恢复期间项目切换或已有在途消息则放弃回填。
      if (get().projectPath !== projectPath) return
      const current = get().conversations[characterUid]
      if (current && (current.messages.length > 0 || current.activeRunId)) {
        set({ hydratedUids: [...get().hydratedUids, characterUid] })
        return
      }
      set({
        conversations: {
          ...get().conversations,
          [characterUid]: {
            messages: transcript.messages,
            activeRunId: null,
            lastUserMessage: null,
          },
        },
        hydratedUids: [...get().hydratedUids, characterUid],
      })
    } catch {
      set({ hydratedUids: [...get().hydratedUids, characterUid] })
    }
  },

  sendMessage: async (characterUid, message) => {
    const trimmed = message.trim()
    if (!trimmed) return
    const { projectPath, conversations } = get()
    if (!projectPath) return

    const existing = conversations[characterUid] ?? emptyConversation()
    // 同一联系人有在途回复时不重复发送。
    if (existing.activeRunId) return

    const now = new Date().toISOString()
    const runId = makeRunId()
    const userMessage: CharacterChatMessage = {
      id: makeMessageId(),
      role: 'user',
      text: trimmed,
      status: 'complete',
      createdAt: now,
    }

    // 不预建占位角色气泡：回复以多条 bubble 形式逐条蹦出。
    // 在途期间 UI 凭 activeRunId !== null 显示「正在输入」。
    set({
      conversations: {
        ...conversations,
        [characterUid]: {
          messages: [...existing.messages, userMessage],
          activeRunId: runId,
          lastUserMessage: trimmed,
        },
      },
      runRouting: { ...get().runRouting, [runId]: characterUid },
    })

    try {
      await sendCharacterChatMessage({
        runId,
        projectPath,
        characterUid,
        userMode: MVP_USER_MODE,
        message: trimmed,
      })
    } catch (error) {
      get().applyStreamEvent({ type: 'failed', runId, message: errorMessage(error) })
    }
  },

  retryLastMessage: async (characterUid) => {
    const conversation = get().conversations[characterUid]
    if (!conversation || conversation.activeRunId) return
    const lastUserMessage = conversation.lastUserMessage
    if (!lastUserMessage) return

    // 丢弃上一条失败的角色气泡与触发它的用户气泡，按原文重发（避免重复用户气泡堆叠）。
    const messages = [...conversation.messages]
    while (messages.length > 0 && messages[messages.length - 1]?.role === 'character') {
      messages.pop()
    }
    if (messages.length > 0 && messages[messages.length - 1]?.role === 'user') {
      messages.pop()
    }

    set({
      conversations: {
        ...get().conversations,
        [characterUid]: { ...conversation, messages },
      },
    })

    await get().sendMessage(characterUid, lastUserMessage)
  },

  applyStreamEvent: (event) => {
    const characterUid = get().runRouting[event.runId]
    if (!characterUid) return
    const conversation = get().conversations[characterUid]
    if (!conversation) return

    if (event.type === 'started') {
      // 不预建气泡：activeRunId !== null 即在 UI 显示「正在输入」。
      return
    }

    if (event.type === 'bubble') {
      const playback = bubblePlaybacks.get(event.runId) ?? {
        characterUid,
        queue: [],
        draining: false,
        completed: false,
        played: 0,
      }
      playback.queue.push(event.text)
      bubblePlaybacks.set(event.runId, playback)
      if (!playback.draining) drainBubblePlayback(event.runId)
      return
    }

    if (event.type === 'completed') {
      const playback = bubblePlaybacks.get(event.runId)
      if (playback && (playback.queue.length > 0 || playback.draining)) {
        // 还有气泡在播：标记完成，播完再收尾。
        playback.completed = true
        return
      }
      // 无待播气泡（无 bubble 或已播完）→ 直接收尾。
      finalizeBubbleRun(event.runId)
      return
    }

    // failed：丢弃未播气泡，保留已上屏的，追加一条失败气泡，留 lastUserMessage 供重试。
    bubblePlaybacks.delete(event.runId)
    const failedMessage: CharacterChatMessage = {
      id: makeMessageId(),
      role: 'character',
      text: event.message,
      status: 'failed',
      createdAt: new Date().toISOString(),
    }
    const { [event.runId]: _failed, ...runRouting } = get().runRouting
    const messages = [...conversation.messages, failedMessage]
    set({
      conversations: { ...get().conversations, [characterUid]: { ...conversation, messages, activeRunId: null } },
      runRouting,
    })
    const projectPath = get().projectPath
    // 持久化只落 complete（失败气泡不入档），成功的用户/角色回合保留。
    if (projectPath) persistTranscript(projectPath, characterUid, messages)
  },

  cancelActiveRuns: () => {
    const { runRouting, conversations } = get()
    const runIds = Object.keys(runRouting)
    if (runIds.length === 0) return

    for (const runId of runIds) {
      bubblePlaybacks.delete(runId) // 丢弃未播气泡（timer 回调里靠存在性守卫不再 append）
      try {
        void cancelCharacterChat(runId)?.catch?.(() => {
          // 取消失败（run 已结束等）无妨：本地一并清掉孤儿在途态。
        })
      } catch {
        // IPC 缺失等同步异常吞掉。
      }
    }

    // 清在途态：activeRunId 归零、runRouting 清空，避免重开板块后 composer 永久禁用。
    // 已上屏的角色气泡保留（取消是主动离开，不是失败）。
    const nextConversations: Record<string, CharacterChatConversation> = {}
    for (const [uid, conversation] of Object.entries(conversations)) {
      nextConversations[uid] = conversation.activeRunId ? { ...conversation, activeRunId: null } : conversation
    }
    set({ conversations: nextConversations, runRouting: {} })
  },

  reset: () => {
    bubblePlaybacks.clear()
    set({ ...initialState })
  },
}))

/** 订阅主进程角色聊天流事件，回填到 store。底层订阅原语（供常驻守卫复用）。 */
export function subscribeCharacterChatEvents(
  onCharacterChatEvent: (callback: (event: CharacterChatStreamEvent) => void) => () => void,
): () => void {
  return onCharacterChatEvent((event) => {
    useCharacterChatStore.getState().applyStreamEvent(event)
  })
}

/**
 * 模块级 once 守卫：首次调用即订阅主进程流事件，订阅后 app 生命周期内常驻、永不取消。
 *
 * 为什么常驻：board 卸载（切场景）若取消订阅，则在途 run 的 delta/completed 流事件被丢弃，
 * activeRunId 永久非 null（composer 永久禁用）、回复半截卡死。常驻订阅 → board 卸载也不丢流，
 * run 完成时 applyStreamEvent 照常 completed→persistTranscript→清 activeRunId，回板块即见完成的回复。
 *
 * 显式「取消」语义保留在 store.cancelActiveRuns（供未来取消按钮），不再绑在 board 卸载上。
 */
let characterChatSubscriptionStarted = false
export function ensureCharacterChatSubscription(
  onCharacterChatEvent: (callback: (event: CharacterChatStreamEvent) => void) => () => void,
): void {
  if (characterChatSubscriptionStarted) return
  characterChatSubscriptionStarted = true
  // 订阅后不持有 unsubscribe：常驻到 app 退出，刻意不在任何地方取消。
  subscribeCharacterChatEvents(onCharacterChatEvent)
}

/** 仅供测试：重置 once 守卫，让下一次 ensure 重新订阅。生产不调用。 */
export function __resetCharacterChatSubscriptionForTest(): void {
  characterChatSubscriptionStarted = false
}
