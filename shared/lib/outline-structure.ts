import {
  getDilemmaMilestoneLabel,
  getForeshadowingActionLabel,
  getForeshadowingTypeLabel,
  getHumanOrdinalLabel,
  getPayoffBeatLabel,
  getPayoffIntensityLabel,
  getStorylineStatusLabel,
  getStorylineTypeLabel,
  isMachinePrimaryKey,
} from './schema-field-labels'

/**
 * 大纲数据契约（ADR-0018，schemas/outline-structure.json）→ 人读 markdown，由 App 从 DTO 渲染。
 * 机器枚举经 #243 ID→人话映射成中文徽标；机器主键（SL-* / F* / V01-A01）默认隐藏，
 * 按需替换为人读序号（getHumanOrdinalLabel），不裸露进用户通道。
 *
 * 两个入口：renderOutlineStructureMarkdown 渲书级（outline-structure.json），
 * renderChapterOutlineMarkdown 渲章细纲（vol-VV/ch-NNN.json）。字段全部按存在性渲染，
 * 缺字段安静跳过，不报错（兼容 backfill 的尽力重建与不同版本契约）。
 */

// ── 书级（outline-structure.json） ──────────────────────────────────────────

export interface OutlineStorylineData {
  id?: string
  name?: string
  type?: string
  priority?: number
  entry_chapter?: number
  planned_payoff_chapter?: number
  status?: string
}

export interface OutlineForeshadowingData {
  id?: string
  type?: string
  description?: string
  planted_chapter?: number
  target_reveal?: string
  theme_link?: string
}

export interface OutlineArcData {
  arc_id?: string
  title?: string
  chapter_start?: number
  chapter_end?: number
  core_question?: string
  irreversible_change?: string
  next_arc_seed?: string
  antagonist_agent?: string
  payoff_beats?: string[]
}

export interface OutlineVolumeData {
  volume_no?: number
  title?: string
  dilemma_milestone?: string
  arc_list?: OutlineArcData[]
}

export interface OutlineStructureData {
  central_dramatic_question?: string
  protagonist_core_desire?: string
  protagonist_core_lack?: string
  antagonistic_force?: string
  stakes_progression?: string
  storylines?: OutlineStorylineData[]
  foreshadowing_registry?: OutlineForeshadowingData[]
  volumes?: OutlineVolumeData[]
}

export const ENGINE_FIELDS: Array<[keyof OutlineStructureData, string]> = [
  ['central_dramatic_question', '中心戏剧问题'],
  ['protagonist_core_desire', '主角核心欲望'],
  ['protagonist_core_lack', '主角核心缺失'],
  ['antagonistic_force', '对抗力量'],
  ['stakes_progression', '赌注递增'],
]

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** 伏笔兑现锚点：章号（"55"）或卷级粗锚点（"vol-08"）→ 人读 */
function formatRevealAnchor(target: string): string {
  const trimmed = target.trim()
  const volMatch = /^vol-0*(\d+)$/.exec(trimmed)
  if (volMatch) return `第 ${volMatch[1]} 卷`
  if (/^\d+$/.test(trimmed)) return `第 ${trimmed} 章`
  return trimmed
}

function volumeChapterRange(arcs: OutlineArcData[]): string {
  const starts = arcs.map((arc) => arc.chapter_start).filter((n): n is number => typeof n === 'number')
  const ends = arcs.map((arc) => arc.chapter_end).filter((n): n is number => typeof n === 'number')
  if (starts.length === 0 || ends.length === 0) return ''
  return `第 ${Math.min(...starts)}-${Math.max(...ends)} 章`
}

