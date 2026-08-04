import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'

import { buildCharacterSituationPack } from './character-chat-situation'
import type { MemoryDbReader, OpenMemoryDb } from '../novel/memory-db'

const SU = '11111111-1111-4111-8111-111111111111'
const AJIU = '22222222-2222-4222-8222-222222222222'
const SHEN = '33333333-3333-4333-8333-333333333333'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

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
  characters TEXT NOT NULL DEFAULT '[]',
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
  characters TEXT NOT NULL DEFAULT '[]',
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

interface FactSeed {
  id: string
  subject: string
  subjectUid: string | null
  subjectBUid?: string | null
  predicate: string
  object: string
  fromChapter: number
  eventChapter?: number | null
  invalidatedAtChapter?: number | null
  invalidatedBy?: string | null
  source?: string
  secretKnown?: number
  createdAt?: string
}

interface CharacterFileSeed {
  fileName: string
  uid: string
  name: string
}

interface ChapterSummarySeed {
  chapter: number
  characterUids?: string[]
}

interface ProjectSeed {
  vocabulary?: unknown
  facts?: FactSeed[]
  card?: { characterUid: string; asOfChapter: number; cardJson: unknown }
  characterFiles?: CharacterFileSeed[]
  chapterSummaries?: ChapterSummarySeed[]
  /** 自定义建库 DDL（默认 MEMORY_DDL）——老库缺列场景传 LEGACY_DDL */
  ddl?: string
  /** 生产库真实形态：meta 表从未写入 novel_id（引擎侧无写入口）。默认 false（测试历来手工补种）。 */
  skipNovelId?: boolean
}

