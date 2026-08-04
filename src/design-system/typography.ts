// Typography role contract — 见 docs/design.md §3.2.1
// 把产品里反复出现的语义位置（空态、metadata、Agent 对话/提问）钉到稳定的字号角色，
// 供 Workbench / Agent / Library / Settings 复用，避免在页面里凭感觉散写 text-xs / text-sm。

// 正文阅读字号 SSOT：章节正文（manuscript / document markdown）的字号。设定集正文（核心前提 /
// 叙事声音）与角色聊天消息统一注入它，避免客户端各处正文字号不一（dogfood 反馈）。仅约束字号，
// 行高 / 颜色由各处按场景叠加。
export const READING_BODY_FONT_CLASS = 'text-base'

// Workbench 主内容区生命周期空态：内容缺失态用 primary，loading / 次级密集态用 compact。
export const EMPTY_PRIMARY_TITLE_CLASS = 'text-lg font-semibold text-foreground'

export const EMPTY_PRIMARY_BODY_CLASS = 'text-sm leading-6 text-muted-foreground'

export const EMPTY_COMPACT_TITLE_CLASS = 'text-sm font-medium text-foreground'

export const EMPTY_COMPACT_BODY_CLASS = 'text-xs leading-snug text-muted-foreground'

// 辅助元数据：badge、时间戳、状态栏、eyebrow。
export const METADATA_TEXT_CLASS = 'text-xs text-muted-foreground'

// Agent workspace：对话正文与 AskUserQuestion 提问卡片。
export const AGENT_BODY_CLASS = 'text-[15px] leading-7 text-foreground'

export const AGENT_QUESTION_TITLE_CLASS = 'text-sm font-semibold text-foreground'

export const AGENT_QUESTION_OPTION_CLASS = 'text-sm leading-6 text-foreground'

export const AGENT_QUESTION_INPUT_CLASS = 'text-sm leading-6 text-foreground'
