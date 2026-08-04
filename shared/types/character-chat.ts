/**
 * Character chat /「唠个嗑」类型契约（ADR-0010 App-native runtime + ADR-0012 Character UID）。
 *
 * - CharacterContact 来源于 Appeared character reader（已确认设定 + 已完成章出场），
 *   以 character_uid 为 canonical 身份；name / settingPath 只作展示与定位冗余。
 * - 角色聊天是 App 层本机功能，不是 Agent run，也不写入 Novel project / NovelMemory。
 */

/** 用户身份模式：MVP 固定 author，数据结构预留 reader。 */
export type CharacterChatUserMode = 'author' | 'reader'

/**
 * 出场角色联系人（Appeared character contact）。
 *
 * 已确认设定 = bible/characters/ 下有角色档案且档案顶部含 character_identity；
 * 已出场 = 至少一个 Chapter completed 的 chapter_summaries.characters 含该 uid。
 * 知识边界固定为最新 Chapter completed（lastSeenChapter ≤ 该边界）。
 */
export interface CharacterContact {
  /** canonical Character UID（ADR-0012），聊天与记忆查询主键。 */
  characterUid: string
  /** 角色显示名（人读冗余，可能随设定更名）。 */
  name: string
  /** 首次出场的已完成章号。 */
  firstAppearedChapter: number
  /** 最近一次出场的已完成章号。 */
  lastSeenChapter: number
  /** 截至知识边界的角色实时状态（NovelMemory facts.status 折叠；缺失时可为空）。 */
  currentStatus?: string | null
  /** 角色档案相对项目根的路径（如 bible/characters/林衍.md）。 */
  settingPath: string
  /** 角色档案「别名」解析结果（社交资料卡副标题；无则空数组 / 缺省）。 */
  aliases?: string[]
  /** 角色档案「基本信息」小节解析出的入戏向字段（年龄/性别/外貌/职业/当前处境…；无则空数组 / 缺省）。 */
  basicInfo?: CharacterBasicInfoField[]
}

/** 角色资料卡的入戏向基本信息字段（来自角色档案「## 基本信息」小节）。 */
export interface CharacterBasicInfoField {
  label: string
  value: string
}

/** Appeared character reader 结果。knowledgeBoundaryChapter = 最新 Chapter completed。 */
export interface CharacterContactList {
  contacts: CharacterContact[]
  /** 联系人知识边界（最新已完成章号）；无已完成章时为 null。 */
  knowledgeBoundaryChapter: number | null
}

/** 单条聊天消息角色。 */
export type CharacterChatRole = 'user' | 'character'

/** 单条消息终态：complete=已上屏 / failed=失败气泡 / streaming=历史兼容（normalizeMessages 读旧档时折叠为 complete，新协议不再产生）。 */
export type CharacterChatMessageStatus = 'streaming' | 'complete' | 'failed'

export interface CharacterChatMessage {
  id: string
  role: CharacterChatRole
  text: string
  status: CharacterChatMessageStatus
  createdAt: string
}

/** 一对一会话存档：按 Novel project + Character UID + user mode 归属。 */
export interface CharacterChatTranscript {
  projectPath: string
  characterUid: string
  userMode: CharacterChatUserMode
  messages: CharacterChatMessage[]
  updatedAt: string
}

/** 发起一次角色聊天发送的请求契约（renderer → main）。 */
export interface CharacterChatSendRequest {
  /** 会话归属：用于流事件路由与（#202）存档键。 */
  runId: string
  projectPath: string
  characterUid: string
  userMode: CharacterChatUserMode
  /** 用户消息正文。 */
  message: string
}

/** 角色聊天流事件（main → renderer，'character-chat:event'）。 */
export type CharacterChatStreamEvent =
  | { type: 'started'; runId: string }
  | { type: 'bubble'; runId: string; bubbleIndex: number; text: string }
  | { type: 'completed'; runId: string; text: string }
  | { type: 'failed'; runId: string; message: string }

/** 角色聊天用户画像：全局作者画像 + 当前角色对用户的印象（ADR-0010，仅落 userData）。 */
export interface CharacterChatProfiles {
  /** 全局作者画像正文（跨项目跨角色共享，"你是谁"）。 */
  authorProfile: string
  /** 当前角色对用户的印象正文（每项目每角色）。 */
  impression: string
}
