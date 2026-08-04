import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type {
  CharacterFactSource,
  CharacterIdentitySummary,
  CharacterRelationshipEntry,
  CharacterStateCardEntry,
  CharacterStateDimensionInfo,
  CharacterStateSnapshot,
  CharacterStateValue,
  CharacterTimelineEvent,
  CharacterTimelineGroup,
} from '@shared/types/character-state'
import { characterPredicateLabel } from '@shared/lib/character-predicate-labels'
import type { MemoryDbReader, OpenMemoryDb } from './memory-db'
import { charactersDir, narracatMemoryDbPath, stateVocabularyPath } from './novel-layout'

/**
 * 角色结构化状态只读聚合（A4×D2 片1，spec §6.2 之①②区）。
 *
 * 口径纪律（#242 边界铁律，见 engine/novel-memory-mcp-client.ts 头注）：
 * - 「当前值」只信引擎物化的 character_cards.card_json，App 不复刻折叠语义；
 * - 时间线是 facts 原始行的**展示层**维度分组，归属规则照 spec §3.2 机械规则
 *   （引擎 SSOT：agent-core/narracat/mcp-server/src/handlers/state-dimensions.ts attributeFact），
 *   规则若在引擎侧演进，此处展示分组须同步；
 * - 全链吞错降级（available=false / 空快照），绝不抛给渲染进程。
 */

export interface ReadCharacterStateInput {
  projectPath: string
  characterUid: string
  characterName: string
  openMemoryDb: OpenMemoryDb
}

export interface StateDimensionDef {
  key: string
  predicate: string
  display_name: string
  cardinality: 'one' | 'many'
  value_type: 'enum' | 'free'
  values?: string[]
}

interface FactRow {
  id: string
  predicate: string
  object: string
  from_chapter: number
  event_chapter: number | null
  invalidated_at_chapter: number | null
  invalidated_by: string | null
  source: string
  /** secret_known 列（老库可能无此列时 undefined，见 factsHasSecretKnown） */
  secret_known?: number | null
}

interface RelationshipRow extends FactRow {
  subject: string
}

interface CardRow {
  as_of_chapter: number
  card_json: string
}

/** 关系区展示上限（状态卡 UI 只露最近若干条，全量走时间线/引擎） */
const RELATIONSHIP_DISPLAY_LIMIT = 12

const UNAVAILABLE_SNAPSHOT: CharacterStateSnapshot = {
  available: false,
  hasVocabulary: false,
  asOfChapter: null,
  latestCompletedChapter: 0,
  identity: null,
  dimensions: [],
  card: [],
  relationships: [],
  timeline: [],
}

function normalizeSource(raw: string): CharacterFactSource {
  // 拿不准一律按 extracted（待确认）兜底——诚实方向（spec §9）
  return raw === 'authored' ? 'authored' : 'extracted'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function normalizeDimension(value: unknown): StateDimensionDef | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.key !== 'string' || typeof raw.predicate !== 'string' || typeof raw.display_name !== 'string') return null
  if (raw.cardinality !== 'one' && raw.cardinality !== 'many') return null
  if (raw.value_type !== 'enum' && raw.value_type !== 'free') return null
  const values = isStringArray(raw.values) ? raw.values : undefined
  if (raw.value_type === 'enum' && !values) return null
  return {
    key: raw.key,
    predicate: raw.predicate,
    display_name: raw.display_name,
    cardinality: raw.cardinality,
    value_type: raw.value_type,
    values,
  }
}

/**
 * 读词表完整维度定义（key/predicate/display_name/cardinality/value_type/values）——
 * 供状态卡渲染、编辑控件契约与其它只读聚合模块（planned-state-read.ts）复用；
 * 词表缺失/无效/空维度数组一律返回 null（调用方各自决定降级展示）。
 */
