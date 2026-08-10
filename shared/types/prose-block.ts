/** 引擎散文块（agents/*.md 里被 narracat:prose 标记框住的可编辑段落）。 */
export interface ProseBlock {
  id: string
  /** 设置页显示名；缺省回退为 id */
  title: string
  /** 一句话说明「改这里会影响什么」，作者词汇 */
  hint?: string
  /** 块内正文，已 trim */
  body: string
  /** 开标记起始下标（含） */
  start: number
  /** 闭标记结束下标（不含） */
  end: number
}

/** 用户对某个块的覆盖存量（prose-overrides.json 的一条）。 */
export interface ProseOverrideEntry {
  /** 用户改写后的文本；空串合法，语义是「删掉这条官方规则」 */
  text: string
  /** 用户改动当时的官方原文，用于升级后判定「官方是否改过这一块」 */
  baseText: string
  /** 用户改动当时的引擎版本，仅作展示与排障，不参与判定 */
  baseEngineVersion: string
  updatedAt: string
}

export interface ProseOverrideFile {
  version: 1
  overrides: Record<string, ProseOverrideEntry>
}

/**
 * clean            = 官方原文没变，用户版静默生效
 * official-updated = 官方改过这一块，需作者二选一；**冲突期间仍用用户版**
 * missing          = 该 id 已不在当前引擎里（块被删除/改名），自然失效但不静默丢弃
 */
export type ProseBlockStatus = 'clean' | 'official-updated' | 'missing'

export interface ProseBlockView {
  id: string
  title: string
  hint?: string
  /** 当前引擎原文；status === 'missing' 时为空串 */
  officialText: string
  /** 用户覆盖文本；无 override 时为 null */
  userText: string | null
  /** 用户改动当时的官方原文；无 override 时为 null */
  baseText: string | null
  status: ProseBlockStatus
}
