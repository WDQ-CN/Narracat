import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { charactersDir, narracatMemoryDbPath } from './novel-layout'
import type { MemoryDbReader, OpenMemoryDb } from './memory-db'
import type { CharacterBasicInfoField, CharacterContact, CharacterContactList } from '@shared/types/character-chat'

/**
 * Appeared character reader（ADR-0012）。
 *
 * 已出场判定不扫描章节正文：只读 chapter_summaries.characters（CharacterReference[] JSON
 * 结构化列）聚合 first/last seen，并以 bible/characters/ 角色档案的 character_identity
 * 注释确认「已建档设定」并补 settingPath。renderer 经 IPC 消费结果，绝不在渲染端扫文件。
 *
 * 收敛规则：
 * - 纳入「档案含 character_identity 且 uid 匹配」且满足以下任一出场证据的角色：
 *   (a) 至少一个已入库章的 chapter_summaries 出现该 uid；或
 *   (b) 该 uid 是已转正候选（candidate_characters.status=promoted）且其出场章已写完
 *       （proposed_chapter ≤ 知识边界）——补救抽取对配角漏登记 chapter_summaries 的盲区：
 *       已正式建档的已出场配角，不必死等抽取登记就能进唠嗑。
 * - 排除只存在于未来大纲 / 未完成草稿（既无 chapter_summaries 证据、又无已写完的 promoted 候选）的角色。
 * - 知识边界 = chapter_summaries 中最大章号（最新 Chapter completed）。
 */

/** 角色档案顶部身份注释：<!-- character_identity: {"character_uid":"...","name":"..."} --> */
const CHARACTER_IDENTITY_RE = /<!--\s*character_identity:\s*(\{[\s\S]*?\})\s*-->/

/** 角色档案小节的「（留白）」占位：未填写维度不计入展示。 */
const BLANK_PLACEHOLDER_RE = /^[（(]\s*留白\s*[)）]$/

/** 「- 别名: 甲、乙」一行（容忍 > / * / - 前缀与中英文冒号）。 */
const ALIAS_LINE_RE = /^[\s>*-]*别名\s*[:：]\s*(.+?)\s*$/m

/**
 * 抽取角色档案中某个 `## 小节` 的正文（直到下一个标题或文末）。无该小节返回 null。
 * 纯文本处理，不依赖宿主；档案由 LLM 生成、App 端不做 schema 校验，只尽力解析展示字段。
 */
function extractMarkdownSection(content: string, heading: string): string | null {
  const lines = content.split(/\r?\n/)
  const headingRe = new RegExp(`^#{1,6}\\s*${heading}\\s*$`)
  let start = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (headingRe.test(lines[i].trim())) {
      start = i + 1
      break
    }
  }
  if (start === -1) return null

  const body: string[] = []
  for (let i = start; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) break
    body.push(lines[i])
  }
  return body.join('\n').trim() || null
}

/** 解析「别名」行 → 别名数组（按、，/；切分，去空与「（留白）」占位）。无则空数组。 */
export function parseCharacterAliases(content: string): string[] {
  const match = content.match(ALIAS_LINE_RE)
  if (!match) return []
  const raw = match[1].trim()
  if (!raw || BLANK_PLACEHOLDER_RE.test(raw)) return []
  return raw
    .split(/[、,，/／;；]/)
    .map((alias) => alias.trim())
    .filter((alias) => alias && !BLANK_PLACEHOLDER_RE.test(alias))
}

/** 「## 基本信息」小节的字段行：`- 年龄：28 岁`（容忍 > / * / ・ / - 前缀与中英文冒号）。 */
const BASIC_INFO_LINE_RE = /^[\s>*・-]+(.+?)\s*[:：]\s*(.+?)\s*$/
/** 与 name 重复、无需在资料卡再展示一遍的字段。 */
const BASIC_INFO_SKIP_LABELS = new Set(['全名', '姓名'])

