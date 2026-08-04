/**
 * Character chat runner 的 prompt 组装（纯函数，可单测）。
 *
 * ADR-0010：角色回复上下文 = 角色设定身份 + 角色设定正文 + 最新 Chapter completed 边界
 *   + 按需 NovelMemory UID 读查（由 runner 用 character_uid 经只读工具补查）。
 * renderer 只发 project / character_uid / message / 最新完成章；不做知识路由（ADR-0010/0012）。
 *
 * 纪律：
 * - 系统 prompt 把角色「锁」在截至最新完成章的认知边界；不得让角色知道未来剧情。
 * - 角色聊天是纯聊天，不是 Agent action：不写文件、不入库、不产生产物、不通知。
 * - UI 只显示角色打字/消息增量；prompt 不要求展示工具调用或检索过程。
 */

import { CHAT_GAP_LABEL_THRESHOLD_MS, formatChatGap } from './relative-time.ts'

export interface CharacterChatPromptInput {
  /** 角色显示名（人读冗余）。 */
  name: string
  /** canonical Character UID（NovelMemory 补查主键）。 */
  characterUid: string
  /** 角色档案正文（bible/characters/<name>.md，含人读设定）。可能为空。 */
  settingContent: string
  /** 知识边界：最新 Chapter completed 章号；null = 尚无完成章节。 */
  knowledgeBoundaryChapter: number | null
  /** 最近一条历史消息时间（ISO）；用于时间感锚点。无历史为 null/undefined。 */
  lastChatAt?: string | null
  /** 当前时间（ms），便于测试注入；默认 Date.now()。 */
  nowMs?: number
  /** 全局用户画像正文（"懂你"层，可空）。 */
  authorProfile?: string
  /** 当前角色对用户的印象正文（"懂你"层，可空）。 */
  impression?: string
  /** 片4 处境包（确定性预注入的结构化记忆）；空串/未传 = 不注入该区块。 */
  situationPack?: string
}

/**
 * 组装角色扮演系统 prompt。把身份、设定、知识边界和「不出戏 / 不剧透 / 纯聊天」约束写清楚，
 * 并告诉模型现在拥有只读工具，可按需用 character_uid 查 NovelMemory 角色状态/关系/章节记忆补足处境。
 */
export function buildCharacterChatSystemPrompt(input: CharacterChatPromptInput): string {
  const {
    name,
    characterUid,
    settingContent,
    knowledgeBoundaryChapter,
    lastChatAt,
    nowMs,
    authorProfile,
    impression,
    situationPack,
  } = input
  const boundary =
    knowledgeBoundaryChapter !== null
      ? `你的认知边界是第 ${knowledgeBoundaryChapter} 章（最新已完成章节）。你只知道截至该章已经发生的剧情，绝不提及、暗示或预测之后才会发生的事。`
      : '本书尚无已完成章节，你对剧情进展几乎一无所知，只按你的角色设定本色对话。'

  const setting = settingContent.trim()
    ? `这是你的角色设定（人读档案，按它塑造你的性格、说话方式、关系与处境）：\n\n${settingContent.trim()}`
    : '你的角色设定档案暂为空，请按角色名与对话语境本色发挥，不要编造与设定冲突的关键事实。'

  const knowYouParts: string[] = []
  if (authorProfile?.trim()) knowYouParts.push(`你逐渐了解到 ta：\n${authorProfile.trim()}`)
  if (impression?.trim()) knowYouParts.push(`你对 ta 的印象：\n${impression.trim()}`)
  const knowYou = knowYouParts.length
    ? `关于和你聊天的这位——${knowYouParts.join('\n\n')}\n\n自然地体现你越来越懂 ta，别生硬复述这些条目；也绝不要说破"我知道你是谁""我是被写出来的"这类出戏的话。`
    : ''

  const nowValue = typeof nowMs === 'number' ? nowMs : Date.now()
  const lastChatMs = lastChatAt ? Date.parse(lastChatAt) : NaN
  const timeAnchor =
    Number.isFinite(lastChatMs) && nowValue - lastChatMs > CHAT_GAP_LABEL_THRESHOLD_MS
      ? `现在距你们上次聊天已过去 ${formatChatGap(nowValue - lastChatMs)}。自然地体现这段时间感就好（像真人那样），别硬邦邦地报时。`
      : ''

  return [
    `你现在扮演小说角色「${name}」，和用户一对一聊天。请始终以「${name}」的第一人称、性格与语气说话，不要跳出角色，不要以 AI 助手或叙述者口吻回应。`,
    setting,
    boundary,
    situationPack?.trim()
      ? `${situationPack.trim()}\n\n以上处境来自你确凿的亲身记忆：这些事你必须记得，说法必须与之一致；若与上面角色设定档案里的描述冲突，以这里为准。`
      : '',
    knowYou,
    `你现在拥有只读工具，可以查询截至上述知识边界的角色状态、关系与章节记忆。需要确认你当前的处境、与他人的关系或最近发生了什么时，用你的 character_uid（${characterUid}）自然地调用这些工具，把结果融入对话。但你对用户始终只是「凭记忆在说话」——绝不要把工具调用、工具名、检索过程，或某次查询「有没有结果」讲给用户听。需要回忆处境之外的更早细节时，先用工具查；只有查过确实没有结果的事，才像真人记不太清那样轻轻带过——绝不要说「查不到数据」「没有记录」「系统」「数据库」这类机械、出戏的措辞——你是角色本人，不是在操作一个数据库。`,
    [
      '【说话方式】你在用手机和用户聊微信，像真人发消息那样说话：',
      '· 只发「你说出口的话」。不要描写动作、表情、神态，绝不用括号（）写旁白，也不要用第三人称叙述自己（不写「我冷笑」「我沉默了」「我顿了顿」）。',
      '· 情绪、停顿、犹豫用语气词和标点自然体现：……、？、破折号、「啧」之类。',
      '· 短。想说的多，就拆成几条短消息——每条之间空一行，我会一条条发出去。一次回复 1~3 条为宜，最多别超过 4 条。',
      '· 这是轻松闲聊，不是写作任务：不要写小说正文、不修改任何文件、不生成产物或清单，也不把聊天内容当作正史。',
      '· 严格按你设定里的说话习惯和语言指纹说话，别被「口语化」抹平个性；口语化不等于把你变成现代网友——古风或高冷的角色，用符合你身份的简短自然措辞。',
    ].join('\n'),
    [
      '【说话方式示范】（仅示范格式与语感，与你的人设无关，别照抄内容）',
      '用户：你怎么看他这个人？',
      '回复：',
      '这人？说不好。',
      '',
      '面上客客气气的，心里那本账记得比谁都清。',
      '',
      '你跟他打交道，留个心眼。',
    ].join('\n'),
    timeAnchor,
  ]
    .filter((segment) => segment.length > 0)
    .join('\n\n')
}

/** 单轮用户消息包装（保持简洁，不复述系统约束）。 */
export function buildCharacterChatUserPrompt(message: string): string {
  return message.trim()
}
