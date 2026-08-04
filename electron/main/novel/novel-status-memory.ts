import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { narracatMemoryDbPath, REVIEWS_DIR } from './novel-layout'
import { getReferenceWorksSummary } from './reference-works'
import type { MemoryDbReader, OpenMemoryDb } from './memory-db'
import type { NovelStatusEnrichment } from './novel-status'
import type {
  NovelStatusArc,
  NovelStatusForeshadowing,
  NovelStatusForeshadowingState,
  NovelStatusForeshadowingType,
  NovelStatusReferences,
  NovelStatusReviewFailure,
} from '@shared/types/novel'

interface ArcMetaRow {
  arc_id: string
  volume_no: number | null
  title: string
  chapter_start: number | null
  chapter_end: number | null
  core_question: string
  irreversible_change: string
}

interface ForeshadowingRegistryRow {
  id: string
  type: string
  description: string
  planted_chapter: number | null
  target_reveal: string | null
}

interface ForeshadowingActionRow {
  foreshadowing_id: string
  chapter: number
  action: string
}

function readNovelId(reader: MemoryDbReader): string | null {
  try {
    const rows = reader.all<{ value: string }>("SELECT value FROM meta WHERE key = 'novel_id' LIMIT 1")
    return rows[0]?.value ?? null
  } catch {
    return null
  }
}

/**
 * 当前 arc：取覆盖 currentChapter 的 arc；无 currentChapter 或无覆盖时取 chapter_start
 * 最大（最新）的一条。无 arc_meta 行返回 null（面板降级为「未规划」）。
 */
function selectCurrentArc(rows: ArcMetaRow[], currentChapter: number | null): NovelStatusArc | null {
  if (rows.length === 0) return null

  const covering =
    currentChapter !== null
      ? rows.find(
          (row) =>
            row.chapter_start !== null &&
            row.chapter_end !== null &&
            currentChapter >= row.chapter_start &&
            currentChapter <= row.chapter_end,
        )
      : undefined

  const chosen = covering ?? [...rows].sort((a, b) => (b.chapter_start ?? 0) - (a.chapter_start ?? 0))[0]
  if (!chosen) return null

  return {
    arcId: chosen.arc_id,
    volumeNo: chosen.volume_no,
    title: chosen.title,
    chapterStart: chosen.chapter_start,
    chapterEnd: chosen.chapter_end,
    coreQuestion: chosen.core_question,
    irreversibleChange: chosen.irreversible_change,
  }
}

const foreshadowingTypes = new Set<NovelStatusForeshadowingType>(['small', 'medium', 'major'])

function normalizeForeshadowingType(value: string): NovelStatusForeshadowingType {
  return foreshadowingTypes.has(value as NovelStatusForeshadowingType)
    ? (value as NovelStatusForeshadowingType)
    : 'medium'
}

/**
 * 动作 → 状态（对齐引擎 readers.ts STATUS_BY_ACTION）。未知动作回落 registered。
 */
const STATE_BY_ACTION: Record<string, NovelStatusForeshadowingState> = {
  plant: 'planted',
  develop: 'developing',
  reveal: 'revealed',
}

/**
 * 同章并列时的动作等级（对齐引擎 readers.ts ACTION_RANK），取生命周期更靠后的动作。
 */
const ACTION_RANK: Record<string, number> = { plant: 1, develop: 2, reveal: 3 }

/**
 * 状态由该伏笔「最新已兑现动作」机械导出，对齐引擎 latestRealizedActions：
 * 调用方已用 status='realized' 过滤，这里按 chapter 取最新；同章并列用 ACTION_RANK 取等级最高。
 * 无任何已兑现动作 → registered（仅登记/计划，未真正埋设）。
 */
function deriveForeshadowingState(actions: ForeshadowingActionRow[]): NovelStatusForeshadowingState {
  let latest: ForeshadowingActionRow | null = null
  for (const action of actions) {
    if (
      !latest ||
      action.chapter > latest.chapter ||
      (action.chapter === latest.chapter &&
        (ACTION_RANK[action.action] ?? 0) > (ACTION_RANK[latest.action] ?? 0))
    ) {
      latest = action
    }
  }
  if (!latest) return 'registered'
  return STATE_BY_ACTION[latest.action] ?? 'registered'
}

/** target_reveal 解析为章号（纯数字）；'vol-NN' 等卷级粗锚点返回 null（不判临期）。 */
function parseTargetChapter(targetReveal: string | null): number | null {
  if (!targetReveal) return null
  const trimmed = targetReveal.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isInteger(value) ? value : null
}