/** 卷章结构段（卷 → arc；arc_id 隐藏，序号 + 标题 + 章号区间）。无卷时返回空串。Task 3 结构化视图复用。 */
export function renderOutlineVolumesMarkdown(data: OutlineStructureData): string {
  const volumes = [...(data.volumes ?? [])].sort((a, b) => (a.volume_no ?? 0) - (b.volume_no ?? 0))
  if (volumes.length === 0) return ''
  const lines: string[] = ['## 卷章结构', '']
  for (const volume of volumes) {
    const arcs = [...(volume.arc_list ?? [])].sort(
      (a, b) => (a.chapter_start ?? 0) - (b.chapter_start ?? 0),
    )
    const volTitle = nonEmpty(volume.title) ? volume.title.trim() : `第 ${volume.volume_no ?? '?'} 卷`
    const volMeta: string[] = []
    const range = volumeChapterRange(arcs)
    if (range) volMeta.push(range)
    if (nonEmpty(volume.dilemma_milestone)) {
      volMeta.push(`困境里程碑：${getDilemmaMilestoneLabel(volume.dilemma_milestone)}`)
    }
    lines.push(`### ${volTitle}${volMeta.length > 0 ? `（${volMeta.join(' · ')}）` : ''}`, '')
    arcs.forEach((arc, index) => {
      const ordinal = getHumanOrdinalLabel('arc', index + 1)
      const title = nonEmpty(arc.title) ? arc.title.trim() : ordinal
      const arcRange =
        typeof arc.chapter_start === 'number' && typeof arc.chapter_end === 'number'
          ? `（第 ${arc.chapter_start}-${arc.chapter_end} 章）`
          : ''
      lines.push(`- **${ordinal} · ${title}**${arcRange}`)
      if (nonEmpty(arc.core_question)) lines.push(`  - 核心问题：${arc.core_question.trim()}`)
      if (nonEmpty(arc.irreversible_change)) lines.push(`  - 不可逆变化：${arc.irreversible_change.trim()}`)
      if (nonEmpty(arc.next_arc_seed)) lines.push(`  - 下一弧种子：${arc.next_arc_seed.trim()}`)
      if (nonEmpty(arc.antagonist_agent)) lines.push(`  - 施压者：${arc.antagonist_agent.trim()}`)
      const beats = (arc.payoff_beats ?? []).filter(nonEmpty).map((beat) => getPayoffBeatLabel(beat))
      if (beats.length > 0) lines.push(`  - 爽点：${beats.join('、')}`)
    })
    lines.push('')
  }
  return lines.join('\n')
}

export function renderOutlineStructureMarkdown(data: OutlineStructureData): string {
  const lines: string[] = []

  // 故事引擎（5 字段）
  const engine = ENGINE_FIELDS.filter(([key]) => nonEmpty(data[key]))
  if (engine.length > 0) {
    lines.push('## 故事引擎', '')
    for (const [key, label] of engine) {
      lines.push(`- **${label}**：${(data[key] as string).trim()}`)
    }
    lines.push('')
  }

  // 故事线（机器 id 隐藏，序号 + 名称 + 中文类型/状态徽标）
  const storylines = data.storylines ?? []
  if (storylines.length > 0) {
    lines.push('## 故事线', '')
    storylines.forEach((storyline, index) => {
      const ordinal = getHumanOrdinalLabel('storyline', index + 1)
      const name = nonEmpty(storyline.name)
        ? storyline.name.trim()
        : storyline.id && !isMachinePrimaryKey(storyline.id)
          ? storyline.id
          : ordinal
      const meta: string[] = []
      if (nonEmpty(storyline.type)) meta.push(getStorylineTypeLabel(storyline.type))
      if (typeof storyline.priority === 'number') meta.push(`优先级 ${storyline.priority}`)
      if (nonEmpty(storyline.status)) meta.push(getStorylineStatusLabel(storyline.status))
      const metaText = meta.length > 0 ? `（${meta.join(' · ')}）` : ''
      const entry = typeof storyline.entry_chapter === 'number' ? `：第 ${storyline.entry_chapter} 章入场` : ''
      const payoff =
        typeof storyline.planned_payoff_chapter === 'number'
          ? `，计划第 ${storyline.planned_payoff_chapter} 章收线`
          : ''
      lines.push(`- ${ordinal} · ${name}${metaText}${entry}${payoff}`)
    })
    lines.push('')
  }

  // 伏笔注册表（机器 id 隐藏，序号 + 描述 + 量级 + 生命周期）
  const registry = data.foreshadowing_registry ?? []
  if (registry.length > 0) {
    lines.push('## 伏笔注册表', '')
    registry.forEach((item, index) => {
      const ordinal = getHumanOrdinalLabel('foreshadowing', index + 1)
      const desc = nonEmpty(item.description) ? item.description.trim() : ordinal
      const type = nonEmpty(item.type) ? `（${getForeshadowingTypeLabel(item.type)}）` : ''
      const planted = typeof item.planted_chapter === 'number' ? `埋设第 ${item.planted_chapter} 章` : ''
      const reveal = nonEmpty(item.target_reveal) ? `兑现 ${formatRevealAnchor(item.target_reveal)}` : ''
      const lifecycle = [planted, reveal].filter(Boolean).join(' → ')
      const theme = nonEmpty(item.theme_link) ? `；主题：${item.theme_link.trim()}` : ''
      lines.push(`- ${ordinal} · ${desc}${type}${lifecycle ? `：${lifecycle}` : ''}${theme}`)
    })
    lines.push('')
  }

  // 卷章结构（卷 → arc）：抽出的独立渲染函数，Task 3 结构化视图复用
  const volumesSection = renderOutlineVolumesMarkdown(data)
  if (volumesSection) {
    lines.push(volumesSection)
  }

  if (lines.length === 0) return '## 全书大纲\n\n大纲数据契约缺失或为空。'
  return lines.join('\n').trimEnd()
}

