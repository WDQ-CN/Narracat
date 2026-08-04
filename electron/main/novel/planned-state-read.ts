import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  ChapterPlannedStateSnapshot,
  CharacterFuturePlansSnapshot,
  PlannedStateCharacterDto,
  PlannedStateCounts,
  PlannedStateDimensionDto,
  PlannedStateRowDto,
  PlannedStateStatus,
} from '@shared/types/planned-state'
import type { MemoryDbReader, OpenMemoryDb } from './memory-db'
import { readNovelId, readStateVocabulary, type StateDimensionDef } from './character-state'
import { locateChapterOutlineFiles } from './chapter-outline-edit'
import { charactersDir, narracatMemoryDbPath } from './novel-layout'
import { readWrittenChapterSet } from './novel-project'

/**
 * 计划状态变更（`planned_state_changes` 五态计划账）只读聚合（A4×D2 片3b，spec §2.1/§7.1）。
 *
 * 口径纪律（照抄 character-state.ts 的先例）：
 * - App 对 memory.db 只读，写入由引擎侧 novel_submit_chapter_outline / novel_check_state_delivery 独占；
 * - 角色未来计划轻提示②按精确「已写章」口径过滤（state.yaml completed 集合 ∩ 正文文件存在，
 *   见 novel-project.ts 的 readWrittenChapterSet）——不是"大于最大完成章"的 floor 过滤，
 *   否则新书（无完成章）全漏、断档章（如第 10 章完成但第 8 章未写）的计划被误滤（spec P2-1 口径）；
 * - 全链吞错降级（available=false / 空骨架，counts 空对象），绝不抛给渲染进程；
 * - reader 用完 finally close。
 */

interface PlannedStateRowRaw {
  id: string
  chapter: number
  status: PlannedStateStatus
  deferred_to_chapter: number | null
  character_uid: string
  character_name: string
  dimension: string
  operation: 'set' | 'add' | 'remove'
  value: string
  reason: string | null
}

interface PlannedStateCountRow {
  chapter: number
  n: number
}

/**
 * novel_id 有则过滤、缺失则全表读（单库单小说）——与 character-state.ts / appeared-characters.ts /
 * candidate-characters.ts / novel-status-memory.ts 同构的兜底。引擎自 4.0.123 起在开库时把
 * config.yaml 的 novel_id 回填进 meta，但库在被引擎打开前 App 仍可能先读到，故兜底保留为防御层。
 */
const novelFilter = (novelId: string | null): string => (novelId ? 'novel_id = ? AND ' : '')

const rowsByChapterSql = (novelId: string | null): string => `
  SELECT id, chapter, status, deferred_to_chapter, character_uid, character_name,
         dimension, operation, value, reason
  FROM planned_state_changes WHERE ${novelFilter(novelId)}chapter = ? ORDER BY rowid ASC`

const rowsByCharacterSql = (novelId: string | null): string => `
  SELECT id, chapter, status, deferred_to_chapter, character_uid, character_name,
         dimension, operation, value, reason
  FROM planned_state_changes WHERE ${novelFilter(novelId)}character_uid = ? AND status = 'planned'
  ORDER BY chapter ASC, rowid ASC`

const plannedCountsSql = (novelId: string | null): string => `
  SELECT chapter, COUNT(*) AS n FROM planned_state_changes
  WHERE ${novelFilter(novelId)}status = 'planned' GROUP BY chapter`

const UNAVAILABLE_CHAPTER_SNAPSHOT: ChapterPlannedStateSnapshot = {
  available: false,
  rows: [],
  dimensions: [],
  characters: [],
  jsonStateChanges: null,
}

const UNAVAILABLE_CHARACTER_SNAPSHOT: CharacterFuturePlansSnapshot = {
  available: false,
  rows: [],
}

function toRowDto(row: PlannedStateRowRaw): PlannedStateRowDto {
  return {
    id: row.id,
    chapter: row.chapter,
    status: row.status,
    deferredToChapter: row.deferred_to_chapter,
    characterUid: row.character_uid,
    characterName: row.character_name,
    dimension: row.dimension,
    operation: row.operation,
    value: row.value,
    reason: row.reason,
  }
}

function toDimensionDto(dim: StateDimensionDef): PlannedStateDimensionDto {
  return {
    key: dim.key,
    displayName: dim.display_name,
    cardinality: dim.cardinality,
    valueType: dim.value_type,
    ...(dim.values ? { values: dim.values } : {}),
  }
}