/** 清洗字段值：按中文逗号/顿号切分，丢掉「（留白）」占位段后拼回（处理「…二十多岁，具体（留白）」一类内联留白）。 */
function cleanBasicInfoValue(value: string): string {
  return value
    .split(/[，、]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !/[（(]\s*留白\s*[)）]/.test(segment))
    .join('，')
}

/**
 * 解析「## 基本信息」小节 → 入戏向基本信息字段（年龄 / 性别 / 外貌特征 / 职业 / 当前处境…）。
 * 跳过与 name 重复的「全名」，清掉「（留白）」占位；空小节返回空数组。
 * 只取基本信息：欲望/核心矛盾/弧线方向等是上帝视角创作笔记，带剧透，不进社交资料卡。
 */
export function parseCharacterBasicInfo(content: string): CharacterBasicInfoField[] {
  const section = extractMarkdownSection(content, '基本信息')
  if (!section) return []

  const fields: CharacterBasicInfoField[] = []
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(BASIC_INFO_LINE_RE)
    if (!match) continue
    const label = match[1].trim()
    if (!label || BASIC_INFO_SKIP_LABELS.has(label)) continue
    const value = cleanBasicInfoValue(match[2])
    if (!value) continue
    fields.push({ label, value })
  }
  return fields
}

interface SummaryCharactersRow {
  chapter: number
  characters: string
}

/** uid → 角色档案（settingPath + name）映射；无 character_identity 的档案不入表。 */
export interface CharacterSettingEntry {
  characterUid: string
  name: string
  settingPath: string
  /** 角色档案「别名」行解析结果（可选，缺省视为无别名）。 */
  aliases?: string[]
  /** 角色档案「基本信息」小节解析出的入戏向字段（可选，缺省视为无）。 */
  basicInfo?: CharacterBasicInfoField[]
}

interface SeenAggregate {
  firstAppearedChapter: number
  lastSeenChapter: number
}

function readNovelId(reader: MemoryDbReader): string | null {
  try {
    const rows = reader.all<{ value: string }>("SELECT value FROM meta WHERE key = 'novel_id' LIMIT 1")
    return rows[0]?.value ?? null
  } catch {
    return null
  }
}

/** 从 chapter_summaries.characters 的 CharacterReference[] JSON 提取本章出场的 uid 集合。 */
function parseChapterCharacterUids(raw: string): string[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const uids: string[] = []
  for (const ref of parsed) {
    if (!ref || typeof ref !== 'object') continue
    const uid = (ref as { character_uid?: unknown }).character_uid
    if (typeof uid === 'string' && uid.trim()) uids.push(uid.trim())
  }
  return uids
}

/**
 * 聚合每个 uid 的首次 / 最近出场章号。reader 缺表或读失败时返回空 Map（reader 自身可吞错）。
 */
export function aggregateAppearedSeen(reader: MemoryDbReader): {
  seenByUid: Map<string, SeenAggregate>
  knowledgeBoundaryChapter: number | null
} {
  const novelId = readNovelId(reader)
  const rows = novelId
    ? reader.all<SummaryCharactersRow>(
        'SELECT chapter, characters FROM chapter_summaries WHERE novel_id = ? ORDER BY chapter',
        novelId,
      )
    : reader.all<SummaryCharactersRow>('SELECT chapter, characters FROM chapter_summaries ORDER BY chapter')

  const seenByUid = new Map<string, SeenAggregate>()
  let knowledgeBoundaryChapter: number | null = null

  for (const row of rows) {
    if (!Number.isInteger(row.chapter)) continue
    knowledgeBoundaryChapter =
      knowledgeBoundaryChapter === null ? row.chapter : Math.max(knowledgeBoundaryChapter, row.chapter)

    for (const uid of parseChapterCharacterUids(row.characters)) {
      const existing = seenByUid.get(uid)
      if (!existing) {
        seenByUid.set(uid, { firstAppearedChapter: row.chapter, lastSeenChapter: row.chapter })
      } else {
        existing.firstAppearedChapter = Math.min(existing.firstAppearedChapter, row.chapter)
        existing.lastSeenChapter = Math.max(existing.lastSeenChapter, row.chapter)
      }
    }
  }

  return { seenByUid, knowledgeBoundaryChapter }
}

