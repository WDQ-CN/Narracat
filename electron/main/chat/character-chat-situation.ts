/**
 * 片4：唠个嗑「当前处境包」组装（spec 2026-07-15-a4d2-slice4-situation-pack-design.md §3）。
 * App 主进程零 LLM 直读 memory.db：状态区吃引擎物化角色卡（复用只读快照，不复刻折叠语义），
 * 关系区/亲历区直查 facts。
 * 纪律：POV 洁净（客语只收 relationship）/ secret 未打标不放行 / 只收生效章 ≤ 知识边界 /
 * 排除纠错作废行（自然顶替的历史是真实的过去，保留）/ 计划表绝不读。
 */
import { join } from 'node:path'

import type { CharacterStateSnapshot } from '@shared/types/character-state'
import { readAppearedCharacterContacts } from '../novel/appeared-characters.ts'
import {
  attributeFactToDimension,
  factsHasSecretKnown,
  readCharacterStateSnapshot,
  readNovelId,
  readStateVocabulary,
} from '../novel/character-state.ts'
import type { MemoryDbReader, OpenMemoryDb } from '../novel/memory-db.ts'
import { narracatMemoryDbPath } from '../novel/novel-layout.ts'

export interface SituationPackInput {
  projectPath: string
  characterUid: string
  characterName: string
  /** 聊天知识边界（最新完成章）；null = 尚无完成章，不注入处境包。 */
  knowledgeBoundaryChapter: number | null
  openMemoryDb: OpenMemoryDb
}

/** 预算默认值（spec §3.1，真机后可调）。 */
const RELATIONSHIP_COUNTERPART_LIMIT = 8
const RELATIONSHIP_FACTS_PER_COUNTERPART = 3
const RECENT_EXPERIENCE_LIMIT = 15

/** 排除纠错作废行：invalidated_at_chapter ≤ 自身生效章 = 从未生效（correct/retract 受害行）。 */
const NOT_REVOKED_SQL = `(invalidated_at_chapter IS NULL OR invalidated_at_chapter > COALESCE(event_chapter, from_chapter))`

interface RelationshipFactRow {
  subject: string
  subject_character_uid: string | null
  subject_character_b_uid: string | null
  object: string
  from_chapter: number | null
  event_chapter: number | null
}

interface ExperienceFactRow {
  predicate: string
  object: string
  from_chapter: number | null
  event_chapter: number | null
}

const chapterOf = (row: { from_chapter: number | null; event_chapter: number | null }): number =>
  row.event_chapter ?? row.from_chapter ?? 0

export async function buildCharacterSituationPack(input: SituationPackInput): Promise<string> {
  const { projectPath, characterUid, characterName, knowledgeBoundaryChapter, openMemoryDb } = input
  if (knowledgeBoundaryChapter === null) return ''

  const snapshot = await readCharacterStateSnapshot({ projectPath, characterUid, characterName, openMemoryDb })
  const stateLine = renderStateLine(snapshot)

  // 对方显示名以 uid 为 canonical（ADR-0012）：改名后 subject 字符串是旧名，须经出场名录解析当前名
  const contacts = await readAppearedCharacterContacts({ projectPath, openMemoryDb })
  const nameByUid = new Map(contacts.contacts.map((contact) => [contact.characterUid, contact.name]))

  const reader = openMemoryDb(join(projectPath, narracatMemoryDbPath()))
  let relationshipLines: string[] = []
  let experienceLines: string[] = []
  try {
    // novel_id 有则按 novel_id 过滤，缺失时全表读（单库单小说，兼容；同 character-state.ts 先例）——
    // 生产库 meta 表实际从未写入过 novel_id，硬要求非空会让处境包在所有真机数据上恒为空
    // （dogfood 只读副本验证发现，片4 收尾）。
    const novelId = readNovelId(reader)
    relationshipLines = buildRelationshipLines(
      reader,
      novelId,
      characterUid,
      characterName,
      knowledgeBoundaryChapter,
      nameByUid,
    )
    experienceLines = await buildExperienceLines(reader, novelId, characterUid, knowledgeBoundaryChapter, projectPath)
  } finally {
    reader.close()
  }

  const sections: string[] = []
  if (stateLine) sections.push(`你的状态：${stateLine}`)
  if (relationshipLines.length) sections.push(['你的关系：', ...relationshipLines].join('\n'))
  if (experienceLines.length) sections.push(['你最近亲历的事：', ...experienceLines].join('\n'))
  if (!sections.length) return ''
  return [`【你当前的处境】（截至第 ${knowledgeBoundaryChapter} 章）`, ...sections].join('\n')
}

/** 状态区：只信引擎物化角色卡；secret 未知晓的值剔除（secretKnown === false）。 */
function renderStateLine(snapshot: CharacterStateSnapshot): string {
  return snapshot.card
    .map((entry) => {
      const values = entry.values.filter((item) => item.secretKnown !== false).map((item) => item.value)
      return values.length ? `${entry.displayName}=${values.join('、')}` : null
    })
    .filter((part): part is string => part !== null)
    .join(' · ')
}