/** 有实体 json 的角色列表（bible/characters/*.json，坏文件/字段缺失跳过）；一次 readdir，无 N+1。 */
async function readPlannedStateCharacters(projectPath: string): Promise<PlannedStateCharacterDto[]> {
  let entries: string[]
  try {
    entries = await readdir(join(projectPath, charactersDir()))
  } catch {
    return []
  }

  const characters: PlannedStateCharacterDto[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    try {
      const raw = await readFile(join(projectPath, charactersDir(), entry), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') continue
      const record = parsed as Record<string, unknown>
      if (typeof record.character_uid !== 'string' || typeof record.name !== 'string') continue
      characters.push({ uid: record.character_uid, name: record.name })
    } catch {
      // 坏文件跳过，不阻断其它角色
    }
  }
  return characters
}

/**
 * 该章 json 的 `state_changes` 现值（CAS 基线，见 ChapterPlannedStateSnapshot 类型注释）：
 * json 文件缺失 → null（禁用编辑）；json 存在但无该字段 / 字段非数组 → []（基线=空数组，可正常提交）。
 */
async function readChapterJsonStateChanges(projectPath: string, chapter: number): Promise<unknown[] | null> {
  const located = await locateChapterOutlineFiles(projectPath, chapter)
  if (!located) return null
  try {
    const raw = await readFile(located.jsonPath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    const stateChanges = (parsed as Record<string, unknown>).state_changes
    return Array.isArray(stateChanges) ? stateChanges : []
  } catch {
    // 定位成功但读盘/解析失败（竞态或损坏文件）——基线不可信，按缺失处理禁用编辑
    return null
  }
}

export interface ReadChapterPlannedStateInput {
  projectPath: string
  chapter: number
  openMemoryDb: OpenMemoryDb
}

/** 章纲卡账本区消费：该章计划状态变更全字段 + 编辑器所需的词表/角色列表/CAS 基线。 */
export async function readChapterPlannedState(input: ReadChapterPlannedStateInput): Promise<ChapterPlannedStateSnapshot> {
  const { projectPath, chapter, openMemoryDb } = input

  const [dimensions, characters, jsonStateChanges] = await Promise.all([
    readStateVocabulary(projectPath),
    readPlannedStateCharacters(projectPath),
    readChapterJsonStateChanges(projectPath, chapter),
  ])

  let reader: MemoryDbReader
  try {
    reader = openMemoryDb(join(projectPath, narracatMemoryDbPath()))
  } catch {
    return UNAVAILABLE_CHAPTER_SNAPSHOT
  }

  try {
    const novelId = readNovelId(reader)

    let rows: PlannedStateRowRaw[] = []
    try {
      rows = novelId
        ? reader.all<PlannedStateRowRaw>(rowsByChapterSql(novelId), novelId, chapter)
        : reader.all<PlannedStateRowRaw>(rowsByChapterSql(null), chapter)
    } catch {
      // 表缺失（旧库/半初始化）→ 按无数据处理，不阻断页面
    }

    return {
      available: true,
      rows: rows.map(toRowDto),
      dimensions: (dimensions ?? []).map(toDimensionDto),
      characters,
      jsonStateChanges,
    }
  } finally {
    try {
      reader.close()
    } catch {
      // 关闭失败不影响返回
    }
  }
}

export interface ReadCharacterFuturePlansInput {
  projectPath: string
  characterUid: string
  openMemoryDb: OpenMemoryDb
}

/**
 * 角色页轻提示②消费：该角色未来的 status='planned' 行中，尚未写章的部分（已兑现/已作废/
 * 已延期不在此列——status='planned' 已排除；"未写章"按精确已写章集合过滤，见模块头注）。
 */
export async function readCharacterFuturePlans(
  input: ReadCharacterFuturePlansInput,
): Promise<CharacterFuturePlansSnapshot> {
  const { projectPath, characterUid, openMemoryDb } = input

  let reader: MemoryDbReader
  try {
    reader = openMemoryDb(join(projectPath, narracatMemoryDbPath()))
  } catch {
    return UNAVAILABLE_CHARACTER_SNAPSHOT
  }

  try {
    const novelId = readNovelId(reader)

    let rows: PlannedStateRowRaw[] = []
    try {
      rows = novelId
        ? reader.all<PlannedStateRowRaw>(rowsByCharacterSql(novelId), novelId, characterUid)
        : reader.all<PlannedStateRowRaw>(rowsByCharacterSql(null), characterUid)
    } catch {
      // 表缺失（旧库/半初始化）→ 按无数据处理，不阻断页面
    }

    const writtenChapters = await readWrittenChapterSet(projectPath)
    const unwrittenRows = rows.filter((row) => !writtenChapters.has(row.chapter))

    return { available: true, rows: unwrittenRows.map(toRowDto) }
  } finally {
    try {
      reader.close()
    } catch {
      // 关闭失败不影响返回
    }
  }
}

export interface ReadPlannedStateCountsAggInput {
  projectPath: string
  openMemoryDb: OpenMemoryDb
}

/** 目录徽标消费：全书按章的 status='planned' 行计数（未兑现判定留渲染端 join toc）。 */
export async function readPlannedStateCounts(input: ReadPlannedStateCountsAggInput): Promise<PlannedStateCounts> {
  const { projectPath, openMemoryDb } = input

  let reader: MemoryDbReader
  try {
    reader = openMemoryDb(join(projectPath, narracatMemoryDbPath()))
  } catch {
    return {}
  }

  try {
    const novelId = readNovelId(reader)

    let rows: PlannedStateCountRow[] = []
    try {
      rows = novelId
        ? reader.all<PlannedStateCountRow>(plannedCountsSql(novelId), novelId)
        : reader.all<PlannedStateCountRow>(plannedCountsSql(null))
    } catch {
      // 表缺失（旧库/半初始化）→ 按无数据处理
    }

    return Object.fromEntries(rows.map((row) => [String(row.chapter), row.n]))
  } finally {
    try {
      reader.close()
    } catch {
      // 关闭失败不影响返回
    }
  }
}
