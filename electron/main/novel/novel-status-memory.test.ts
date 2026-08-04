import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'

import {
  aggregateMemoryStatus,
  aggregateReferenceStatus,
  collectNovelStatusEnrichment,
  scanReviewFailures,
} from './novel-status-memory'
import type { MemoryDbReader, OpenMemoryDb } from './memory-db'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narracat-status-memory-'))
  tempRoots.push(root)
  return root
}

const MEMORY_DDL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE arc_meta (
  novel_id TEXT NOT NULL, arc_id TEXT NOT NULL, volume_no INTEGER NOT NULL, title TEXT NOT NULL,
  chapter_start INTEGER NOT NULL, chapter_end INTEGER NOT NULL, core_question TEXT NOT NULL,
  irreversible_change TEXT NOT NULL, next_arc_seed TEXT NOT NULL DEFAULT '', payoff_beats TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (novel_id, arc_id)
);
CREATE TABLE foreshadowing_registry (
  novel_id TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL,
  planted_chapter INTEGER, target_reveal TEXT, theme_link TEXT, PRIMARY KEY (novel_id, id)
);
CREATE TABLE foreshadowing_actions_log (
  novel_id TEXT NOT NULL, chapter INTEGER NOT NULL, foreshadowing_id TEXT NOT NULL,
  action TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'realized',
  PRIMARY KEY (novel_id, chapter, foreshadowing_id, action, status)
);
`

function makeBunReader(db: Database): MemoryDbReader {
  return {
    all<T = Record<string, unknown>>(sql: string, ...params: Array<string | number | null>): T[] {
      return db.query(sql).all(...params) as T[]
    },
    close(): void {
      db.close()
    },
  }
}

function seededDb(): Database {
  const db = new Database(':memory:')
  db.run(MEMORY_DDL)
  db.run("INSERT INTO meta (key, value) VALUES ('novel_id', 'novel-1')")
  db.run(
    `INSERT INTO arc_meta (novel_id, arc_id, volume_no, title, chapter_start, chapter_end, core_question, irreversible_change, next_arc_seed)
     VALUES ('novel-1', 'arc-1', 1, '边境序章', 1, 10, '主角能否离开边境城？', '主角失去庇护', '新的追兵'),
            ('novel-1', 'arc-2', 2, '远征', 11, 25, '盟友是否可信？', '旧身份暴露', '反攻')`,
  )
  db.run(
    `INSERT INTO foreshadowing_registry (novel_id, id, type, description, planted_chapter, target_reveal)
     VALUES ('novel-1', 'F-001', 'major', '神秘信物', 2, '8'),
            ('novel-1', 'F-002', 'medium', '盟友的旧伤', 5, 'vol-08'),
            ('novel-1', 'F-003', 'small', '未登记动作的伏笔', NULL, '30')`,
  )
  db.run(
    `INSERT INTO foreshadowing_actions_log (novel_id, chapter, foreshadowing_id, action, status)
     VALUES ('novel-1', 2, 'F-001', 'plant', 'realized'),
            ('novel-1', 4, 'F-001', 'develop', 'realized'),
            ('novel-1', 5, 'F-002', 'plant', 'realized'),
            ('novel-1', 6, 'F-002', 'reveal', 'realized')`,
  )
  return db
}

/**
 * 模拟 novel_submit_chapter_outline 预登记 status='planned' develop/reveal 行的场景：
 * F-010 只有计划中的 develop@7 与 reveal@9（均未兑现）+ 一条已兑现 plant@3；
 * F-011 仅有计划中的 reveal@5（连 plant 都未兑现）；
 * F-012 有已兑现 reveal@6（正常已揭示对照）。
 */
function seededDbWithPlanned(): Database {
  const db = new Database(':memory:')
  db.run(MEMORY_DDL)
  db.run("INSERT INTO meta (key, value) VALUES ('novel_id', 'novel-1')")
  db.run(
    `INSERT INTO foreshadowing_registry (novel_id, id, type, description, planted_chapter, target_reveal)
     VALUES ('novel-1', 'F-010', 'major', '仅计划兑现的信物', 3, '8'),
            ('novel-1', 'F-011', 'medium', '从未真正埋设的伏笔', NULL, '12'),
            ('novel-1', 'F-012', 'small', '已兑现揭示的伏笔', 4, '6')`,
  )
  db.run(
    `INSERT INTO foreshadowing_actions_log (novel_id, chapter, foreshadowing_id, action, status)
     VALUES ('novel-1', 3, 'F-010', 'plant', 'realized'),
            ('novel-1', 7, 'F-010', 'develop', 'planned'),
            ('novel-1', 9, 'F-010', 'reveal', 'planned'),
            ('novel-1', 5, 'F-011', 'reveal', 'planned'),
            ('novel-1', 4, 'F-012', 'plant', 'realized'),
            ('novel-1', 6, 'F-012', 'reveal', 'realized')`,
  )
  return db
}

describe('novel status memory aggregation', () => {
  test('selects the arc covering the current chapter', () => {
    const reader = makeBunReader(seededDb())
    const { currentArc } = aggregateMemoryStatus(reader, 12)
    reader.close()

    expect(currentArc).toMatchObject({ arcId: 'arc-2', title: '远征', chapterStart: 11, chapterEnd: 25 })
  })

  test('falls back to the latest arc when no chapter covers it', () => {
    const reader = makeBunReader(seededDb())
    const { currentArc } = aggregateMemoryStatus(reader, null)
    reader.close()

    // chapter_start 最大 = arc-2
    expect(currentArc?.arcId).toBe('arc-2')
  })

  test('derives foreshadowing state from the latest action and flags overdue', () => {
    const reader = makeBunReader(seededDb())
    // currentChapter = 9：F-001 target=8 已过且未 reveal → 临期未兑现
    const { foreshadowing } = aggregateMemoryStatus(reader, 9)
    reader.close()

    const byId = Object.fromEntries(foreshadowing.map((item) => [item.id, item]))
    expect(byId['F-001']).toMatchObject({ state: 'developing', overdue: true, type: 'major' })
    // F-002 已 reveal → 不临期
    expect(byId['F-002']).toMatchObject({ state: 'revealed', overdue: false })
    // F-003 仅登记、无动作 → registered；target vol-08 非数字 → 不临期
    expect(byId['F-003']).toMatchObject({ state: 'registered', overdue: false })
  })

  test('revealed foreshadowing is never overdue even past its target', () => {
    const reader = makeBunReader(seededDb())
    const { foreshadowing } = aggregateMemoryStatus(reader, 100)
    reader.close()

    expect(foreshadowing.find((item) => item.id === 'F-002')?.overdue).toBe(false)
  })

  test('ignores planned (unrealized) develop/reveal actions when deriving state', () => {
    const reader = makeBunReader(seededDbWithPlanned())
    // currentChapter = 10：F-010 的 develop@7 / reveal@9 都是 planned，仅 plant@3 已兑现。
    const { foreshadowing } = aggregateMemoryStatus(reader, 10)
    reader.close()

    const byId = Object.fromEntries(foreshadowing.map((item) => [item.id, item]))
    // 计划中的 develop/reveal 不得让状态前进到 developing/revealed，应停留在 planted。
    expect(byId['F-010'].state).toBe('planted')
    // F-011 连 plant 都是 planned → 无任何已兑现动作 → registered（仅登记，未真正埋设）。
    expect(byId['F-011'].state).toBe('registered')
    // F-012 的 reveal@6 已兑现 → 正常判为已揭示。
    expect(byId['F-012'].state).toBe('revealed')
  })

  test('flags an overdue foreshadowing whose reveal is only planned, not realized', () => {
    const reader = makeBunReader(seededDbWithPlanned())
    // currentChapter = 10：F-010 target=8 已过，且 reveal@9 仅 planned → 真正临期未兑现，应标红。
    const { foreshadowing } = aggregateMemoryStatus(reader, 10)
    reader.close()

    const byId = Object.fromEntries(foreshadowing.map((item) => [item.id, item]))
    expect(byId['F-010']).toMatchObject({ state: 'planted', overdue: true })
    // 对照：F-012 已真正 reveal → 即便过 target 也不临期。
    expect(byId['F-012']).toMatchObject({ state: 'revealed', overdue: false })
  })

  test('scans reviews/ for FAIL chapters (ch-NNN-review.json verdict fail)', async () => {
    const root = await tempProject()
    const reviews = join(root, 'reviews')
    await mkdir(reviews, { recursive: true })
    await writeFile(join(reviews, 'ch-001-review.json'), JSON.stringify({ chapter: 1, verdict: 'pass' }))
    await writeFile(join(reviews, 'ch-003-review.json'), JSON.stringify({ chapter: 3, verdict: 'fail' }))
    await writeFile(join(reviews, 'ch-002-review.json'), JSON.stringify({ chapter: 2, verdict: 'fail' }))
    await writeFile(join(reviews, 'notes.txt'), 'ignored')

    const failures = await scanReviewFailures(root)
    expect(failures).toEqual([{ chapter: 2 }, { chapter: 3 }])
  })

  test('review scan returns empty when reviews/ is missing', async () => {
    const root = await tempProject()
    expect(await scanReviewFailures(root)).toEqual([])
  })

  test('aggregates reference works state without throwing on a bare project', async () => {
    const root = await tempProject()
    const references = await aggregateReferenceStatus(root)
    expect(references).toEqual({ sourceCount: 0, guidanceGenerated: false })
  })

  test('collectNovelStatusEnrichment degrades gracefully when memory.db cannot be opened', async () => {
    const root = await tempProject()
    const throwingOpen: OpenMemoryDb = () => {
      throw new Error('no memory.db')
    }

    const enrichment = await collectNovelStatusEnrichment({
      projectPath: root,
      currentChapter: 5,
      openMemoryDb: throwingOpen,
    })

    expect(enrichment.currentArc).toBeNull()
    expect(enrichment.foreshadowing).toEqual([])
    expect(enrichment.reviewFailures).toEqual([])
    expect(enrichment.references).toEqual({ sourceCount: 0, guidanceGenerated: false })
  })

  test('collectNovelStatusEnrichment wires memory + reviews + references together', async () => {
    const root = await tempProject()
    await mkdir(join(root, 'reviews'), { recursive: true })
    await writeFile(join(root, 'reviews', 'ch-004-review.json'), JSON.stringify({ chapter: 4, verdict: 'fail' }))

    const db = seededDb()
    const openMemoryDb: OpenMemoryDb = () => makeBunReader(db)

    const enrichment = await collectNovelStatusEnrichment({
      projectPath: root,
      currentChapter: 12,
      openMemoryDb,
    })

    expect(enrichment.currentArc?.arcId).toBe('arc-2')
    expect(enrichment.foreshadowing?.length).toBe(3)
    expect(enrichment.reviewFailures).toEqual([{ chapter: 4 }])
    expect(enrichment.references).toEqual({ sourceCount: 0, guidanceGenerated: false })
  })
})