/** 关系区：按对方分组（最近活跃的前 8 个），每对象取最新 3 条、按章升序渲染成演变轨迹。 */
function buildRelationshipLines(
  reader: MemoryDbReader,
  novelId: string | null,
  characterUid: string,
  characterName: string,
  boundary: number,
  nameByUid: Map<string, string>,
): string[] {
  const rows = novelId
    ? reader.all<RelationshipFactRow>(
        `SELECT subject, subject_character_uid, subject_character_b_uid, object, from_chapter, event_chapter
         FROM facts
         WHERE novel_id = ? AND predicate = 'relationship'
           AND (subject_character_uid = ? OR subject_character_b_uid = ?)
           AND COALESCE(event_chapter, from_chapter) <= ?
           AND ${NOT_REVOKED_SQL}
         ORDER BY COALESCE(event_chapter, from_chapter) DESC, rowid DESC`,
        novelId,
        characterUid,
        characterUid,
        boundary,
      )
    : reader.all<RelationshipFactRow>(
        `SELECT subject, subject_character_uid, subject_character_b_uid, object, from_chapter, event_chapter
         FROM facts
         WHERE predicate = 'relationship'
           AND (subject_character_uid = ? OR subject_character_b_uid = ?)
           AND COALESCE(event_chapter, from_chapter) <= ?
           AND ${NOT_REVOKED_SQL}
         ORDER BY COALESCE(event_chapter, from_chapter) DESC, rowid DESC`,
        characterUid,
        characterUid,
        boundary,
      )
  const groups = new Map<string, { name: string; facts: RelationshipFactRow[] }>()
  for (const row of rows) {
    const counterpartUid =
      row.subject_character_uid === characterUid ? row.subject_character_b_uid : row.subject_character_uid
    // 显示名以 uid 解析 canonical 名为准（ADR-0012）；字符串拆分仅作无 uid 历史数据的降级
    const name =
      (counterpartUid ? nameByUid.get(counterpartUid) : undefined) ?? counterpartNameOf(row.subject, characterName)
    const key = counterpartUid ?? name
    const group = groups.get(key) ?? { name, facts: [] }
    if (group.facts.length < RELATIONSHIP_FACTS_PER_COUNTERPART) group.facts.push(row)
    groups.set(key, group)
  }
  return [...groups.values()].slice(0, RELATIONSHIP_COUNTERPART_LIMIT).map((group) => {
    const trail = [...group.facts]
      .sort((a, b) => chapterOf(a) - chapterOf(b))
      .map((fact) => `${fact.object}（第${chapterOf(fact)}章）`)
    return `· ${group.name}：${trail.join('；')}`
  })
}

/** 降级路径：关系 subject 形如「名A|名B」，取非本角色的一侧作对方显示名（仅当行上无 counterpart uid）。 */
function counterpartNameOf(subject: string, characterName: string): string {
  const parts = subject
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.find((part) => part !== characterName) ?? parts[0] ?? '未知'
}

/** 亲历区：主语=该角色的非 relationship 事实，最近 15 条；secret 未打标不放行；老库缺列按全未知晓。 */
async function buildExperienceLines(
  reader: MemoryDbReader,
  novelId: string | null,
  characterUid: string,
  boundary: number,
  projectPath: string,
): Promise<string[]> {
  const secretFilter = factsHasSecretKnown(reader)
    ? `AND (predicate != 'secret' OR secret_known = 1)`
    : `AND predicate != 'secret'`
  const rows = novelId
    ? reader.all<ExperienceFactRow>(
        // 依赖引擎不变量「仅 relationship 谓词填 subject_character_b_uid」；若未来双主体谓词出现，
        // 此条会静默漏收主语事实，须随引擎同步调整
        `SELECT predicate, object, from_chapter, event_chapter
         FROM facts
         WHERE novel_id = ? AND subject_character_uid = ? AND subject_character_b_uid IS NULL
           AND predicate != 'relationship'
           AND COALESCE(event_chapter, from_chapter) <= ?
           AND ${NOT_REVOKED_SQL}
           ${secretFilter}
         ORDER BY COALESCE(event_chapter, from_chapter) DESC, rowid DESC
         LIMIT ${RECENT_EXPERIENCE_LIMIT}`,
        novelId,
        characterUid,
        boundary,
      )
    : reader.all<ExperienceFactRow>(
        // 依赖引擎不变量「仅 relationship 谓词填 subject_character_b_uid」；若未来双主体谓词出现，
        // 此条会静默漏收主语事实，须随引擎同步调整
        `SELECT predicate, object, from_chapter, event_chapter
         FROM facts
         WHERE subject_character_uid = ? AND subject_character_b_uid IS NULL
           AND predicate != 'relationship'
           AND COALESCE(event_chapter, from_chapter) <= ?
           AND ${NOT_REVOKED_SQL}
           ${secretFilter}
         ORDER BY COALESCE(event_chapter, from_chapter) DESC, rowid DESC
         LIMIT ${RECENT_EXPERIENCE_LIMIT}`,
        characterUid,
        boundary,
      )
  if (!rows.length) return []
  // 维度名走机械归属 SSOT（外审 P2-5）：同谓词可属多维度（ability=境界/剑法），不能按谓词取第一个显示名
  const vocabulary = await readStateVocabulary(projectPath)
  return rows.map((row) => {
    const dimension = vocabulary ? attributeFactToDimension(vocabulary, row.predicate, row.object) : null
    return `· 第${chapterOf(row)}章 ${dimension?.display_name ?? row.predicate}：${row.object}`
  })
}