// ── 章级（vol-VV/ch-NNN.json） ──────────────────────────────────────────────

export interface OutlineCharacterReferenceData {
  character_uid?: string
  name?: string
}

export interface OutlineSceneData {
  location?: string
  characters?: OutlineCharacterReferenceData[]
  pressure_point?: string
}

export interface OutlineForeshadowingTouchData {
  id?: string
  action?: string
}

export interface OutlineStateChangeData {
  character?: OutlineCharacterReferenceData
  dimension?: string
  operation?: string
  value?: string
  reason?: string
}

export interface ChapterOutlineData {
  chapter?: number
  title?: string
  // 旧格式（scenes 列式）字段——向后兼容存量 ch-NNN.json
  value_shift?: string
  emotional_stakes?: string
  dramatic_focus?: string
  scenes?: OutlineSceneData[]
  ending_note?: string
  // 新格式（beat 骨架）字段——positioning + beats 骨架式
  positioning?: string
  beats?: string[]
  must_deliver?: string[]
  characters?: OutlineCharacterReferenceData[]
  // 两格式共用字段
  payoff_beat?: string
  payoff_intensity?: string
  storyline_focus?: string[]
  pov_character?: OutlineCharacterReferenceData
  foreshadowing_touch?: OutlineForeshadowingTouchData[]
  /** 本章状态变更（A4×D2 片3a，写作闭环引擎侧产出）：角色/维度/操作/值/缘由。新旧格式共用。 */
  state_changes?: OutlineStateChangeData[]
  /**
   * 派生展示字段（非契约本体）：storyline_focus 的故事线 id→名称映射，App 从书级
   * outline-structure.json 解析后附加，供章纲把机器 id 渲染成人读故事线名（#243）。
   */
  storylineNames?: Record<string, string>
  /**
   * 派生展示字段（非契约本体）：foreshadowing_touch 的伏笔 id→描述映射，App 从书级
   * outline-structure.json 的 foreshadowing_registry 解析后附加，供章纲把「揭示」渲染成
   * 「揭示：玉佩」（可读性），复用状态页伏笔卡片同源数据。缺映射时安静回退为纯动作。
   */
  foreshadowingDescriptions?: Record<string, string>
  /**
   * 派生展示字段（非契约本体）：state_changes 的维度 key→显示名映射，App 从
   * bible/state-vocabulary.json 解析后附加（character-state.ts readStateDimensionDisplayNames），
   * 供章纲把 state_changes 的维度 key 渲染成人读显示名。缺映射时安静回退为原 key。
   */
  stateDimensionNames?: Record<string, string>
}

/** 章纲是否为新 beat 骨架格式（有 beats 数组即新格式）。App 据此在渲染与视图路由上分支。 */
export function isNewFormatChapterOutline(data: ChapterOutlineData): boolean {
  return Array.isArray(data.beats)
}

/**
 * 聚焦故事线人读文本：优先书级 id→名称，缺名称映射时机器主键降级为人读序号，
 * 机器 id 不裸露进用户通道（#243）。新旧格式共用。
 */