export async function readStateVocabulary(projectPath: string): Promise<StateDimensionDef[] | null> {
  try {
    const raw = await readFile(join(projectPath, stateVocabularyPath()), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const dimensions = (parsed as Record<string, unknown>).dimensions
    if (!Array.isArray(dimensions)) return null
    const normalized = dimensions.map(normalizeDimension).filter((dim): dim is StateDimensionDef => dim !== null)
    return normalized.length > 0 ? normalized : null
  } catch {
    return null
  }
}

/** 维度 key→显示名（词表缺失/无效返回空对象），供章纲 md 渲染与卡片展示。 */
export async function readStateDimensionDisplayNames(projectPath: string): Promise<Record<string, string>> {
  const dims = await readStateVocabulary(projectPath)
  if (!dims) return {}
  return Object.fromEntries(dims.map((dim) => [dim.key, dim.display_name]))
}

/**
 * characterName 来自渲染进程，拼路径前必须校验——对齐引擎 entity schema 的 name pattern
 * （`^[^./\\][^/\\]*$`）与 novel-artifacts.ts 的 safeFileStem 先例：禁路径分隔符/禁以 `.` 开头/
 * basename 后必须原样一致，否则可拼出 `../../..` 逃出 bible/characters 读到项目外任意 json。
 */
export function isSafeCharacterName(name: string): boolean {
  if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\')) return false
  return basename(name) === name
}

async function readIdentitySummary(
  projectPath: string,
  characterName: string,
  characterUid: string,
): Promise<CharacterIdentitySummary | null> {
  if (!isSafeCharacterName(characterName)) return null
  try {
    const raw = await readFile(join(projectPath, charactersDir(), `${characterName}.json`), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const entity = parsed as Record<string, unknown>
    // 出生证 uid 与档案 uid 不一致时宁可不显示（fail-safe，不显示错人的身份）
    if (typeof entity.character_uid === 'string' && entity.character_uid !== characterUid) return null
    const gender = typeof entity.gender === 'string' && entity.gender.length > 0 ? entity.gender : null
    const age = typeof entity.age === 'string' && entity.age.length > 0 ? entity.age : null
    const aliases = isStringArray(entity.aliases) ? entity.aliases : []
    // 实体 json 存在且 uid 匹配即返回（字段可全空）：identity 非空 = 出生证编辑入口可开
    return { gender, age, aliases }
  } catch {
    return null
  }
}

/** 词表维度定义→渲染端编辑控件契约（predicate 不外泄：编辑一律走维度 key，谓词归引擎） */
function toDimensionInfo(dim: StateDimensionDef): CharacterStateDimensionInfo {
  return {
    key: dim.key,
    displayName: dim.display_name,
    cardinality: dim.cardinality,
    valueType: dim.value_type,
    values: dim.values ?? [],
  }
}

/** 从 meta 表解析 novel_id（memory.db 只读聚合的通用第一步，供其它只读聚合模块复用）。 */
export function readNovelId(reader: MemoryDbReader): string | null {
  try {
    const rows = reader.all<{ value: string }>("SELECT value FROM meta WHERE key = 'novel_id' LIMIT 1")
    return rows[0]?.value ?? null
  } catch {
    return null
  }
}

/**
 * facts 是否已有 secret_known 列（引擎 4.0.117 v19 迁移新增）——存量书可能从未被新引擎打开过，
 * App 只读打开老库时该列不存在，直接 SELECT 会抛 no such column；先探列，缺列则查询不带该列
 * （secret 事实按未知晓兜底，见 secretKnownOf）。Task 5 处境包组装复用本函数对齐口径。
 */
export function factsHasSecretKnown(reader: MemoryDbReader): boolean {
  try {
    return reader.all<{ name: string }>('PRAGMA table_info(facts)').some((column) => column.name === 'secret_known')
  } catch {
    return false
  }
}

/**
 * facts 是否已有 source 列（引擎 v17 迁移新增）——真机 dogfood 副本验证发现：更老的存量书
 * （从未被 v17+ 引擎打开过）缺此列，直接 SELECT/ORDER BY source 会抛 no such column，被外层
 * try/catch 整体吞掉，连带 factRows/relationshipRows/cardRow 一起变空（片4 收尾复测中发现）。
 * 同 factsHasSecretKnown 先例：先探列，缺列时下游按 'extracted' 兜底（normalizeSource 语义一致）。
 */
export function factsHasSource(reader: MemoryDbReader): boolean {
  try {
    return reader.all<{ name: string }>('PRAGMA table_info(facts)').some((column) => column.name === 'source')
  } catch {
    return false
  }
}

/**
 * secret 谓词事实的「本人已知晓」换算：非 secret 谓词恒 null（UI 不显示开关）；
 * secret 谓词缺列/缺值一律按未知晓（false）兜底——宁可漏不可剧透。
 */
function secretKnownOf(row: Pick<FactRow, 'predicate' | 'secret_known'>): boolean | null {
  return row.predicate === 'secret' ? (row.secret_known ?? 0) === 1 : null
}

/**
 * spec §3.2 机械归属：同谓词 → enum 维度按 object∈values 认领 → free 维度按声明顺序兜底 → null 落「其他」区。
 * 导出供 Task 5 处境包组装「亲历区」归属复用。
 */
export function attributeFactToDimension(
  dimensions: StateDimensionDef[],
  predicate: string,
  object: string,
): StateDimensionDef | null {
  const samePredicate = dimensions.filter((dim) => dim.predicate === predicate)
  for (const dim of samePredicate) {
    if (dim.value_type === 'enum' && (dim.values ?? []).includes(object)) return dim
  }
  return samePredicate.find((dim) => dim.value_type === 'free') ?? null
}

function eventChapterOf(row: FactRow): number {
  return row.event_chapter ?? row.from_chapter
}

/**
 * 从未生效判定（spec §3.3，与引擎 fact-temporal.ts 对齐）：
 * invalidated_at_chapter 非空且 <= 自身生效章（event_chapter ?? from_chapter）＝该行在其生效前
 * 就被作者 correct/retract 打掉，从未成为正史，非自然演变；invalidated_by 非空＝有取代者（已修正），
 * 为空＝单纯作废。自然演变（invalidated_at_chapter > 自身生效章）不算从未生效。
 */
function revokedOf(row: FactRow): 'corrected' | 'retracted' | null {
  if (row.invalidated_at_chapter === null) return null
  if (row.invalidated_at_chapter > eventChapterOf(row)) return null
  return row.invalidated_by ? 'corrected' : 'retracted'
}

function buildTimelineGroups(rows: FactRow[], dimensions: StateDimensionDef[] | null): CharacterTimelineGroup[] {
  const groups = new Map<string, CharacterTimelineGroup>()
  for (const row of rows) {
    const dim = dimensions ? attributeFactToDimension(dimensions, row.predicate, row.object) : null
    const key = dim?.key ?? row.predicate
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        // 非词表分组回退：受控谓词译中文（真机走查回报：裸英文作者看不懂）
        displayName: dim?.display_name ?? characterPredicateLabel(row.predicate),
        cardinality: dim?.cardinality ?? 'many',
        events: [],
      }
      groups.set(key, group)
    }
    const event: CharacterTimelineEvent = {
      factId: row.id,
      value: row.object,
      chapter: eventChapterOf(row),
      source: normalizeSource(row.source),
      invalidated: row.invalidated_at_chapter !== null,
      invalidatedAtChapter: row.invalidated_at_chapter,
      revoked: revokedOf(row),
      secretKnown: secretKnownOf(row),
    }
    group.events.push(event)
  }
  // 词表声明序在前，「其他」区谓词按首见序殿后
  const vocabOrder = new Map((dimensions ?? []).map((dim, index) => [dim.key, index]))
  return [...groups.values()].sort((a, b) => {
    const ai = vocabOrder.get(a.key) ?? Number.MAX_SAFE_INTEGER
    const bi = vocabOrder.get(b.key) ?? Number.MAX_SAFE_INTEGER
    return ai - bi
  })
}