/**
 * 读已转正候选（candidate_characters.status=promoted）的 uid → 出场章号映射。
 * 已建档配角的出场证据兜底：抽取漏登记 chapter_summaries 时，用转正候选的 proposed_chapter
 * 作为出场章。缺表 / 读失败 / 无 proposed_chapter 的行跳过。
 */
export function aggregatePromotedCandidateChapters(reader: MemoryDbReader): Map<string, number> {
  const byUid = new Map<string, number>()
  const novelId = readNovelId(reader)
  const select =
    "SELECT character_uid, proposed_chapter FROM candidate_characters WHERE status = 'promoted'"
  let rows: Array<{ character_uid: string; proposed_chapter: number | null }>
  try {
    rows = novelId
      ? reader.all(`${select} AND novel_id = ?`, novelId)
      : reader.all(select)
  } catch {
    return byUid
  }

  for (const row of rows) {
    const uid = typeof row.character_uid === 'string' ? row.character_uid.trim() : ''
    if (!uid) continue
    if (typeof row.proposed_chapter === 'number' && Number.isInteger(row.proposed_chapter)) {
      const existing = byUid.get(uid)
      byUid.set(uid, existing === undefined ? row.proposed_chapter : Math.min(existing, row.proposed_chapter))
    }
  }
  return byUid
}

/**
 * 纯函数：遍历已建档角色，按出场证据 join 出联系人清单。
 * 每个 uid 取最早出场章为首次出场：
 * - seen 命中（chapter_summaries 有登记）→ 用聚合的 first/last seen；
 * - 否则若是已写完的 promoted 候选（proposed_chapter ≤ 知识边界）→ 用 proposed_chapter 兜底；
 * - 两者都不满足 → 不纳入。
 * 按首次出场章升序、同章按 name 稳定排序。
 */
export function buildContactList(
  seenByUid: Map<string, SeenAggregate>,
  knowledgeBoundaryChapter: number | null,
  settings: CharacterSettingEntry[],
  currentStatusByUid = new Map<string, string>(),
  promotedChapterByUid = new Map<string, number>(),
): CharacterContactList {
  const contacts: CharacterContact[] = []
  const addedUids = new Set<string>()

  for (const setting of settings) {
    const uid = setting.characterUid
    if (addedUids.has(uid)) continue

    const seen = seenByUid.get(uid)
    let firstAppearedChapter: number
    let lastSeenChapter: number

    if (seen) {
      firstAppearedChapter = seen.firstAppearedChapter
      lastSeenChapter = seen.lastSeenChapter
    } else {
      const proposed = promotedChapterByUid.get(uid)
      if (proposed === undefined || knowledgeBoundaryChapter === null || proposed > knowledgeBoundaryChapter) {
        continue
      }
      firstAppearedChapter = proposed
      lastSeenChapter = proposed
    }

    addedUids.add(uid)
    contacts.push({
      characterUid: uid,
      name: setting.name,
      firstAppearedChapter,
      lastSeenChapter,
      currentStatus: currentStatusByUid.get(uid) ?? null,
      settingPath: setting.settingPath,
      aliases: setting.aliases ?? [],
      basicInfo: setting.basicInfo ?? [],
    })
  }

  contacts.sort(
    (left, right) =>
      left.firstAppearedChapter - right.firstAppearedChapter ||
      left.name.localeCompare(right.name, 'zh-CN'),
  )

  return { contacts, knowledgeBoundaryChapter }
}

/**
 * 纯函数：把引擎查到的 currentStatus（`Map<uid,string>`）回填到联系人清单。
 * 空 Map（引擎降级 / 全空）时原样返回，不破坏既有 currentStatus（保持 null）。列表富化路径专用。
 */