function resolveStorylineFocusText(data: ChapterOutlineData): string | undefined {
  const focusIds = (data.storyline_focus ?? []).filter(nonEmpty)
  if (focusIds.length === 0) return undefined
  return focusIds
    .map((id, index) => {
      const name = data.storylineNames?.[id]
      if (nonEmpty(name)) return name.trim()
      return isMachinePrimaryKey(id) ? getHumanOrdinalLabel('storyline', index + 1) : id
    })
    .join('、')
}

/**
 * 「本章爽点」字段文案：类型（中文）+ 可选强度（如「打脸 · 强度：中」）。
 * intensity 只在 payoff_beat 存在时才可能有值，两字段天然同进同出，不产生「有强度无类型」的悬空态。
 * 新旧格式共用。
 */
function formatPayoffBeatText(data: ChapterOutlineData): string | undefined {
  if (!nonEmpty(data.payoff_beat)) return undefined
  const beatLabel = getPayoffBeatLabel(data.payoff_beat.trim())
  const intensityLabel = nonEmpty(data.payoff_intensity)
    ? getPayoffIntensityLabel(data.payoff_intensity.trim())
    : undefined
  return intensityLabel ? `${beatLabel} · 强度：${intensityLabel}` : beatLabel
}

/**
 * 「## 伏笔动作」区块行：有书级描述时渲染「动作：描述」，缺描述回退纯动作；
 * 机器 id 从不裸露（#243）。新旧格式共用。无伏笔动作时返回空数组。
 */
function foreshadowingActionLines(data: ChapterOutlineData): string[] {
  const touches = (data.foreshadowing_touch ?? []).filter((touch) => nonEmpty(touch.action))
  if (touches.length === 0) return []
  const lines: string[] = ['## 伏笔动作', '']
  for (const touch of touches) {
    const actionLabel = getForeshadowingActionLabel(touch.action as string)
    const desc = nonEmpty(touch.id) ? data.foreshadowingDescriptions?.[touch.id] : undefined
    lines.push(nonEmpty(desc) ? `- ${actionLabel}：${desc.trim()}` : `- ${actionLabel}`)
  }
  lines.push('')
  return lines
}

/** 「## 本章状态变更」区块（新旧格式共用）：语义与引擎渲染同构（角色/操作/值/缘由），风格走 App 用户向。 */
function stateChangeLines(data: ChapterOutlineData): string[] {
  const list = (data.state_changes ?? []).filter((sc) => nonEmpty(sc.value))
  if (list.length === 0) return []
  const lines: string[] = ['## 本章状态变更', '']
  for (const sc of list) {
    const opLabel = sc.operation === 'remove' ? '失去' : sc.operation === 'add' ? '获得' : '变为'
    const dimLabel = (nonEmpty(sc.dimension) && data.stateDimensionNames?.[sc.dimension.trim()]) || sc.dimension?.trim() || ''
    const name = sc.character?.name?.trim() ?? ''
    const reason = nonEmpty(sc.reason) ? `（${sc.reason.trim()}）` : ''
    lines.push(`- ${name}：${dimLabel} ${opLabel}「${(sc.value as string).trim()}」${reason}`)
  }
  lines.push('')
  return lines
}