/**
 * 状态卡值的来源/章号：在同维度时间线里反查有效事实——authored 优先（§3.3 折叠语义：
 * 同章 authored 压过 extracted，卡面值应报作者钦定而非「待确认」），找不到再退化到任意
 * 同值有效事件；查不到按待确认兜底。
 *
 * asOfChapter 截断（PR#458 P1）：时间线故意含未来事实（供编辑预览），若不按卡的
 * as_of_chapter 截断，同 key+同值的未来行会被误配到当前卡值——若未来行恰好是已打标
 * secret 而当前值本应待确认，就会把未打标 secret 误判成「本人已知晓」放行进处境包
 * （泄密），factId 也会绑错行（编辑指向错误记录）。两个反查循环都只认在 as_of 时点
 * 有效的事件：event.chapter <= asOfChapter 且未在 as_of 之前被后续行顶替失效
 * （镜像引擎折叠有效性口径，见 fact-temporal.ts）。
 *
 * predicate 用于反查落空时的 secretKnown fail-closed 判定（外审 P1-2）：反查不到事实＝
 * 该值知晓状态不明，secret 谓词宁可漏不可剧透，一律按未知晓（false）而非 null 兜底；
 * 其余谓词维持 null（UI 不显示开关）。
 */
function resolveCardValue(
  timeline: CharacterTimelineGroup[],
  key: string,
  value: string,
  predicate: string,
  asOfChapter: number,
): CharacterStateValue {
  const group = timeline.find((item) => item.key === key)
  if (group) {
    const validAtAsOf = (event: CharacterTimelineEvent) =>
      event.chapter <= asOfChapter && (event.invalidatedAtChapter === null || event.invalidatedAtChapter > asOfChapter)
    for (let index = group.events.length - 1; index >= 0; index -= 1) {
      const event = group.events[index]
      if (validAtAsOf(event) && event.value === value && event.source === 'authored') {
        return { value, source: event.source, chapter: event.chapter, factId: event.factId, secretKnown: event.secretKnown }
      }
    }
    for (let index = group.events.length - 1; index >= 0; index -= 1) {
      const event = group.events[index]
      if (validAtAsOf(event) && event.value === value) {
        return { value, source: event.source, chapter: event.chapter, factId: event.factId, secretKnown: event.secretKnown }
      }
    }
  }
  return { value, source: 'extracted', chapter: null, factId: null, secretKnown: predicate === 'secret' ? false : null }
}