export function enrichContactsWithStatuses(
  list: CharacterContactList,
  statusByUid: Map<string, string>,
): CharacterContactList {
  if (statusByUid.size === 0) return list
  return {
    ...list,
    contacts: list.contacts.map((contact) => ({
      ...contact,
      currentStatus: statusByUid.get(contact.characterUid) ?? contact.currentStatus ?? null,
    })),
  }
}

/**
 * 扫描 bible/characters/*.md，解析 character_identity 注释 → 已建档角色映射。
 * 无目录 / 读失败时返回空数组；档案缺 character_identity 的不纳入（视为未确认 canonical 身份）。
 * settingPath 用相对项目根的 POSIX 风格路径（bible/characters/<file>），与 NovelMemory reader 契约一致。
 */
export async function scanCharacterSettings(projectPath: string): Promise<CharacterSettingEntry[]> {
  const dir = join(projectPath, charactersDir())
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }

  const entries: CharacterSettingEntry[] = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    let content: string
    try {
      content = await readFile(join(dir, file), 'utf-8')
    } catch {
      continue
    }
    const match = content.match(CHARACTER_IDENTITY_RE)
    if (!match) continue
    let parsed: { character_uid?: unknown; name?: unknown }
    try {
      parsed = JSON.parse(match[1]) as { character_uid?: unknown; name?: unknown }
    } catch {
      continue
    }
    const uid = typeof parsed.character_uid === 'string' ? parsed.character_uid.trim() : ''
    if (!uid) continue
    const fileStem = file.replace(/\.md$/, '')
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : fileStem
    entries.push({
      characterUid: uid,
      name,
      // 相对项目根、正斜杠分隔（contract 友好），不依赖宿主路径分隔符。
      settingPath: `${charactersDir().replace(/\\/g, '/')}/${file}`,
      // 同一次读取里顺手解析展示字段（别名 / 基本信息），零额外文件 IO。
      aliases: parseCharacterAliases(content),
      basicInfo: parseCharacterBasicInfo(content),
    })
  }
  return entries
}

/**
 * 顶层读取：只读 memory.db 聚合出场 + 扫描角色档案，返回 Appeared character 联系人清单。
 * memory.db 缺失 / 不可读 / 缺表时联系人为空（board 显示中性空态）。
 *
 * **不再在此折叠 currentStatus**：角色当前状态的真相口径归引擎所有（NovelMemory MCP
 * 工具 `novel_character_statuses`）。本读取只产出 seen 聚合 + 已建档联系人，currentStatus
 * 一律留 null；列表富化由 IPC handler 经引擎按需回填，runner 路径零引擎开销、零付费。
 */
export async function readAppearedCharacterContacts(input: {
  projectPath: string
  openMemoryDb: OpenMemoryDb
}): Promise<CharacterContactList> {
  const { projectPath, openMemoryDb } = input

  let seenByUid = new Map<string, SeenAggregate>()
  let knowledgeBoundaryChapter: number | null = null
  let promotedChapterByUid = new Map<string, number>()
  let reader: MemoryDbReader | null = null

  try {
    reader = openMemoryDb(join(projectPath, narracatMemoryDbPath()))
    const aggregate = aggregateAppearedSeen(reader)
    seenByUid = aggregate.seenByUid
    knowledgeBoundaryChapter = aggregate.knowledgeBoundaryChapter
    promotedChapterByUid = aggregatePromotedCandidateChapters(reader)
  } catch {
    seenByUid = new Map()
    knowledgeBoundaryChapter = null
    promotedChapterByUid = new Map()
  } finally {
    try {
      reader?.close()
    } catch {
      // ignore close failures
    }
  }

  const settings = await scanCharacterSettings(projectPath)
  return buildContactList(seenByUid, knowledgeBoundaryChapter, settings, undefined, promotedChapterByUid)
}