async function createProject(input: ProjectSeed): Promise<{ projectPath: string; openMemoryDb: OpenMemoryDb }> {
  const projectPath = await mkdtemp(join(tmpdir(), 'narracat-situation-pack-'))
  tempRoots.push(projectPath)
  await mkdir(join(projectPath, 'bible', 'characters'), { recursive: true })
  await mkdir(join(projectPath, '.narracat'), { recursive: true })

  if (input.vocabulary !== undefined) {
    await writeFile(join(projectPath, 'bible', 'state-vocabulary.json'), JSON.stringify(input.vocabulary), 'utf8')
  }

  for (const file of input.characterFiles ?? []) {
    await writeFile(
      join(projectPath, 'bible', 'characters', `${file.fileName}.md`),
      `<!-- character_identity: {"character_uid":"${file.uid}","name":"${file.name}"} -->\n# ${file.name}\n`,
      'utf-8',
    )
  }

  const db = new Database(join(projectPath, '.narracat', 'memory.db'), { create: true })
  db.exec(input.ddl ?? MEMORY_DDL)
  if (!input.skipNovelId) {
    db.query("INSERT INTO meta (key, value) VALUES ('novel_id', 'novel-1')").run()
  }

  const factColumns = db.query('PRAGMA table_info(facts)').all() as Array<{ name: string }>
  const hasSecretKnown = factColumns.some((column) => column.name === 'secret_known')
  for (const fact of input.facts ?? []) {
    db.query(
      `INSERT INTO facts (id, novel_id, subject, subject_character_uid, subject_character_b_uid,
         predicate, object, from_chapter, event_chapter, invalidated_at_chapter, invalidated_by, source, created_at${hasSecretKnown ? ', secret_known' : ''})
       VALUES (?, 'novel-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${hasSecretKnown ? ', ?' : ''})`,
    ).run(
      fact.id,
      fact.subject,
      fact.subjectUid ?? null,
      fact.subjectBUid ?? null,
      fact.predicate,
      fact.object,
      fact.fromChapter,
      fact.eventChapter ?? fact.fromChapter,
      fact.invalidatedAtChapter ?? null,
      fact.invalidatedBy ?? null,
      fact.source ?? 'extracted',
      fact.createdAt ?? '2026-07-13 00:00:00',
      ...(hasSecretKnown ? [fact.secretKnown ?? 0] : []),
    )
  }

  if (input.card) {
    db.query(
      "INSERT INTO character_cards (novel_id, character_uid, character, as_of_chapter, card_json) VALUES ('novel-1', ?, '角色', ?, ?)",
    ).run(input.card.characterUid, input.card.asOfChapter, JSON.stringify(input.card.cardJson))
  }

  for (const summary of input.chapterSummaries ?? []) {
    db.query(
      "INSERT INTO chapter_summaries (id, novel_id, chapter, summary, characters) VALUES (?, 'novel-1', ?, '摘要', ?)",
    ).run(
      `s-${summary.chapter}`,
      summary.chapter,
      JSON.stringify((summary.characterUids ?? []).map((uid) => ({ character_uid: uid }))),
    )
  }

  db.close()

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

describe('buildCharacterSituationPack', () => {
  test('三区完整组装：header 截至章 + 状态 + 关系分组 + 亲历倒序', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      card: {
        characterUid: SU,
        asOfChapter: 11,
        cardJson: {
          _v: 2,
          dimensions: {
            cultivation_level: { display_name: '境界', predicate: 'ability', value: '筑基' },
            inventory: { display_name: '持有物', predicate: 'possession', values: ['短刀', '令牌'] },
          },
          extras: {},
        },
      },
      facts: [
        { id: 'r1', subject: '苏见|阿九', subjectUid: SU, subjectBUid: AJIU, predicate: 'relationship', object: '相识', fromChapter: 6 },
        { id: 'r2', subject: '苏见|阿九', subjectUid: SU, subjectBUid: AJIU, predicate: 'relationship', object: '结伴', fromChapter: 9 },
        { id: 'r3', subject: '苏见|阿九', subjectUid: SU, subjectBUid: AJIU, predicate: 'relationship', object: '过命交情', fromChapter: 11 },
        { id: 'r4', subject: '苏见|沈知言', subjectUid: SU, subjectBUid: SHEN, predicate: 'relationship', object: '师徒', fromChapter: 7 },
        { id: 'e1', subject: '苏见', subjectUid: SU, predicate: 'location', object: '清河镇', fromChapter: 11 },
        { id: 'e2', subject: '苏见', subjectUid: SU, predicate: 'status', object: '甩脱追兵', fromChapter: 9 },
      ],
    })
    const pack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: 11,
      openMemoryDb,
    })
    expect(pack).toContain('【你当前的处境】（截至第 11 章）')
    expect(pack).toContain('你的状态：')
    expect(pack).toContain('境界=筑基')
    expect(pack).toContain('· 阿九：')
    expect(pack.indexOf('（第6章）')).toBeLessThan(pack.indexOf('（第11章）')) // 单对象内按章升序
    expect(pack).toContain('· 第11章')
    expect(pack.indexOf('· 第11章')).toBeLessThan(pack.indexOf('· 第9章')) // 亲历区最近在前
  })

  test('meta 表无 novel_id（生产库真实形态）时仍组出关系区+亲历区，非全空', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      skipNovelId: true,
      vocabulary: VOCABULARY,
      facts: [
        { id: 'r1', subject: '苏见|阿九', subjectUid: SU, subjectBUid: AJIU, predicate: 'relationship', object: '结伴', fromChapter: 9 },
        { id: 'e1', subject: '苏见', subjectUid: SU, predicate: 'location', object: '清河镇', fromChapter: 11 },
      ],
    })
    const pack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: 11,
      openMemoryDb,
    })
    expect(pack).toContain('· 阿九：')
    expect(pack).toContain('清河镇')
  })

  test('secret 纪律：未知晓不入（亲历+状态卡），已知晓放行', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      card: {
        characterUid: SU,
        asOfChapter: 6,
        cardJson: { _v: 2, dimensions: {}, extras: { secret: ['灭门真凶', '身怀隐藏血脉'] } },
      },
      facts: [
        { id: 's1', subject: '苏见', subjectUid: SU, predicate: 'secret', object: '灭门真凶', fromChapter: 3, secretKnown: 0 },
        { id: 's2', subject: '苏见', subjectUid: SU, predicate: 'secret', object: '身怀隐藏血脉', fromChapter: 5, secretKnown: 1 },
      ],
    })
    const pack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: 6,
      openMemoryDb,
    })
    expect(pack).not.toContain('灭门真凶') // 未知晓
    expect(pack).toContain('身怀隐藏血脉') // 已知晓
  })

  test('POV 洁净：别人主语的非关系事实不入（暗中盘算不泄露）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [
        { id: 'g1', subject: '沈知言', subjectUid: SHEN, predicate: 'goal', object: '暗中盘算杀苏见', fromChapter: 5 },
        { id: 'e1', subject: '苏见', subjectUid: SU, predicate: 'location', object: '清河镇', fromChapter: 5 },
      ],
    })
    const pack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: 5,
      openMemoryDb,
    })
    expect(pack).not.toContain('杀苏见')
    expect(pack).toContain('清河镇')
  })

  test('时间边界：生效章>边界的事实不入（未来钦定不泄露）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [
        { id: 'f1', subject: '苏见', subjectUid: SU, predicate: 'ability', object: '金丹', fromChapter: 20, eventChapter: 20, source: 'authored' },
        { id: 'f2', subject: '苏见', subjectUid: SU, predicate: 'ability', object: '筑基', fromChapter: 8 },
      ],
    })
    const pack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: 11,
      openMemoryDb,
    })
    expect(pack).not.toContain('金丹')
    expect(pack).toContain('筑基')
  })

  test('有效性：纠错作废行不入，自然顶替行保留', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [
        // 作废行：invalidated_at_chapter(4) <= 自身生效章(4)，从未生效
        { id: 'bad', subject: '苏见', subjectUid: SU, predicate: 'ability', object: '抽错的境界', fromChapter: 4, invalidatedAtChapter: 4, invalidatedBy: 'fix1' },
        // 顶替行：invalidated_at_chapter(8) > 自身生效章(1)，自然演变
        { id: 'good', subject: '苏见', subjectUid: SU, predicate: 'ability', object: '练气', fromChapter: 1, invalidatedAtChapter: 8 },
      ],
    })
    const pack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: 10,
      openMemoryDb,
    })
    expect(pack).not.toContain('抽错的境界')
    expect(pack).toContain('练气')
  })

  test('预算截断：9 个关系对象出 8 个；单对象 4 条取最新 3 条；亲历 16 条出 15 条', async () => {
    const relationshipFacts: FactSeed[] = []
    // 对象1..9 各 1 条关系（第1..9章）
    for (let i = 1; i <= 9; i += 1) {
      relationshipFacts.push({
        id: `rel-${i}`,
        subject: `苏见|对象${i}`,
        subjectUid: SU,
        predicate: 'relationship',
        object: `与对象${i}相识`,
        fromChapter: i,
      })
    }
    // 对象1 另补 3 条（共 4 条：第1/10/11/12 章），第1章那条应被单对象上限（3）截掉
    relationshipFacts.push(
      { id: 'rel-1-old', subject: '苏见|对象1', subjectUid: SU, predicate: 'relationship', object: '对象1最早那条的object', fromChapter: 1 },
      { id: 'rel-1-b', subject: '苏见|对象1', subjectUid: SU, predicate: 'relationship', object: '对象1第二条', fromChapter: 10 },
      { id: 'rel-1-c', subject: '苏见|对象1', subjectUid: SU, predicate: 'relationship', object: '对象1第三条', fromChapter: 11 },
      { id: 'rel-1-d', subject: '苏见|对象1', subjectUid: SU, predicate: 'relationship', object: '对象1第四条', fromChapter: 12 },
    )
    // 覆盖对象1原本第1章那条（改名以免与上面 rel-1-old 撞同一 id 语义混淆——直接去掉原循环里对象1那条）
    const dedupedRelationshipFacts = relationshipFacts.filter((fact) => fact.id !== 'rel-1')

    const experienceFacts: FactSeed[] = []
    for (let i = 1; i <= 16; i += 1) {
      experienceFacts.push({
        id: `exp-${i}`,
        subject: '苏见',
        subjectUid: SU,
        predicate: 'status',
        object: i === 1 ? '最旧的那条亲历object' : `亲历第${i}章`,
        fromChapter: i,
      })
    }

    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      facts: [...dedupedRelationshipFacts, ...experienceFacts],
    })
    const pack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: 30,
      openMemoryDb,
    })
    expect(pack).not.toContain('对象1最早那条的object') // 单对象第 4 旧条被截
    expect((pack.match(/^· /gm) ?? []).length).toBe(8 + 15) // 8 个关系行 + 15 条亲历行
    expect(pack).not.toContain('最旧的那条亲历object') // 第 16 旧条被截
  })

  test('无词表降级原谓词名', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      facts: [{ id: 'e1', subject: '苏见', subjectUid: SU, predicate: 'location', object: '清河镇', fromChapter: 5 }],
    })
    const pack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: 5,
      openMemoryDb,
    })
    expect(pack).toContain('location：清河镇')
  })

  test('空态与边界：零事实返回空串；knowledgeBoundaryChapter=null 返回空串', async () => {
    const { projectPath, openMemoryDb } = await createProject({ vocabulary: VOCABULARY })
    const emptyPack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: 5,
      openMemoryDb,
    })
    expect(emptyPack).toBe('')

    const nullBoundaryPack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: null,
      openMemoryDb,
    })
    expect(nullBoundaryPack).toBe('')
  })

  test('老库无 secret_known 列：secret 全排除，不崩', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      ddl: LEGACY_DDL,
      facts: [
        { id: 's1', subject: '苏见', subjectUid: SU, predicate: 'secret', object: '灭门真凶', fromChapter: 3 },
        { id: 'e1', subject: '苏见', subjectUid: SU, predicate: 'location', object: '清河镇', fromChapter: 5 },
      ],
    })
    const pack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: 5,
      openMemoryDb,
    })
    expect(pack).not.toContain('灭门真凶')
    expect(pack).toContain('清河镇')
  })

  test('对方名以 uid 解析 canonical 名：角色改名后不把旧名当对方（外审 P1-3）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: VOCABULARY,
      characterFiles: [
        { fileName: '阿九', uid: AJIU, name: '阿九' },
        { fileName: '沈老', uid: SHEN, name: '沈老' }, // 沈知言已改名为沈老
      ],
      chapterSummaries: [{ chapter: 1, characterUids: [AJIU, SHEN] }],
      facts: [
        // subject 里的「旧名」是本角色的旧称，counterpart uid 才是权威身份
        { id: 'r1', subject: '旧名|阿九', subjectUid: SU, subjectBUid: AJIU, predicate: 'relationship', object: '过命交情', fromChapter: 5 },
        { id: 'r2', subject: '苏见|沈知言', subjectUid: SU, subjectBUid: SHEN, predicate: 'relationship', object: '师徒', fromChapter: 6 },
      ],
    })
    const pack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: 10,
      openMemoryDb,
    })
    expect(pack).toContain('· 阿九：')
    expect(pack).toContain('· 沈老：') // 用当前 canonical 名
    expect(pack).not.toContain('· 旧名：') // 不被 subject 旧串骗
  })

  test('同谓词双维度归属：ability 同时是境界(enum)与剑法(free)时按值归对维度（外审 P2-5）', async () => {
    const { projectPath, openMemoryDb } = await createProject({
      vocabulary: {
        dimensions: [
          { key: 'cultivation_level', predicate: 'ability', display_name: '境界', cardinality: 'one', value_type: 'enum', values: ['练气', '筑基'] },
          { key: 'sword_art', predicate: 'ability', display_name: '剑法', cardinality: 'many', value_type: 'free' },
        ],
      },
      facts: [
        { id: 'f1', subject: '苏见', subjectUid: SU, predicate: 'ability', object: '筑基', fromChapter: 5 },
        { id: 'f2', subject: '苏见', subjectUid: SU, predicate: 'ability', object: '御剑术', fromChapter: 6 },
      ],
    })
    const pack = await buildCharacterSituationPack({
      projectPath,
      characterUid: SU,
      characterName: '苏见',
      knowledgeBoundaryChapter: 10,
      openMemoryDb,
    })
    expect(pack).toContain('境界：筑基')
    expect(pack).toContain('剑法：御剑术')
    expect(pack).not.toContain('境界：御剑术')
  })

  test('契约哨兵：引擎 F3 判据与排序口径未漂移（App 直读例外的对齐锚，见 ADR）', async () => {
    const engineSource = await readFile(
      join(import.meta.dir, '../../../agent-core/narracat/mcp-server/src/handlers/character-entity.ts'),
      'utf-8',
    )
    // App 的 NOT_REVOKED_SQL 镜像引擎 F3「只拒从未生效行」判据；引擎侧改口径时此测试先红
    expect(engineSource).toContain('invalidated_at_chapter')
    expect(engineSource).toContain('只拒「从未生效」行')
  })
})
