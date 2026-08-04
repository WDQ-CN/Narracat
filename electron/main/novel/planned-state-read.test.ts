import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MemoryDbReader, OpenMemoryDb } from './memory-db'
import {
  readChapterPlannedState,
  readCharacterFuturePlans,
  readPlannedStateCounts,
} from './planned-state-read'

const UID_A = '11111111-1111-4111-8111-111111111111'
const UID_B = '22222222-2222-4222-8222-222222222222'

const MEMORY_DDL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE planned_state_changes (
  id                   TEXT PRIMARY KEY,
  novel_id             TEXT NOT NULL,
  chapter              INTEGER NOT NULL,
  character_uid        TEXT NOT NULL,
  character_name       TEXT NOT NULL,
  dimension            TEXT NOT NULL,
  operation            TEXT NOT NULL CHECK(operation IN ('set','add','remove')),
  value                TEXT NOT NULL,
  reason               TEXT,
  status               TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','delivered','deferred','cancelled','acknowledged')),
  deferred_to_chapter  INTEGER,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
`

const VOCABULARY = {
  dimensions: [
    {
      key: 'cultivation_level',
      predicate: 'ability',
      display_name: '境界',
      cardinality: 'one',
      value_type: 'enum',
      values: ['练气', '筑基', '金丹'],
    },
    {
      key: 'inventory',
      predicate: 'possession',
      display_name: '持有物',
      cardinality: 'many',
      value_type: 'free',
    },
  ],
}

interface PlannedRowSeed {
  id: string
  /** 行所属小说（默认 'novel-1'，与 meta 种子一致）；用于验证过滤语义。 */
  novelId?: string
  chapter: number
  characterUid?: string
  characterName?: string
  dimension: string
  operation?: 'set' | 'add' | 'remove'
  value: string
  reason?: string | null
  status?: string
  deferredToChapter?: number | null
}

interface ProjectSeed {
  vocabulary?: unknown
  characters?: Array<{ fileName: string; json: unknown }>
  rows?: PlannedRowSeed[]
  withDb?: boolean
  /** 是否往 meta 表种 novel_id（默认 true）；false 用于模拟引擎回填前的存量库形态。 */
  seedNovelId?: boolean
  outline?: { vol: number; chapter: number; json: unknown }
  /** state.yaml 原始行（未提供时不写该文件，模拟 readWrittenChapterSet 读取失败降级）。 */
  stateYamlLines?: string[]
  /** 需要预先落盘的正文文件（flat manuscript/ 或 manuscript/vol-NN/ 均可，只判存在性）。 */
  manuscripts?: string[]
}

async function createProject(input: ProjectSeed = {}): Promise<{ projectPath: string; openMemoryDb: OpenMemoryDb }> {
  const projectPath = await mkdtemp(join(tmpdir(), 'narracat-planned-state-'))
  await mkdir(join(projectPath, 'bible', 'characters'), { recursive: true })

  if (input.vocabulary !== undefined) {
    await writeFile(join(projectPath, 'bible', 'state-vocabulary.json'), JSON.stringify(input.vocabulary), 'utf8')
  }
  for (const character of input.characters ?? []) {
    await writeFile(
      join(projectPath, 'bible', 'characters', character.fileName),
      typeof character.json === 'string' ? character.json : JSON.stringify(character.json),
      'utf8',
    )
  }
  if (input.outline) {
    const volDir = join(projectPath, 'outline', `vol-${String(input.outline.vol).padStart(2, '0')}`)
    await mkdir(volDir, { recursive: true })
    const base = `ch-${String(input.outline.chapter).padStart(3, '0')}`
    await writeFile(join(volDir, `${base}.json`), JSON.stringify(input.outline.json), 'utf8')
  }
  if (input.stateYamlLines) {
    await mkdir(join(projectPath, '.narracat'), { recursive: true })
    await writeFile(join(projectPath, '.narracat', 'state.yaml'), input.stateYamlLines.join('\n'), 'utf8')
  }
  for (const relativePath of input.manuscripts ?? []) {
    const target = join(projectPath, relativePath)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, '# 正文\n\n已完成写作。\n', 'utf8')
  }

  if (input.withDb !== false) {
    await mkdir(join(projectPath, '.narracat'), { recursive: true })
    const db = new Database(join(projectPath, '.narracat', 'memory.db'), { create: true })
    db.exec(MEMORY_DDL)
    if (input.seedNovelId !== false) {
      db.query("INSERT INTO meta (key, value) VALUES ('novel_id', 'novel-1')").run()
    }
    for (const row of input.rows ?? []) {
      db.query(
        `INSERT INTO planned_state_changes
           (id, novel_id, chapter, character_uid, character_name, dimension, operation, value, reason, status, deferred_to_chapter)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id,
        row.novelId ?? 'novel-1',
        row.chapter,
        row.characterUid ?? UID_A,
        row.characterName ?? '张三',
        row.dimension,
        row.operation ?? 'set',
        row.value,
        row.reason ?? null,
        row.status ?? 'planned',
        row.deferredToChapter ?? null,
      )
    }
    db.close()
  }

  const openMemoryDb: OpenMemoryDb = (dbPath: string): MemoryDbReader => {
    const readerDb = new Database(dbPath, { readonly: true })
    return {
      all<T>(sql: string, ...params: Array<string | number | null>): T[] {
        return readerDb.query(sql).all(...(params as never[])) as T[]
      },
      close(): void {
        readerDb.close()
      },
    }
  }

  return { projectPath, openMemoryDb }
}