function buildForeshadowing(
  registry: ForeshadowingRegistryRow[],
  actionsByForeshadowing: Map<string, ForeshadowingActionRow[]>,
  currentChapter: number | null,
): NovelStatusForeshadowing[] {
  return registry
    .map((row) => {
      const actions = actionsByForeshadowing.get(row.id) ?? []
      const state = deriveForeshadowingState(actions)
      const targetChapter = parseTargetChapter(row.target_reveal)
      const overdue =
        state !== 'revealed' &&
        targetChapter !== null &&
        currentChapter !== null &&
        targetChapter <= currentChapter

      return {
        id: row.id,
        type: normalizeForeshadowingType(row.type),
        description: row.description,
        state,
        plantedChapter: row.planted_chapter,
        targetReveal: row.target_reveal,
        overdue,
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
}

/**
 * 只读聚合 memory.db 的 arc + 伏笔。打开失败 / 缺表 / 缺库时返回 undefined（面板降级）。
 * currentChapter 用于选当前 arc 与判伏笔临期。
 */
export function aggregateMemoryStatus(
  reader: MemoryDbReader,
  currentChapter: number | null,
): { currentArc: NovelStatusArc | null; foreshadowing: NovelStatusForeshadowing[] } {
  const novelId = readNovelId(reader)

  const arcRows = novelId
    ? reader.all<ArcMetaRow>(
        `SELECT arc_id, volume_no, title, chapter_start, chapter_end, core_question, irreversible_change
         FROM arc_meta WHERE novel_id = ?`,
        novelId,
      )
    : reader.all<ArcMetaRow>(
        `SELECT arc_id, volume_no, title, chapter_start, chapter_end, core_question, irreversible_change
         FROM arc_meta`,
      )

  const registryRows = novelId
    ? reader.all<ForeshadowingRegistryRow>(
        `SELECT id, type, description, planted_chapter, target_reveal
         FROM foreshadowing_registry WHERE novel_id = ?`,
        novelId,
      )
    : reader.all<ForeshadowingRegistryRow>(
        `SELECT id, type, description, planted_chapter, target_reveal FROM foreshadowing_registry`,
      )

  // 只取 status='realized' 的已兑现动作（对齐引擎 latestRealizedActions）：
  // novel_submit_chapter_outline 会预登记 status='planned' 的 develop/reveal 行，
  // 仅计划未兑现的动作不得参与状态导出，否则会把未揭示伏笔误判为已揭示。
  const actionRows = novelId
    ? reader.all<ForeshadowingActionRow>(
        `SELECT foreshadowing_id, chapter, action FROM foreshadowing_actions_log
         WHERE novel_id = ? AND status = 'realized'`,
        novelId,
      )
    : reader.all<ForeshadowingActionRow>(
        `SELECT foreshadowing_id, chapter, action FROM foreshadowing_actions_log
         WHERE status = 'realized'`,
      )

  const actionsByForeshadowing = new Map<string, ForeshadowingActionRow[]>()
  for (const action of actionRows) {
    const list = actionsByForeshadowing.get(action.foreshadowing_id) ?? []
    list.push(action)
    actionsByForeshadowing.set(action.foreshadowing_id, list)
  }

  return {
    currentArc: selectCurrentArc(arcRows, currentChapter),
    foreshadowing: buildForeshadowing(registryRows, actionsByForeshadowing, currentChapter),
  }
}

/**
 * 扫描 reviews/ 的审校报告数据契约（ADR-0018：`ch-NNN-review.json`，verdict pass/fail），
 * 收集未通过审校（FAIL）的章节清单。无 reviews/ 或解析失败的文件跳过、不报错。
 */
export async function scanReviewFailures(projectPath: string): Promise<NovelStatusReviewFailure[]> {
  let fileNames: string[]
  try {
    fileNames = await readdir(join(projectPath, REVIEWS_DIR))
  } catch {
    return []
  }

  const failures: NovelStatusReviewFailure[] = []
  for (const fileName of fileNames) {
    const match = /^ch-(\d+)-review\.json$/i.exec(fileName)
    if (!match) continue

    try {
      const raw = await readFile(join(projectPath, REVIEWS_DIR, fileName), 'utf-8')
      const parsed = JSON.parse(raw) as { verdict?: unknown; chapter?: unknown }
      if (parsed?.verdict !== 'fail') continue
      const chapter = typeof parsed.chapter === 'number' ? parsed.chapter : Number(match[1])
      if (Number.isInteger(chapter)) failures.push({ chapter })
    } catch {
      // 跳过无法解析的审校文件，不影响其它区块。
    }
  }

  return failures.sort((left, right) => left.chapter - right.chapter)
}

export async function aggregateReferenceStatus(projectPath: string): Promise<NovelStatusReferences> {
  try {
    const summary = await getReferenceWorksSummary(projectPath)
    return {
      sourceCount: summary.status.sourceCount,
      guidanceGenerated: summary.status.guidanceExists,
    }
  } catch {
    return { sourceCount: 0, guidanceGenerated: false }
  }
}

/**
 * 状态面板丰富聚合（#240）：只读 memory.db（arc + 伏笔）+ 扫描 reviews/（FAIL 章）+
 * 参考作品状态。任何子项失败都降级为缺省，不让整份快照报错。
 */
export async function collectNovelStatusEnrichment(input: {
  projectPath: string
  currentChapter: number | null
  openMemoryDb: OpenMemoryDb
}): Promise<NovelStatusEnrichment> {
  const { projectPath, currentChapter, openMemoryDb } = input

  let currentArc: NovelStatusArc | null = null
  let foreshadowing: NovelStatusForeshadowing[] = []
  let reader: MemoryDbReader | null = null

  try {
    reader = openMemoryDb(join(projectPath, narracatMemoryDbPath()))
    const memory = aggregateMemoryStatus(reader, currentChapter)
    currentArc = memory.currentArc
    foreshadowing = memory.foreshadowing
  } catch {
    // memory.db 缺失 / 不可读 / 缺表 → arc 显示「未规划」、伏笔显示「无」。
    currentArc = null
    foreshadowing = []
  } finally {
    try {
      reader?.close()
    } catch {
      // ignore close failures
    }
  }

  const [reviewFailures, references] = await Promise.all([
    scanReviewFailures(projectPath),
    aggregateReferenceStatus(projectPath),
  ])

  return { currentArc, foreshadowing, reviewFailures, references }
}