function buildCardEntries(
  cardJson: string | null,
  dimensions: StateDimensionDef[] | null,
  timeline: CharacterTimelineGroup[],
  asOfChapter: number,
): CharacterStateCardEntry[] {
  if (!cardJson) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(cardJson)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const card = parsed as Record<string, unknown>

  const entries: CharacterStateCardEntry[] = []

  if (card._v === 2) {
    const dimensionSlots =
      card.dimensions && typeof card.dimensions === 'object' ? (card.dimensions as Record<string, unknown>) : {}
    const extras = card.extras && typeof card.extras === 'object' ? (card.extras as Record<string, unknown>) : {}

    const vocabOrder = new Map((dimensions ?? []).map((dim, index) => [dim.key, index]))
    // 维度谓词推导（fail-closed 判定用，见 resolveCardValue）——「卡自带优先」：slot 自带的
    // predicate 字段是引擎折叠时从命中维度写入的 SSOT（character-card-fold.ts），词表在卡片
    // 物化后被编辑（同 key 改绑谓词）也不会让判定漂移；旧 v2 历史卡（无 predicate 字段）
    // 退回词表定义，再退回 key 本身
    const dimensionPredicate = new Map((dimensions ?? []).map((dim) => [dim.key, dim.predicate]))
    const slotKeys = Object.keys(dimensionSlots).sort((a, b) => {
      const ai = vocabOrder.get(a) ?? Number.MAX_SAFE_INTEGER
      const bi = vocabOrder.get(b) ?? Number.MAX_SAFE_INTEGER
      return ai - bi
    })
    for (const key of slotKeys) {
      const slot = dimensionSlots[key]
      if (!slot || typeof slot !== 'object') continue
      const raw = slot as Record<string, unknown>
      const displayName = typeof raw.display_name === 'string' ? raw.display_name : key
      const predicate = (typeof raw.predicate === 'string' ? raw.predicate : undefined) ?? dimensionPredicate.get(key) ?? key
      if (typeof raw.value === 'string') {
        entries.push({ key, displayName, cardinality: 'one', values: [resolveCardValue(timeline, key, raw.value, predicate, asOfChapter)] })
      } else if (isStringArray(raw.values) && raw.values.length > 0) {
        entries.push({
          key,
          displayName,
          cardinality: 'many',
          values: raw.values.map((value) => resolveCardValue(timeline, key, value, predicate, asOfChapter)),
        })
      }
    }
    for (const [predicate, values] of Object.entries(extras)) {
      if (!isStringArray(values) || values.length === 0) continue
      entries.push({
        key: predicate,
        displayName: characterPredicateLabel(predicate),
        cardinality: 'many',
        values: values.map((value) => resolveCardValue(timeline, predicate, value, predicate, asOfChapter)),
      })
    }
    return entries
  }

  // v1 扁平卡（无词表存量口径）：每谓词一值降级展示（拍板保留 v1 降级结构），展示名走受控谓词中文映射
  for (const [predicate, value] of Object.entries(card)) {
    if (typeof value !== 'string') continue
    entries.push({
      key: predicate,
      displayName: characterPredicateLabel(predicate),
      cardinality: 'many',
      values: [resolveCardValue(timeline, predicate, value, predicate, asOfChapter)],
    })
  }
  return entries
}