describe('readChapterPlannedState', () => {
  test('全字段映射与按 rowid 排序', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      rows: [
        { id: 'p2', chapter: 5, dimension: 'inventory', operation: 'add', value: '短刀', reason: '拾获', status: 'planned' },
        { id: 'p1', chapter: 5, dimension: 'cultivation_level', operation: 'set', value: '筑基', status: 'delivered' },
        { id: 'p3', chapter: 9, dimension: 'inventory', operation: 'remove', value: '短刀', status: 'planned' },
      ],
    })
    const snapshot = await readChapterPlannedState({ projectPath, chapter: 5, openMemoryDb })
    expect(snapshot.available).toBe(true)
    // 插入序 p2 → p1（rowid ASC），且只取 chapter=5，chapter=9 的 p3 不在内
    expect(snapshot.rows).toEqual([
      {
        id: 'p2',
        chapter: 5,
        status: 'planned',
        deferredToChapter: null,
        characterUid: UID_A,
        characterName: '张三',
        dimension: 'inventory',
        operation: 'add',
        value: '短刀',
        reason: '拾获',
      },
      {
        id: 'p1',
        chapter: 5,
        status: 'delivered',
        deferredToChapter: null,
        characterUid: UID_A,
        characterName: '张三',
        dimension: 'cultivation_level',
        operation: 'set',
        value: '筑基',
        reason: null,
      },
    ])
  })

  test('deferred 行携带 deferredToChapter', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      rows: [{ id: 'p1', chapter: 5, dimension: 'inventory', value: '短刀', status: 'deferred', deferredToChapter: 8 }],
    })
    const snapshot = await readChapterPlannedState({ projectPath, chapter: 5, openMemoryDb })
    expect(snapshot.rows[0]?.status).toBe('deferred')
    expect(snapshot.rows[0]?.deferredToChapter).toBe(8)
  })

  test('词表缺失时 dimensions=[]，行照常展示', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      rows: [{ id: 'p1', chapter: 5, dimension: 'cultivation_level', value: '筑基' }],
    })
    const snapshot = await readChapterPlannedState({ projectPath, chapter: 5, openMemoryDb })
    expect(snapshot.available).toBe(true)
    expect(snapshot.dimensions).toEqual([])
    expect(snapshot.rows.length).toBe(1)
  })

  test('词表存在时 dimensions 按定义映射（enum 带值域、free 省略 values）', async () => {
    const { projectPath, openMemoryDb } = await createProject({ vocabulary: VOCABULARY })
    const snapshot = await readChapterPlannedState({ projectPath, chapter: 5, openMemoryDb })
    expect(snapshot.dimensions).toEqual([
      { key: 'cultivation_level', displayName: '境界', cardinality: 'one', valueType: 'enum', values: ['练气', '筑基', '金丹'] },
      { key: 'inventory', displayName: '持有物', cardinality: 'many', valueType: 'free' },
    ])
  })

  test('章纲 json 缺失时 jsonStateChanges=null', async () => {
    const { projectPath, openMemoryDb } = await createProject({ vocabulary: VOCABULARY })
    const snapshot = await readChapterPlannedState({ projectPath, chapter: 5, openMemoryDb })
    expect(snapshot.jsonStateChanges).toBeNull()
  })

  test('章纲 json 存在但无 state_changes 字段时 jsonStateChanges=[]（区别于文件缺失的 null，CAS 基线可用）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      outline: { vol: 1, chapter: 5, json: { chapter: 5, title: '无状态变更的章' } },
    })
    const snapshot = await readChapterPlannedState({ projectPath, chapter: 5, openMemoryDb })
    expect(snapshot.jsonStateChanges).toEqual([])
  })

  test('章纲 json 存在且有 state_changes 字段时原样返回作为 CAS 基线', async () => {
    const stateChanges = [{ character: { name: '张三' }, dimension: 'inventory', operation: 'add', value: '短刀' }]
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      outline: { vol: 1, chapter: 5, json: { chapter: 5, title: '有状态变更', state_changes: stateChanges } },
    })
    const snapshot = await readChapterPlannedState({ projectPath, chapter: 5, openMemoryDb })
    expect(snapshot.jsonStateChanges).toEqual(stateChanges)
  })

  test('角色列表来自 bible/characters/*.json，坏文件跳过，一次 readdir 无 N+1', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      characters: [
        { fileName: '张三.json', json: { character_uid: UID_A, name: '张三' } },
        { fileName: '李四.json', json: { character_uid: UID_B, name: '李四' } },
        { fileName: '坏文件.json', json: '{not valid json' },
        { fileName: '缺字段.json', json: { character_uid: 'x' } },
      ],
    })
    const snapshot = await readChapterPlannedState({ projectPath, chapter: 5, openMemoryDb })
    expect(snapshot.characters).toEqual(
      expect.arrayContaining([
        { uid: UID_A, name: '张三' },
        { uid: UID_B, name: '李四' },
      ]),
    )
    expect(snapshot.characters.length).toBe(2)
  })

  test('meta 有 novel_id 时按其过滤，异 novel_id 行被排除', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      rows: [
        { id: 'p-mine', chapter: 7, dimension: 'cultivation_level', value: '筑基' },
        { id: 'p-other', novelId: 'novel-2', chapter: 7, dimension: 'cultivation_level', value: '金丹' },
      ],
    })
    const snapshot = await readChapterPlannedState({ projectPath, chapter: 7, openMemoryDb })
    expect(snapshot.available).toBe(true)
    expect(snapshot.rows.map((row) => row.id)).toEqual(['p-mine'])
  })

  test('meta 无 novel_id 的存量库仍能读出本章计划（单库单小说全表读兜底）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      seedNovelId: false,
      rows: [{ id: 'p-1', chapter: 7, dimension: 'cultivation_level', value: '筑基' }],
    })
    const snapshot = await readChapterPlannedState({ projectPath, chapter: 7, openMemoryDb })
    expect(snapshot.available).toBe(true)
    expect(snapshot.rows.map((row) => row.id)).toEqual(['p-1'])
  })

  test('memory.db 缺失时 available=false 全链降级（骨架字段皆空/null）', async () => {
    const { projectPath, openMemoryDb } = await createProject({ withDb: false, vocabulary: VOCABULARY })
    const snapshot = await readChapterPlannedState({ projectPath, chapter: 5, openMemoryDb })
    expect(snapshot).toEqual({ available: false, rows: [], dimensions: [], characters: [], jsonStateChanges: null })
  })
})

