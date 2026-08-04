import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MemoryDbReader, OpenMemoryDb } from './memory-db'
import { readCharacterStateSnapshot } from './character-state'

const UID = '11111111-1111-4111-8111-111111111111'
const OTHER_UID = '22222222-2222-4222-8222-222222222222'

const MEMORY_DDL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  subject_character_uid TEXT,
  subject_character_b_uid TEXT,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  sector TEXT NOT NULL DEFAULT 'semantic',
  from_chapter INTEGER NOT NULL,
  event_chapter INTEGER,
  invalidated_at_chapter INTEGER,
  invalidated_by TEXT,
  source TEXT NOT NULL DEFAULT 'extracted',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  secret_known INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE character_cards (
  novel_id TEXT NOT NULL,
  character_uid TEXT NOT NULL,
  character TEXT NOT NULL,
  as_of_chapter INTEGER NOT NULL,
  card_json TEXT NOT NULL,
  PRIMARY KEY (novel_id, character_uid)
);
CREATE TABLE chapter_summaries (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  summary TEXT NOT NULL,
  UNIQUE(novel_id, chapter)
);
`

/** 老库镜像（未经引擎 v19 迁移）：facts 无 secret_known 列，App 只读须容忍。 */
const LEGACY_DDL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  subject_character_uid TEXT,
  subject_character_b_uid TEXT,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  sector TEXT NOT NULL DEFAULT 'semantic',
  from_chapter INTEGER NOT NULL,
  event_chapter INTEGER,
  invalidated_at_chapter INTEGER,
  invalidated_by TEXT,
  source TEXT NOT NULL DEFAULT 'extracted',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE character_cards (
  novel_id TEXT NOT NULL,
  character_uid TEXT NOT NULL,
  character TEXT NOT NULL,
  as_of_chapter INTEGER NOT NULL,
  card_json TEXT NOT NULL,
  PRIMARY KEY (novel_id, character_uid)
);
CREATE TABLE chapter_summaries (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  summary TEXT NOT NULL,
  UNIQUE(novel_id, chapter)
);
`

/**
 * 更老库镜像（未经引擎 v17 迁移）：facts 连 source 列都没有——真机 dogfood 只读副本验证
 * 发现的真实存量库形态（片4 收尾，见 factsHasSource）。
 */
