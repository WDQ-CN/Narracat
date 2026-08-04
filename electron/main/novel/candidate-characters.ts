import { join } from 'node:path'

import { narracatMemoryDbPath } from './novel-layout'
import type { MemoryDbReader, OpenMemoryDb } from './memory-db'

/**
 * 候选角色读取（ADR-0015 渐进生长·内容实例层）。
 *
 * 写正文 / 规划大纲时引用了既无档案、又不在候选清单里的新名字时，主会话按
 * new-character-intake 契约把它登记进 NovelMemory 的 candidate_characters 表（status=candidate）。
 * 候选不落文件、不入 facts / character_cards，只在 SQLite 登记，等待出场再建档转正。
 *
 * 本模块只读 status=candidate 的待建档候选，供「小说角色」目录展示+引导用户用世界观 Agent 建档。
 * memory.db 缺失 / 无表 / 读失败时返回空数组（目录退回只显示已建档角色）。
 */

export interface CandidateCharacter {
  characterUid: string
  name: string
  note: string | null
  proposedChapter: number | null
  /** 重要度（ADR-0023）：minor（次要，目录可见、不提醒）/ major（重要，写完正文提醒建档）。旧行 / 未知一律按 minor。 */
  importance: 'minor' | 'major'
  source: 'plan' | 'write' | 'manual'
}

interface CandidateCharacterRow {
  character_uid: string
  name: string
  note: string | null
  proposed_chapter: number | null
  importance: string | null
  source: string
}

function readNovelId(reader: MemoryDbReader): string | null {
  try {
    const rows = reader.all<{ value: string }>("SELECT value FROM meta WHERE key = 'novel_id' LIMIT 1")
    return rows[0]?.value ?? null
  } catch {
    return null
  }
}

function normalizeSource(value: string): CandidateCharacter['source'] {
  return value === 'plan' || value === 'manual' ? value : 'write'
}

function normalizeImportance(value: string | null): CandidateCharacter['importance'] {
  return value === 'major' ? 'major' : 'minor'
}

/**
 * 探测 candidate_characters 是否已有 importance 列（引擎 schema v14 加列）。
 * App 只读打开 memory.db，跑不了 MCP 的加列迁移；用户更新到带 importance 的版本后、
 * 在触发任何 agent run（迁移）之前浏览角色目录时，老库仍是旧 schema——此时直接 SELECT
 * importance 会抛 no such column，整片候选目录回退为空。先探列、缺列则退回旧查询并补 minor。
 */
function hasImportanceColumn(reader: MemoryDbReader): boolean {
  try {
    const cols = reader.all<{ name: string }>('PRAGMA table_info(candidate_characters)')
    return cols.some((c) => c.name === 'importance')
  } catch {
    return false
  }
}

/**
 * 纯函数：从 reader 聚合待建档候选（status=candidate）。
 * 有 novel_id 则按 novel_id 过滤，缺失时全表读（单库单小说，兼容）。按提案章号、再按名字稳定排序。
 */
export function aggregateCandidateCharacters(reader: MemoryDbReader): CandidateCharacter[] {
  const novelId = readNovelId(reader)
  // 老库（未跑 v14 迁移）缺 importance 列：退回不含它的查询，全员落 minor，避免整片目录消失。
  const hasImportance = hasImportanceColumn(reader)
  const columns = hasImportance
    ? 'character_uid, name, note, proposed_chapter, importance, source'
    : 'character_uid, name, note, proposed_chapter, source'
  const select = `SELECT ${columns} FROM candidate_characters WHERE status = 'candidate'`
  const rows = novelId
    ? reader.all<CandidateCharacterRow>(`${select} AND novel_id = ? ORDER BY proposed_chapter, name`, novelId)
    : reader.all<CandidateCharacterRow>(`${select} ORDER BY proposed_chapter, name`)

  const seen = new Set<string>()
  const candidates: CandidateCharacter[] = []
  for (const row of rows) {
    const uid = typeof row.character_uid === 'string' ? row.character_uid.trim() : ''
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (!uid || !name || seen.has(uid)) continue
    seen.add(uid)
    candidates.push({
      characterUid: uid,
      name,
      note: typeof row.note === 'string' && row.note.trim() ? row.note.trim() : null,
      proposedChapter: typeof row.proposed_chapter === 'number' ? row.proposed_chapter : null,
      importance: normalizeImportance(
        hasImportance && typeof row.importance === 'string' ? row.importance : null,
      ),
      source: normalizeSource(row.source),
    })
  }
  return candidates
}

/**
 * 顶层读取：打开只读 memory.db 聚合待建档候选。缺库 / 缺表 / 读失败一律返回空数组。
 */
export async function readCandidateCharacters(input: {
  projectPath: string
  openMemoryDb: OpenMemoryDb
}): Promise<CandidateCharacter[]> {
  let reader: MemoryDbReader | null = null
  try {
    reader = input.openMemoryDb(join(input.projectPath, narracatMemoryDbPath()))
    return aggregateCandidateCharacters(reader)
  } catch {
    return []
  } finally {
    try {
      reader?.close()
    } catch {
      // ignore close failures
    }
  }
}