describe('readCharacterFuturePlans', () => {
  test('只回该角色 status=planned 的行，按章升序', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      rows: [
        { id: 'p1', chapter: 9, characterUid: UID_A, dimension: 'inventory', value: '令牌', status: 'planned' },
        { id: 'p2', chapter: 5, characterUid: UID_A, dimension: 'cultivation_level', value: '筑基', status: 'planned' },
        { id: 'p3', chapter: 6, characterUid: UID_A, dimension: 'inventory', value: '旧物', status: 'delivered' },
        { id: 'p4', chapter: 7, characterUid: UID_B, dimension: 'inventory', value: '别人的', status: 'planned' },
      ],
    })
    const snapshot = await readCharacterFuturePlans({ projectPath, characterUid: UID_A, openMemoryDb })
    expect(snapshot.available).toBe(true)
    expect(snapshot.rows.map((row) => row.id)).toEqual(['p2', 'p1'])
    expect(snapshot.rows.every((row) => row.status === 'planned')).toBe(true)
  })

  test('meta 无 novel_id 的存量库仍能读出该角色未来计划（单库单小说全表读兜底）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      seedNovelId: false,
      rows: [{ id: 'p-1', chapter: 12, dimension: 'cultivation_level', value: '金丹' }],
    })
    const snapshot = await readCharacterFuturePlans({ projectPath, characterUid: UID_A, openMemoryDb })
    expect(snapshot.available).toBe(true)
    expect(snapshot.rows.map((row) => row.id)).toEqual(['p-1'])
  })

  test('memory.db 缺失时 available=false，rows 为空', async () => {
    const { projectPath, openMemoryDb } = await createProject({ withDb: false })
    const snapshot = await readCharacterFuturePlans({ projectPath, characterUid: UID_A, openMemoryDb })
    expect(snapshot).toEqual({ available: false, rows: [] })
  })

  test('新书（零完成章）→ 未写章过滤不漏任何行，全部计划照常返回（评审 P2-1：不能按最大完成章过滤）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      stateYamlLines: ['progress:', '  completed_chapters: []', ''],
      rows: [
        { id: 'p1', chapter: 1, characterUid: UID_A, dimension: 'inventory', value: '木剑', status: 'planned' },
        { id: 'p2', chapter: 3, characterUid: UID_A, dimension: 'cultivation_level', value: '筑基', status: 'planned' },
      ],
    })
    const snapshot = await readCharacterFuturePlans({ projectPath, characterUid: UID_A, openMemoryDb })
    expect(snapshot.rows.map((row) => row.id)).toEqual(['p1', 'p2'])
  })

  test('断档：第 10 章已完成且已写正文、第 8 章未完成 → 第 8 章计划包含，第 10 章计划排除', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      stateYamlLines: [
        'progress:',
        '  completed_chapters: [10]',
        'structure:',
        '  chapter_to_volume:',
        '    8: 1',
        '    10: 1',
        '',
      ],
      manuscripts: [join('manuscript', 'vol-01', 'ch-010.md')],
      rows: [
        { id: 'p-ch8', chapter: 8, characterUid: UID_A, dimension: 'inventory', value: '玉简', status: 'planned' },
        { id: 'p-ch10', chapter: 10, characterUid: UID_A, dimension: 'inventory', value: '丹药', status: 'planned' },
      ],
    })
    const snapshot = await readCharacterFuturePlans({ projectPath, characterUid: UID_A, openMemoryDb })
    expect(snapshot.rows.map((row) => row.id)).toEqual(['p-ch8'])
  })

  test('第 8 章在 completed_chapters 内但正文文件缺失（missing-manuscript）→ 仍按未写章包含', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      stateYamlLines: ['progress:', '  completed_chapters: [8]', 'structure:', '  chapter_to_volume:', '    8: 1', ''],
      // 故意不落盘 manuscript/vol-01/ch-008.md：completed 标记与正文产物不同步
      rows: [{ id: 'p-ch8', chapter: 8, characterUid: UID_A, dimension: 'inventory', value: '玉简', status: 'planned' }],
    })
    const snapshot = await readCharacterFuturePlans({ projectPath, characterUid: UID_A, openMemoryDb })
    expect(snapshot.rows.map((row) => row.id)).toEqual(['p-ch8'])
  })
})