const PRE_SOURCE_LEGACY_DDL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  subject_character_uid TEXT,
  subject_character_b_uid TEXT,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  sector TEXT NOT NULL DEFAULT 'semantic',
  from_chapter INTEGER NOT NULL,
  event_chapter INTEGER,
  invalidated_at_chapter INTEGER,
  invalidated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE character_cards (
  novel_id TEXT NOT NULL,
  character_uid TEXT NOT NULL,
  character TEXT NOT NULL,
  as_of_chapter INTEGER NOT NULL,
  card_json TEXT NOT NULL,
  PRIMARY KEY (novel_id, character_uid)
);
CREATE TABLE chapter_summaries (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  summary TEXT NOT NULL,
  UNIQUE(novel_id, chapter)
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

interface ProjectSeed {
  vocabulary?: unknown
  entityJson?: unknown
  entityName?: string
  facts?: FactSeed[]
  card?: { asOfChapter: number; cardJson: unknown }
  withDb?: boolean
  completedChapters?: number[]
  /** 自定义建库 DDL（默认 MEMORY_DDL）——老库缺列场景传 LEGACY_DDL / PRE_SOURCE_LEGACY_DDL */
  ddl?: string
  /** 生产库真实形态：meta 表从未写入 novel_id（引擎侧无写入口）。默认 false（测试历来手工补种）。 */
  skipNovelId?: boolean
}

interface FactSeed {
  id: string
  predicate: string
  object: string
  fromChapter: number
  eventChapter?: number | null
  invalidatedAtChapter?: number | null
  invalidatedBy?: string | null
  source?: string
  subject?: string
  bUid?: string | null
  createdAt?: string
  /** secret_known 列值（0/1）；库无该列时忽略。默认 0（未知晓）。 */
  secretKnown?: number
}

async function createProject(input: ProjectSeed): Promise<{ projectPath: string; openMemoryDb: OpenMemoryDb }> {
  const projectPath = await mkdtemp(join(tmpdir(), 'narracat-character-state-'))
  await mkdir(join(projectPath, 'bible', 'characters'), { recursive: true })

  if (input.vocabulary !== undefined) {
    await writeFile(join(projectPath, 'bible', 'state-vocabulary.json'), JSON.stringify(input.vocabulary), 'utf8')
  }
  if (input.entityJson !== undefined) {
    await writeFile(
      join(projectPath, 'bible', 'characters', `${input.entityName ?? '张三'}.json`),
      JSON.stringify(input.entityJson),
      'utf8',
    )
  }

  if (input.withDb !== false) {
    await mkdir(join(projectPath, '.narracat'), { recursive: true })
    const db = new Database(join(projectPath, '.narracat', 'memory.db'), { create: true })
    db.exec(input.ddl ?? MEMORY_DDL)
    if (!input.skipNovelId) {
      db.query("INSERT INTO meta (key, value) VALUES ('novel_id', 'novel-1')").run()
    }
    const factColumns = db.query('PRAGMA table_info(facts)').all() as Array<{ name: string }>
    const hasSecretKnown = factColumns.some((column) => column.name === 'secret_known')
    const hasSource = factColumns.some((column) => column.name === 'source')
    for (const fact of input.facts ?? []) {
      db.query(
        `INSERT INTO facts (id, novel_id, subject, subject_character_uid, subject_character_b_uid,
           predicate, object, from_chapter, event_chapter, invalidated_at_chapter, invalidated_by, created_at${hasSource ? ', source' : ''}${hasSecretKnown ? ', secret_known' : ''})
         VALUES (?, 'novel-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${hasSource ? ', ?' : ''}${hasSecretKnown ? ', ?' : ''})`,
      ).run(
        fact.id,
        fact.subject ?? '张三',
        UID,
        fact.bUid ?? null,
        fact.predicate,
        fact.object,
        fact.fromChapter,
        fact.eventChapter ?? fact.fromChapter,
        fact.invalidatedAtChapter ?? null,
        fact.invalidatedBy ?? null,
        fact.createdAt ?? '2026-07-13 00:00:00',
        ...(hasSource ? [fact.source ?? 'extracted'] : []),
        ...(hasSecretKnown ? [fact.secretKnown ?? 0] : []),
      )
    }
    if (input.card) {
      db.query(
        "INSERT INTO character_cards (novel_id, character_uid, character, as_of_chapter, card_json) VALUES ('novel-1', ?, '张三', ?, ?)",
      ).run(UID, input.card.asOfChapter, JSON.stringify(input.card.cardJson))
    }
    for (const chapter of input.completedChapters ?? []) {
      db.query(
        "INSERT INTO chapter_summaries (id, novel_id, chapter, summary) VALUES (?, 'novel-1', ?, '摘要')",
      ).run(`s-${chapter}`, chapter)
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

function snapshotInput(projectPath: string, openMemoryDb: OpenMemoryDb) {
  return { projectPath, characterUid: UID, characterName: '张三', openMemoryDb }
}

describe('readCharacterStateSnapshot', () => {
  test('memory.db 缺失时 available=false', async () => {
    const { projectPath, openMemoryDb } = await createProject({ withDb: false })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    expect(snapshot.available).toBe(false)
  })

  test('有库无数据时返回空快照（UI 空态提示用）', async () => {
    const { projectPath, openMemoryDb } = await createProject({ vocabulary: VOCABULARY })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    expect(snapshot.available).toBe(true)
    expect(snapshot.hasVocabulary).toBe(true)
    expect(snapshot.card).toEqual([])
    expect(snapshot.timeline).toEqual([])
    expect(snapshot.relationships).toEqual([])
    expect(snapshot.asOfChapter).toBeNull()
  })

  test('meta 表无 novel_id（生产库真实形态）时全表读兜底，非 UNAVAILABLE_SNAPSHOT', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      skipNovelId: true,
      vocabulary: VOCABULARY,
      facts: [{ id: 'f1', predicate: 'possession', object: '短刀', fromChapter: 5 }],
      card: { asOfChapter: 5, cardJson: { possession: '短刀' } },
      completedChapters: [1, 2, 3],
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    expect(snapshot.available).toBe(true)
    expect(snapshot.card.length).toBeGreaterThan(0)
    expect(snapshot.asOfChapter).toBe(5)
    expect(snapshot.latestCompletedChapter).toBe(3)
  })

  test('老库无 source 列（未经引擎 v17 迁移）时快照仍可用，source 兜底 extracted', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      ddl: PRE_SOURCE_LEGACY_DDL,
      vocabulary: VOCABULARY,
      facts: [{ id: 'f1', predicate: 'possession', object: '短刀', fromChapter: 5 }],
      card: { asOfChapter: 5, cardJson: { possession: '短刀' } },
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    expect(snapshot.available).toBe(true)
    expect(snapshot.card.length).toBeGreaterThan(0)
    // 无 _v: 2 标记走 v1 扁平卡降级路径（原谓词名展示，见 buildCardEntries）
    const possession = snapshot.card.find((entry) => entry.key === 'possession')
    expect(possession?.values[0]?.source).toBe('extracted')
  })

  test('v2 维度卡按词表序渲染，extracted 关联出章号与来源', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [
        { id: 'f1', predicate: 'ability', object: '练气', fromChapter: 0, invalidatedAtChapter: 8, source: 'authored' },
        { id: 'f2', predicate: 'ability', object: '筑基', fromChapter: 8, createdAt: '2026-07-13 00:01:00' },
        { id: 'f3', predicate: 'possession', object: '短刀', fromChapter: 5 },
        { id: 'f4', predicate: 'possession', object: '令牌', fromChapter: 9, createdAt: '2026-07-13 00:02:00' },
        { id: 'f5', predicate: 'reputation', object: '外门第一', fromChapter: 7 },
      ],
      card: {
        asOfChapter: 9,
        cardJson: {
          _v: 2,
          dimensions: {
            inventory: { display_name: '持有物', predicate: 'possession', values: ['短刀', '令牌'] },
            cultivation_level: { display_name: '境界', predicate: 'ability', value: '筑基' },
          },
          extras: { reputation: ['外门第一'] },
        },
      },
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))

    expect(snapshot.asOfChapter).toBe(9)
    // 词表声明序在前（境界→持有物），extras 殿后
    expect(snapshot.card.map((entry) => entry.key)).toEqual(['cultivation_level', 'inventory', 'reputation'])
    const level = snapshot.card[0]
    expect(level.displayName).toBe('境界')
    expect(level.cardinality).toBe('one')
    expect(level.values).toEqual([{ value: '筑基', source: 'extracted', chapter: 8, factId: 'f2', secretKnown: null }])
    const inventory = snapshot.card[1]
    expect(inventory.values.map((item) => item.value)).toEqual(['短刀', '令牌'])
    expect(inventory.values[0]).toEqual({ value: '短刀', source: 'extracted', chapter: 5, factId: 'f3', secretKnown: null })
    // extras 区谓词回退走受控词表中文映射（真机走查回报：裸英文作者看不懂）
    expect(snapshot.card[2].displayName).toBe('名声')
  })

  test('时间线按维度分组、章升序，失效行保留并带标记', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [
        { id: 'f1', predicate: 'ability', object: '练气', fromChapter: 0, invalidatedAtChapter: 8, source: 'authored' },
        { id: 'f2', predicate: 'ability', object: '筑基', fromChapter: 8, createdAt: '2026-07-13 00:01:00' },
        { id: 'f3', predicate: 'possession', object: '铁剑', fromChapter: 2, invalidatedAtChapter: 5 },
        { id: 'f4', predicate: 'possession', object: '短刀', fromChapter: 5, createdAt: '2026-07-13 00:01:30' },
      ],
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))

    const level = snapshot.timeline.find((group) => group.key === 'cultivation_level')
    expect(level?.events).toEqual([
      { factId: 'f1', value: '练气', chapter: 0, source: 'authored', invalidated: true, invalidatedAtChapter: 8, revoked: null, secretKnown: null },
      { factId: 'f2', value: '筑基', chapter: 8, source: 'extracted', invalidated: false, invalidatedAtChapter: null, revoked: null, secretKnown: null },
    ])
    const inventory = snapshot.timeline.find((group) => group.key === 'inventory')
    expect(inventory?.events.map((event) => event.value)).toEqual(['铁剑', '短刀'])
    expect(inventory?.events[0]?.invalidated).toBe(true)
    expect(inventory?.events[0]?.revoked).toBeNull()
  })

  test('从未生效行：invalidated_at_chapter<=自身生效章判 revoked，invalidated_by 区分修正/作废；自然顶替行 revoked=null', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [
        // 被修正：作者纠错，取代者 id 非空
        {
          id: 'f1',
          predicate: 'ability',
          object: '练气',
          fromChapter: 3,
          invalidatedAtChapter: 3,
          invalidatedBy: 'f1-fix',
          createdAt: '2026-07-13 00:00:00',
        },
        // 被作废：单纯撤回，无取代者
        {
          id: 'f2',
          predicate: 'possession',
          object: '错误物品',
          fromChapter: 4,
          invalidatedAtChapter: 4,
          invalidatedBy: null,
          createdAt: '2026-07-13 00:00:10',
        },
        // 自然顶替：invalidated_at_chapter(8) > 自身生效章(0)，正常演变非从未生效
        {
          id: 'f3',
          predicate: 'ability',
          object: '筑基',
          fromChapter: 0,
          invalidatedAtChapter: 8,
          createdAt: '2026-07-13 00:00:20',
        },
      ],
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    const level = snapshot.timeline.find((group) => group.key === 'cultivation_level')
    const corrected = level?.events.find((event) => event.value === '练气')
    const naturallyReplaced = level?.events.find((event) => event.value === '筑基')
    expect(corrected?.revoked).toBe('corrected')
    expect(naturallyReplaced?.revoked).toBeNull()
    const inventory = snapshot.timeline.find((group) => group.key === 'inventory')
    expect(inventory?.events[0]?.revoked).toBe('retracted')
  })

  test('关系区从 relationship facts 独立渲染，另一端名字拆自 subject', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [
        { id: 'r1', predicate: 'relationship', object: '师徒', fromChapter: 3, subject: '张三|李四', bUid: OTHER_UID },
      ],
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    expect(snapshot.relationships).toEqual([{ otherName: '李四', state: '师徒', chapter: 3, source: 'extracted' }])
    // relationship 不进单角色维度时间线（spec §3.2）
    expect(snapshot.timeline.some((group) => group.key === 'relationship')).toBe(false)
  })

  test('无词表时 v1 扁平卡与时间线按谓词降级，展示名走受控词表中文映射', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      facts: [{ id: 'f1', predicate: 'ability', object: '筑基', fromChapter: 8 }],
      card: { asOfChapter: 8, cardJson: { ability: '筑基' } },
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    expect(snapshot.hasVocabulary).toBe(false)
    expect(snapshot.dimensions).toEqual([])
    expect(snapshot.card).toEqual([
      { key: 'ability', displayName: '能力', cardinality: 'many', values: [{ value: '筑基', source: 'extracted', chapter: 8, factId: 'f1', secretKnown: null }] },
    ])
    expect(snapshot.timeline[0]?.displayName).toBe('能力')
  })

  test('实体 json 身份摘要随快照返回，uid 不匹配时忽略', async () => {
    const matched = await createProject({
      vocabulary: VOCABULARY,
      entityJson: { character_uid: UID, name: '张三', gender: '女', age: '十六' },
    })
    const matchedSnapshot = await readCharacterStateSnapshot(snapshotInput(matched.projectPath, matched.openMemoryDb))
    expect(matchedSnapshot.identity).toEqual({ gender: '女', age: '十六', aliases: [] })

    const mismatched = await createProject({
      vocabulary: VOCABULARY,
      entityJson: { character_uid: OTHER_UID, name: '张三', gender: '男' },
    })
    const mismatchedSnapshot = await readCharacterStateSnapshot(snapshotInput(mismatched.projectPath, mismatched.openMemoryDb))
    expect(mismatchedSnapshot.identity).toBeNull()
  })

  test('characterName 含路径逃逸时不读项目外文件，identity 降级为 null（其余字段不受影响）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [{ id: 'f1', predicate: 'ability', object: '筑基', fromChapter: 8 }],
    })
    // 项目根目录（bible/characters 之外）放一个攻击者可控的 json
    await writeFile(join(projectPath, 'evil.json'), JSON.stringify({ character_uid: UID, gender: '男' }), 'utf8')

    const snapshot = await readCharacterStateSnapshot({
      projectPath,
      characterUid: UID,
      characterName: '../../evil',
      openMemoryDb,
    })
    expect(snapshot.identity).toBeNull()
    expect(snapshot.available).toBe(true)
    expect(snapshot.timeline.length).toBeGreaterThan(0)
  })

  test('卡里的值在 facts 中对不上时按 extracted/null 兜底（诚实方向）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      card: {
        asOfChapter: 3,
        cardJson: {
          _v: 2,
          dimensions: { cultivation_level: { display_name: '境界', predicate: 'ability', value: '金丹' } },
          extras: {},
        },
      },
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    expect(snapshot.card[0]?.values).toEqual([{ value: '金丹', source: 'extracted', chapter: null, factId: null, secretKnown: null }])
  })

  test('同章 authored+extracted 两行：时间线内 authored 排在 extracted 之后（§3.3 折叠 tiebreak）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [
        // 同一维度、同一发生章，不同持有物值区分两行，用来断言排序而非归属
        {
          id: 'f1',
          predicate: 'possession',
          object: '先到的extracted',
          fromChapter: 8,
          source: 'extracted',
          createdAt: '2026-07-13 00:00:01',
        },
        {
          id: 'f2',
          predicate: 'possession',
          object: '后到的authored',
          fromChapter: 8,
          source: 'authored',
          createdAt: '2026-07-13 00:00:00',
        },
      ],
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    const inventory = snapshot.timeline.find((group) => group.key === 'inventory')
    // created_at 更早的 authored 行仍排在 extracted 之后：authored tiebreak 优先于 created_at
    expect(inventory?.events.map((event) => event.value)).toEqual(['先到的extracted', '后到的authored'])
  })

  test('同章同值 authored+extracted 并存：卡面该值反查 source 为 authored（不再误标待确认）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [
        { id: 'f1', predicate: 'ability', object: '筑基', fromChapter: 8, source: 'extracted', createdAt: '2026-07-13 00:00:00' },
        { id: 'f2', predicate: 'ability', object: '筑基', fromChapter: 8, source: 'authored', createdAt: '2026-07-13 00:00:01' },
      ],
      card: {
        asOfChapter: 8,
        cardJson: {
          _v: 2,
          dimensions: { cultivation_level: { display_name: '境界', predicate: 'ability', value: '筑基' } },
          extras: {},
        },
      },
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    expect(snapshot.card[0]?.values).toEqual([{ value: '筑基', source: 'authored', chapter: 8, factId: 'f2', secretKnown: null }])
  })

  test('词表维度定义随快照返回（编辑控件契约：enum 带值域、free 空值域）', async () => {
    const { projectPath, openMemoryDb } = await createProject({ vocabulary: VOCABULARY })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    expect(snapshot.dimensions).toEqual([
      { key: 'cultivation_level', displayName: '境界', cardinality: 'one', valueType: 'enum', values: ['练气', '筑基', '金丹'] },
      { key: 'inventory', displayName: '持有物', cardinality: 'many', valueType: 'free', values: [] },
    ])
  })

  test('最新完成章独立于角色卡返回：书写到第 20 章而角色无卡时不回落 0（生效章默认值口径）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      completedChapters: [1, 5, 20],
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    expect(snapshot.asOfChapter).toBeNull()
    expect(snapshot.latestCompletedChapter).toBe(20)
  })

  test('无完成章时最新完成章为 0（新书初始设定语义）', async () => {
    const { projectPath, openMemoryDb } = await createProject({ vocabulary: VOCABULARY })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    expect(snapshot.latestCompletedChapter).toBe(0)
  })

  test('实体 json 存在且 uid 匹配时身份字段可全空（出生证编辑入口判定），别名随摘要返回', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      entityJson: { character_uid: UID, name: '张三', aliases: ['三郎', '剑圣'] },
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    expect(snapshot.identity).toEqual({ gender: null, age: null, aliases: ['三郎', '剑圣'] })
  })

  test('secret 事实带 secretKnown 标记贯通快照；非 secret 事实为 null', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [
        { id: 'f1', predicate: 'ability', object: '筑基', fromChapter: 8 },
        { id: 's1', predicate: 'secret', object: '身怀隐藏血脉', fromChapter: 3, secretKnown: 1 },
        { id: 's2', predicate: 'secret', object: '灭门真凶另有其人', fromChapter: 5, secretKnown: 0, createdAt: '2026-07-13 00:00:10' },
      ],
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    const secretGroup = snapshot.timeline.find((g) => g.key === 'secret' || g.displayName.includes('秘密'))
    expect(secretGroup?.events.map((e) => e.secretKnown)).toEqual([true, false])
    const abilityGroup = snapshot.timeline.find((g) => g.key === 'cultivation_level')
    expect(abilityGroup?.events.every((e) => e.secretKnown === null)).toBe(true)
  })

  test('老库无 secret_known 列：不崩，secret 事实按未知晓（false）处理', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      ddl: LEGACY_DDL,
      facts: [{ id: 's1', predicate: 'secret', object: '身怀隐藏血脉', fromChapter: 3 }],
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    const secretEvents = snapshot.timeline.flatMap((g) => g.events).filter((e) => e.secretKnown !== null)
    expect(secretEvents.length).toBeGreaterThan(0)
    expect(secretEvents.every((e) => e.secretKnown === false)).toBe(true)
  })

  test('fail-closed 回归：card_json 有 secret 值但时间线锚不到对应事实 → secretKnown=false（外审 P1-2）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      card: {
        asOfChapter: 3,
        cardJson: {
          _v: 2,
          dimensions: {},
          extras: { secret: ['陈年秘辛'] },
        },
      },
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    const secretEntry = snapshot.card.find((entry) => entry.key === 'secret')
    expect(secretEntry?.values[0]?.secretKnown).toBe(false) // 不是 null——锚不到的 secret 必须 fail-closed
    expect(secretEntry?.values[0]?.factId).toBeNull()
  })

  test('PR#458 P1 回归：卡值反查须按 as_of_chapter 截断，同值未来已打标 secret 不得越界泄露', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [
        // 第3章：同一个秘密，未打标（secret_known=0）——卡值 as_of=5 时应反查到这行
        { id: 's-early', predicate: 'secret', object: '同一个秘密', fromChapter: 3, secretKnown: 0 },
        // 第10章：同值但已打标（secret_known=1）——超出 as_of=5，绝不能被反查命中
        {
          id: 's-late',
          predicate: 'secret',
          object: '同一个秘密',
          fromChapter: 10,
          secretKnown: 1,
          createdAt: '2026-07-13 00:01:00',
        },
      ],
      card: {
        asOfChapter: 5,
        cardJson: { _v: 2, dimensions: {}, extras: { secret: ['同一个秘密'] } },
      },
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    const secretEntry = snapshot.card.find((entry) => entry.key === 'secret')
    expect(secretEntry?.values[0]?.secretKnown).toBe(false)
    expect(secretEntry?.values[0]?.factId).toBe('s-early')
  })

  test('#459 回归：词表把 slot 的 key 改绑到别的谓词后，fail-closed 判定仍按 card_json 自带 predicate 走（卡自带优先）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      // 词表在卡片物化后被编辑：同 key hidden_secret 已改绑到非 secret 谓词 rumor——
      // 若 App 按词表推导谓词，锚不到事实的 secret 值会被误判为普通谓词（secretKnown=null，
      // 丢失 fail-closed），与引擎折叠时写进 card_json 的谓词漂移
      vocabulary: {
        dimensions: [
          { key: 'hidden_secret', predicate: 'rumor', display_name: '传闻', cardinality: 'many', value_type: 'free' },
        ],
      },
      card: {
        asOfChapter: 3,
        cardJson: {
          _v: 2,
          // 卡自带 predicate: 'secret'（引擎折叠时从当时命中的词表维度写入，是 SSOT）
          dimensions: { hidden_secret: { display_name: '秘密', predicate: 'secret', values: ['身怀隐藏血脉'] } },
          extras: {},
        },
      },
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    const secretEntry = snapshot.card.find((entry) => entry.key === 'hidden_secret')
    // 反查落空（无事实行）+ 卡自带谓词为 secret → 必须 fail-closed（false），不得因词表改绑退成 null
    expect(secretEntry?.values[0]?.secretKnown).toBe(false)
    expect(secretEntry?.values[0]?.factId).toBeNull()
  })

  test('#459 回归（回退层）：旧 v2 卡 slot 无 predicate 字段时退回词表定义，secret 维度仍 fail-closed', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      // 引擎写入 predicate 之前物化的存量 v2 卡：slot 只有 display_name/values。
      // 换向后词表从首选降为回退层——若回退被误删，谓词会退成 key 本身
      //（hidden_secret ≠ secret），secretKnown 从 false（fail-closed）漂成 null 泄密
      vocabulary: {
        dimensions: [
          { key: 'hidden_secret', predicate: 'secret', display_name: '秘密', cardinality: 'many', value_type: 'free' },
        ],
      },
      card: {
        asOfChapter: 3,
        cardJson: {
          _v: 2,
          dimensions: { hidden_secret: { display_name: '秘密', values: ['身怀隐藏血脉'] } },
          extras: {},
        },
      },
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    const secretEntry = snapshot.card.find((entry) => entry.key === 'hidden_secret')
    // 反查落空（无事实行）+ 词表回退出 secret 谓词 → 必须 fail-closed（false），不得退成 null
    expect(secretEntry?.values[0]?.secretKnown).toBe(false)
    expect(secretEntry?.values[0]?.factId).toBeNull()
  })

  test('PR#458 P1 回归：非 secret 谓词同构场景，反查截断对 provenance（factId/chapter/source）本身同样生效', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [
        // 第3章：同值 extracted
        { id: 'a-early', predicate: 'ability', object: '筑基', fromChapter: 3, source: 'extracted' },
        // 第10章：同值但 authored——超出 as_of=5，反查不得越界命中（哪怕 authored 优先级更高）
        {
          id: 'a-late',
          predicate: 'ability',
          object: '筑基',
          fromChapter: 10,
          source: 'authored',
          createdAt: '2026-07-13 00:01:00',
        },
      ],
      card: {
        asOfChapter: 5,
        cardJson: {
          _v: 2,
          dimensions: { cultivation_level: { display_name: '境界', predicate: 'ability', value: '筑基' } },
          extras: {},
        },
      },
    })
    const snapshot = await readCharacterStateSnapshot(snapshotInput(projectPath, openMemoryDb))
    const level = snapshot.card.find((entry) => entry.key === 'cultivation_level')
    expect(level?.values[0]).toEqual({ value: '筑基', source: 'extracted', chapter: 3, factId: 'a-early', secretKnown: null })
  })
})