function buildRelationshipEntries(rows: RelationshipRow[], characterName: string): CharacterRelationshipEntry[] {
  return rows.map((row) => {
    const parts = row.subject.split('|')
    const otherName = parts.length === 2 ? (parts.find((part) => part !== characterName) ?? row.subject) : row.subject
    return {
      otherName,
      state: row.object,
      chapter: eventChapterOf(row),
      source: normalizeSource(row.source),
    }
  })
}

export async function readCharacterStateSnapshot(input: ReadCharacterStateInput): Promise<CharacterStateSnapshot> {
  const { projectPath, characterUid, characterName, openMemoryDb } = input

  const [dimensions, identity] = await Promise.all([
    readStateVocabulary(projectPath),
    readIdentitySummary(projectPath, characterName, characterUid),
  ])

  let reader: MemoryDbReader
  try {
    reader = openMemoryDb(join(projectPath, narracatMemoryDbPath()))
  } catch {
    return UNAVAILABLE_SNAPSHOT
  }

  try {
    // 有 novel_id 则按 novel_id 过滤，缺失时全表读（单库单小说，兼容；同款先例见
    // appeared-characters.ts / candidate-characters.ts / novel-status-memory.ts）——
    // 生产库的 meta 表实际从未写入过 novel_id（引擎侧无写入口），此前硬 bail 会让本函数
    // 在所有真机数据上恒返回 UNAVAILABLE_SNAPSHOT（dogfood 只读副本验证发现，片4 收尾）。
    const novelId = readNovelId(reader)

    let factRows: FactRow[] = []
    let relationshipRows: RelationshipRow[] = []
    let cardRow: CardRow | null = null
    let latestCompletedChapter = 0
    try {
      // 最新完成章独立于角色卡读取（生效章默认值口径）：书已写多章而该角色尚无 card/facts 时，
      // 钦定默认生效章不得回落 0——否则会把当下钦定静默写成全书初始设定
      const latestRows = novelId
        ? reader.all<{ c: number | null }>(
            'SELECT MAX(chapter) AS c FROM chapter_summaries WHERE novel_id = ?',
            novelId,
          )
        : reader.all<{ c: number | null }>('SELECT MAX(chapter) AS c FROM chapter_summaries')
      latestCompletedChapter = latestRows[0]?.c ?? 0
      // 章内折叠 tiebreak 对齐 spec §3.3（同 event 章 authored 压 extracted，展示为「该章最终生效值」）：
      // 事件章 ASC → authored 排最后 → created_at ASC → rowid ASC。引擎侧同款语义在
      // fact-temporal.ts 的 FACT_LATEST_ORDER_SQL（4.0.110，最新优先=本序取反），两处须保持镜像。
      // secret_known / source 列按探列结果决定是否带上（老库未跑引擎对应迁移时缺列，见
      // factsHasSecretKnown / factsHasSource）；source 缺列时用字面量 'extracted' 别名兜底，
      // 下游 normalizeSource 语义不变，ORDER BY 的 authored-tiebreak 缺列时退化为无操作（老库
      // 也没有 authored 行需要压后）。
      const hasSource = factsHasSource(reader)
      const sourceSelectExpr = hasSource ? 'source' : `'extracted' AS source`
      // 缺列兜底须避免裸整数字面量——SQLite 的 ORDER BY 把裸整数解释为「按第 N 列排序」的序号
      // 引用而非常量值，会抛"ORDER BY term out of range"；CAST 包一层使其成为表达式。
      const sourceOrderExpr = hasSource ? `CASE WHEN source = 'authored' THEN 1 ELSE 0 END` : 'CAST(0 AS INTEGER)'
      const factColumns = `id, predicate, object, from_chapter, event_chapter, invalidated_at_chapter, invalidated_by, ${sourceSelectExpr}${
        factsHasSecretKnown(reader) ? ', secret_known' : ''
      }`
      factRows = novelId
        ? reader.all<FactRow>(
            `SELECT ${factColumns}
             FROM facts
             WHERE novel_id = ? AND subject_character_uid = ? AND subject_character_b_uid IS NULL
             ORDER BY COALESCE(event_chapter, from_chapter) ASC,
                      ${sourceOrderExpr} ASC,
                      created_at ASC, rowid ASC`,
            novelId,
            characterUid,
          )
        : reader.all<FactRow>(
            `SELECT ${factColumns}
             FROM facts
             WHERE subject_character_uid = ? AND subject_character_b_uid IS NULL
             ORDER BY COALESCE(event_chapter, from_chapter) ASC,
                      ${sourceOrderExpr} ASC,
                      created_at ASC, rowid ASC`,
            characterUid,
          )
      relationshipRows = novelId
        ? reader.all<RelationshipRow>(
            `SELECT subject, predicate, object, from_chapter, event_chapter, invalidated_at_chapter, ${sourceSelectExpr}
             FROM facts
             WHERE novel_id = ? AND predicate = 'relationship'
               AND (subject_character_uid = ? OR subject_character_b_uid = ?)
               AND invalidated_at_chapter IS NULL
             ORDER BY COALESCE(event_chapter, from_chapter) DESC, created_at DESC
             LIMIT ${RELATIONSHIP_DISPLAY_LIMIT}`,
            novelId,
            characterUid,
            characterUid,
          )
        : reader.all<RelationshipRow>(
            `SELECT subject, predicate, object, from_chapter, event_chapter, invalidated_at_chapter, ${sourceSelectExpr}
             FROM facts
             WHERE predicate = 'relationship'
               AND (subject_character_uid = ? OR subject_character_b_uid = ?)
               AND invalidated_at_chapter IS NULL
             ORDER BY COALESCE(event_chapter, from_chapter) DESC, created_at DESC
             LIMIT ${RELATIONSHIP_DISPLAY_LIMIT}`,
            characterUid,
            characterUid,
          )
      const cardRows = novelId
        ? reader.all<CardRow>(
            'SELECT as_of_chapter, card_json FROM character_cards WHERE novel_id = ? AND character_uid = ? LIMIT 1',
            novelId,
            characterUid,
          )
        : reader.all<CardRow>(
            'SELECT as_of_chapter, card_json FROM character_cards WHERE character_uid = ? LIMIT 1',
            characterUid,
          )
      cardRow = cardRows[0] ?? null
    } catch {
      // 表缺失（旧库/半初始化）→ 按无数据处理，不阻断页面
    }

    const timeline = buildTimelineGroups(factRows, dimensions)
    return {
      available: true,
      hasVocabulary: dimensions !== null,
      asOfChapter: cardRow?.as_of_chapter ?? null,
      latestCompletedChapter,
      identity,
      dimensions: (dimensions ?? []).map(toDimensionInfo),
      card: buildCardEntries(cardRow?.card_json ?? null, dimensions, timeline, cardRow?.as_of_chapter ?? 0),
      relationships: buildRelationshipEntries(relationshipRows, characterName),
      timeline,
    }
  } finally {
    try {
      reader.close()
    } catch {
      // 关闭失败不影响返回
    }
  }
}