describe('readPlannedStateCounts', () => {
  test('按章聚合 status=planned 行数，其它状态不计入', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      rows: [
        { id: 'p1', chapter: 5, dimension: 'inventory', value: 'a', status: 'planned' },
        { id: 'p2', chapter: 5, dimension: 'cultivation_level', value: 'b', status: 'planned' },
        { id: 'p3', chapter: 5, dimension: 'inventory', value: 'c', status: 'delivered' },
        { id: 'p4', chapter: 9, dimension: 'inventory', value: 'd', status: 'planned' },
        { id: 'p5', chapter: 12, dimension: 'inventory', value: 'e', status: 'cancelled' },
      ],
    })
    const counts = await readPlannedStateCounts({ projectPath, openMemoryDb })
    expect(counts).toEqual({ '5': 2, '9': 1 })
  })

  test('memory.db 打不开时返回空对象', async () => {
    const { projectPath, openMemoryDb } = await createProject({ withDb: false })
    const counts = await readPlannedStateCounts({ projectPath, openMemoryDb })
    expect(counts).toEqual({})
  })

  test('meta 无 novel_id 的存量库仍能计数（单库单小说全表读兜底）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      seedNovelId: false,
      rows: [
        { id: 'p-1', chapter: 5, dimension: 'cultivation_level', value: '筑基' },
        { id: 'p-2', chapter: 9, dimension: 'inventory', operation: 'add', value: '玉简' },
      ],
    })
    const counts = await readPlannedStateCounts({ projectPath, openMemoryDb })
    expect(counts).toEqual({ '5': 1, '9': 1 })
  })
})