export function renderChapterOutlineMarkdown(data: ChapterOutlineData): string {
  // 新格式（beat 骨架）走独立渲染，向后兼容存量旧格式 ch-NNN.json
  if (isNewFormatChapterOutline(data)) return renderBeatSkeleton(data)

  const chapterLabel = typeof data.chapter === 'number' ? `第 ${data.chapter} 章` : '章节'
  const heading = nonEmpty(data.title) ? `# ${chapterLabel}：${data.title.trim()}` : `# ${chapterLabel}细纲`
  const lines: string[] = [heading, '']

  // 聚焦故事线（schema 必填）：优先用书级解析的 id→名称展示；缺名称映射时按机器主键
  // 隐藏为人读序号，机器 id 不裸露进用户通道（#243）
  const focusText = resolveStorylineFocusText(data)

  // 章核字段
  const payoffBeatText = formatPayoffBeatText(data)
  const core: Array<[string, string | undefined]> = [
    ['价值转换', data.value_shift],
    ['情感赌注', data.emotional_stakes],
    ['戏剧焦点', data.dramatic_focus],
    ['本章爽点', payoffBeatText],
    ['聚焦故事线', focusText],
    ['视角人物', data.pov_character?.name],
    ['章末收尾', data.ending_note],
  ]
  const coreLines = core.filter(([, value]) => nonEmpty(value))
  if (coreLines.length > 0) {
    for (const [label, value] of coreLines) {
      lines.push(`- **${label}**：${(value as string).trim()}`)
    }
    lines.push('')
  }

  // 场景分区块
  const scenes = data.scenes ?? []
  if (scenes.length > 0) {
    lines.push('## 场景', '')
    scenes.forEach((scene, index) => {
      const location = nonEmpty(scene.location) ? ` · ${scene.location.trim()}` : ''
      lines.push(`### 场景 ${index + 1}${location}`, '')
      const names = (scene.characters ?? [])
        .map((character) => character.name?.trim())
        .filter((name): name is string => Boolean(name))
      if (names.length > 0) lines.push(`- 出场角色：${names.join('、')}`)
      if (nonEmpty(scene.pressure_point)) lines.push(`- 压力点：${scene.pressure_point.trim()}`)
      lines.push('')
    })
  }

  // 伏笔动作：有书级描述则「动作：描述」，缺描述回退纯动作；机器 id 不裸露（#243）
  lines.push(...foreshadowingActionLines(data))

  // 本章状态变更（A4×D2 片3a）：紧随伏笔动作，对齐引擎渲染节顺序
  lines.push(...stateChangeLines(data))

  return lines.join('\n').trimEnd()
}

/**
 * 新格式（beat 骨架）章纲渲染：本章定位 + 场景骨架编号 + 必须落地 + 章核字段 + 伏笔动作。
 * 与引擎渲染器结构同构，但沿用 App 用户向风格（#243 隐藏机器 id、爽点显中文、粗体标签），
 * 与旧格式章纲展示一致——写手 AI 看到的引擎渲染另走引擎侧、不受此影响。字段按存在性渲染。
 */
function renderBeatSkeleton(data: ChapterOutlineData): string {
  const chapterLabel = typeof data.chapter === 'number' ? `第 ${data.chapter} 章` : '章节'
  const heading = nonEmpty(data.title) ? `# ${chapterLabel}：${data.title.trim()}` : `# ${chapterLabel}细纲`
  const lines: string[] = [heading, '']

  if (nonEmpty(data.positioning)) {
    lines.push('## 本章定位', '', data.positioning.trim(), '')
  }

  const beats = (data.beats ?? []).filter(nonEmpty)
  if (beats.length > 0) {
    lines.push('## 场景骨架', '')
    beats.forEach((beat, index) => lines.push(`${index + 1}. ${beat.trim()}`))
    lines.push('')
  }

  const mustDeliver = (data.must_deliver ?? []).filter(nonEmpty)
  if (mustDeliver.length > 0) {
    lines.push('## 必须落地', '')
    for (const item of mustDeliver) lines.push(`- ${item.trim()}`)
    lines.push('')
  }

  // 章核字段（用户向：爽点显中文、故事线人读、隐藏机器 id）
  const payoffBeatText = formatPayoffBeatText(data)
  const characterNames = (data.characters ?? [])
    .map((character) => character.name?.trim())
    .filter((name): name is string => Boolean(name))
  const core: Array<[string, string | undefined]> = [
    ['本章爽点', payoffBeatText],
    ['聚焦故事线', resolveStorylineFocusText(data)],
    ['视角人物', data.pov_character?.name],
    ['出场角色', characterNames.length > 0 ? characterNames.join('、') : undefined],
  ]
  const coreLines = core.filter(([, value]) => nonEmpty(value))
  if (coreLines.length > 0) {
    for (const [label, value] of coreLines) {
      lines.push(`- **${label}**：${(value as string).trim()}`)
    }
    lines.push('')
  }

  lines.push(...foreshadowingActionLines(data))

  // 本章状态变更（A4×D2 片3a）：紧随伏笔动作，对齐引擎渲染节顺序
  lines.push(...stateChangeLines(data))

  return lines.join('\n').trimEnd()
}
