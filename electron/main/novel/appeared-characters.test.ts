import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'

import {
  aggregateAppearedSeen,
  aggregatePromotedCandidateChapters,
  buildContactList,
  enrichContactsWithStatuses,
  parseCharacterAliases,
  parseCharacterBasicInfo,
  readAppearedCharacterContacts,
  scanCharacterSettings,
  type CharacterSettingEntry,
} from './appeared-characters'
import type { MemoryDbReader, OpenMemoryDb } from './memory-db'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narracat-appeared-'))
  tempRoots.push(root)
  return root
}

const MEMORY_DDL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE chapter_summaries (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter INTEGER NOT NULL,
  summary TEXT NOT NULL, characters TEXT NOT NULL DEFAULT '[]',
  UNIQUE(novel_id, chapter)
);
CREATE TABLE facts (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, subject TEXT NOT NULL,
  subject_character_uid TEXT, subject_character_b_uid TEXT,
  predicate TEXT NOT NULL, object TEXT NOT NULL, sector TEXT NOT NULL DEFAULT 'character',
  from_chapter INTEGER NOT NULL, invalidated_at_chapter INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE character_cards (
  novel_id TEXT NOT NULL, character_uid TEXT NOT NULL, character TEXT NOT NULL,
  as_of_chapter INTEGER NOT NULL, card_json TEXT NOT NULL,
  PRIMARY KEY (novel_id, character_uid)
);
CREATE TABLE candidate_characters (
  novel_id TEXT NOT NULL, character_uid TEXT NOT NULL, name TEXT NOT NULL,
  note TEXT, proposed_chapter INTEGER, source TEXT NOT NULL DEFAULT 'write',
  status TEXT NOT NULL DEFAULT 'candidate',
  PRIMARY KEY (novel_id, character_uid)
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

const UID_LIN = '11111111-1111-4111-8111-111111111111'
const UID_SU = '22222222-2222-4222-8222-222222222222'
const UID_FUTURE = '33333333-3333-4333-8333-333333333333'
// 已建档配角：在第 2 章出场但抽取漏登记 chapter_summaries，仅以 promoted 候选记录其出场章（镇岳堂伤者那一类）。
const UID_BIT = '44444444-4444-4444-8444-444444444444'

/** 已入库三章：林衍在 1/2/3 出场，苏暮只在 3 出场；未来角色不在任何已入库章。 */
function seededDb(): Database {
  const db = new Database(':memory:')
  db.run(MEMORY_DDL)
  db.run("INSERT INTO meta (key, value) VALUES ('novel_id', 'novel-1')")
  const ref = (uid: string, name: string) => ({ character_uid: uid, name })
  db.run(
    `INSERT INTO chapter_summaries (id, novel_id, chapter, summary, characters) VALUES
     ('s1', 'novel-1', 1, '第一章', ?),
     ('s2', 'novel-1', 2, '第二章', ?),
     ('s3', 'novel-1', 3, '第三章', ?)`,
    JSON.stringify([ref(UID_LIN, '林衍')]),
    JSON.stringify([ref(UID_LIN, '林衍')]),
    JSON.stringify([ref(UID_LIN, '林衍'), ref(UID_SU, '苏暮')]),
  )
  db.run(
    `INSERT INTO facts
      (id, novel_id, subject, subject_character_uid, subject_character_b_uid, predicate, object, from_chapter, created_at)
     VALUES
      ('f1', 'novel-1', '林衍', ?, NULL, 'status', '刚脱离追杀，右臂带伤', 2, '2026-01-01T00:00:00Z'),
      ('f2', 'novel-1', '林衍', ?, NULL, 'status', '刚赢下一场硬战，右臂伤势未愈', 3, '2026-01-02T00:00:00Z')`,
    UID_LIN,
    UID_LIN,
  )
  db.run(
    `INSERT INTO character_cards (novel_id, character_uid, character, as_of_chapter, card_json)
     VALUES ('novel-1', ?, '苏暮', 3, ?)`,
    UID_SU,
    JSON.stringify({ status: '刚救回伤员，精神紧绷' }),
  )
  return db
}

async function seedCharacterFiles(projectPath: string): Promise<void> {
  const dir = join(projectPath, 'bible', 'characters')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, '林衍.md'),
    `<!-- character_identity: {"character_uid":"${UID_LIN}","name":"林衍"} -->\n# 林衍\n\n- 别名: 阿衍、剑奴\n\n## 基本信息\n- 全名：林衍\n- 年龄：26 岁，具体（留白）\n- 外貌特征：（留白）\n- 职业：浪迹剑客\n\n## 核心矛盾\n背负血仇又厌恶杀戮。`,
    'utf-8',
  )
  await writeFile(
    join(dir, '苏暮.md'),
    `<!-- character_identity: {"character_uid":"${UID_SU}","name":"苏暮"} -->\n# 苏暮\n医者。`,
    'utf-8',
  )
  // 未来角色：有档案但从未在已入库章出场 → 不应成为联系人。
  await writeFile(
    join(dir, '未来反派.md'),
    `<!-- character_identity: {"character_uid":"${UID_FUTURE}","name":"未来反派"} -->\n# 未来反派\n只在大纲里。`,
    'utf-8',
  )
  // 无 character_identity 的草稿档案 → 视为未建档，不入表。
  await writeFile(join(dir, '路人甲.md'), `# 路人甲\n没有身份注释。`, 'utf-8')
}

describe('aggregateAppearedSeen', () => {
  test('first/last seen 与知识边界来自 chapter_summaries 结构化列', () => {
    const reader = makeBunReader(seededDb())
    const { seenByUid, knowledgeBoundaryChapter } = aggregateAppearedSeen(reader)
    reader.close()

    expect(knowledgeBoundaryChapter).toBe(3)
    expect(seenByUid.get(UID_LIN)).toEqual({ firstAppearedChapter: 1, lastSeenChapter: 3 })
    expect(seenByUid.get(UID_SU)).toEqual({ firstAppearedChapter: 3, lastSeenChapter: 3 })
    expect(seenByUid.has(UID_FUTURE)).toBe(false)
  })

  test('空库（无章入库）边界为 null', () => {
    const db = new Database(':memory:')
    db.run(MEMORY_DDL)
    db.run("INSERT INTO meta (key, value) VALUES ('novel_id', 'novel-1')")
    const reader = makeBunReader(db)
    const { seenByUid, knowledgeBoundaryChapter } = aggregateAppearedSeen(reader)
    reader.close()
    expect(knowledgeBoundaryChapter).toBeNull()
    expect(seenByUid.size).toBe(0)
  })
})

describe('parseCharacterAliases', () => {
  test('按、，/；切分，去空与「（留白）」占位', () => {
    expect(parseCharacterAliases('# 角\n- 别名: 阿衍、剑奴 / 衍哥')).toEqual(['阿衍', '剑奴', '衍哥'])
    expect(parseCharacterAliases('- 别名：单名')).toEqual(['单名'])
  })

  test('无别名行 / 留白 / 空 → 空数组', () => {
    expect(parseCharacterAliases('# 角\n冷峻剑客。')).toEqual([])
    expect(parseCharacterAliases('- 别名: （留白）')).toEqual([])
    expect(parseCharacterAliases('- 别名:   ')).toEqual([])
  })
})

describe('parseCharacterBasicInfo', () => {
  test('解析「## 基本信息」键值字段；跳过「全名」、清掉内联「（留白）」', () => {
    const content =
      '## 基本信息\n- 全名：陆停舟\n- 年龄：推测二十多岁，具体（留白）\n- 性别：男\n- 外貌特征：（留白）\n- 职业：情绪回收师\n\n## 性格特质\n- 核心性格：外冷内稳'
    expect(parseCharacterBasicInfo(content)).toEqual([
      { label: '年龄', value: '推测二十多岁' },
      { label: '性别', value: '男' },
      { label: '职业', value: '情绪回收师' },
    ])
  })

  test('无基本信息小节 → 空数组（不取性格/核心矛盾等上帝视角字段）', () => {
    expect(parseCharacterBasicInfo('## 核心矛盾\n背负血仇。')).toEqual([])
    expect(parseCharacterBasicInfo('# 林衍\n冷峻剑客。')).toEqual([])
  })
})

describe('scanCharacterSettings', () => {
  test('只纳入含 character_identity 的档案，settingPath 为相对项目根正斜杠路径', async () => {
    const project = await tempProject()
    await seedCharacterFiles(project)
    const entries = await scanCharacterSettings(project)
    const byUid = new Map(entries.map((entry) => [entry.characterUid, entry]))

    expect(byUid.get(UID_LIN)?.settingPath).toBe('bible/characters/林衍.md')
    expect(byUid.get(UID_LIN)?.name).toBe('林衍')
    // 同一次读取顺手解析展示字段：别名 + 基本信息（跳过「全名」、清掉内联「（留白）」、整段留白字段丢弃；核心矛盾等上帝视角字段不取）
    expect(byUid.get(UID_LIN)?.aliases).toEqual(['阿衍', '剑奴'])
    expect(byUid.get(UID_LIN)?.basicInfo).toEqual([
      { label: '年龄', value: '26 岁' },
      { label: '职业', value: '浪迹剑客' },
    ])
    // 苏暮档案无别名 / 基本信息 → 优雅降级为空
    expect(byUid.get(UID_SU)?.aliases).toEqual([])
    expect(byUid.get(UID_SU)?.basicInfo).toEqual([])
    // 路人甲无身份注释 → 不在表内
    expect(entries.some((entry) => entry.name === '路人甲')).toBe(false)
  })

  test('无 characters 目录返回空数组', async () => {
    const project = await tempProject()
    expect(await scanCharacterSettings(project)).toEqual([])
  })
})

describe('buildContactList', () => {
  test('只保留已建档 ∩ 已出场，排除未来大纲角色，按首次出场升序', () => {
    const seenByUid = new Map([
      [UID_LIN, { firstAppearedChapter: 1, lastSeenChapter: 3 }],
      [UID_SU, { firstAppearedChapter: 3, lastSeenChapter: 3 }],
    ])
    const settings: CharacterSettingEntry[] = [
      { characterUid: UID_LIN, name: '林衍', settingPath: 'bible/characters/林衍.md' },
      { characterUid: UID_SU, name: '苏暮', settingPath: 'bible/characters/苏暮.md' },
      { characterUid: UID_FUTURE, name: '未来反派', settingPath: 'bible/characters/未来反派.md' },
    ]

    const { contacts, knowledgeBoundaryChapter } = buildContactList(seenByUid, 3, settings)
    expect(knowledgeBoundaryChapter).toBe(3)
    expect(contacts.map((contact) => contact.characterUid)).toEqual([UID_LIN, UID_SU])
    expect(contacts.find((contact) => contact.characterUid === UID_FUTURE)).toBeUndefined()
    expect(contacts[0].firstAppearedChapter).toBe(1)
    expect(contacts[1].firstAppearedChapter).toBe(3)
  })

  test('把 NovelMemory 角色状态下沉到联系人契约', () => {
    const seenByUid = new Map([
      [UID_LIN, { firstAppearedChapter: 1, lastSeenChapter: 3 }],
      [UID_SU, { firstAppearedChapter: 3, lastSeenChapter: 3 }],
    ])
    const settings: CharacterSettingEntry[] = [
      { characterUid: UID_LIN, name: '林衍', settingPath: 'bible/characters/林衍.md' },
      { characterUid: UID_SU, name: '苏暮', settingPath: 'bible/characters/苏暮.md' },
    ]

    const { contacts } = buildContactList(
      seenByUid,
      3,
      settings,
      new Map([
        [UID_LIN, '刚赢下一场硬战，右臂伤势未愈'],
        [UID_SU, '刚救回伤员，精神紧绷'],
      ]),
    )

    expect(contacts.map((contact) => contact.currentStatus)).toEqual([
      '刚赢下一场硬战，右臂伤势未愈',
      '刚救回伤员，精神紧绷',
    ])
  })

  test('已出场但无确认档案的 uid 不纳入（避免拼出无设定联系人）', () => {
    const seenByUid = new Map([[UID_LIN, { firstAppearedChapter: 1, lastSeenChapter: 1 }]])
    const { contacts } = buildContactList(seenByUid, 1, [])
    expect(contacts).toEqual([])
  })

  test('放宽：已建档 promoted 配角即便抽取漏登记，也按 proposed_chapter 纳入', () => {
    const seenByUid = new Map([[UID_LIN, { firstAppearedChapter: 1, lastSeenChapter: 3 }]])
    const settings: CharacterSettingEntry[] = [
      { characterUid: UID_LIN, name: '林衍', settingPath: 'bible/characters/林衍.md' },
      { characterUid: UID_BIT, name: '镇岳堂伤者', settingPath: 'bible/characters/镇岳堂伤者.md' },
    ]
    const promoted = new Map([[UID_BIT, 2]])

    const { contacts } = buildContactList(seenByUid, 3, settings, undefined, promoted)
    const bit = contacts.find((c) => c.characterUid === UID_BIT)
    expect(bit).toBeDefined()
    // 抽取漏登记 → 用 proposed_chapter 作为首/末出场章
    expect(bit?.firstAppearedChapter).toBe(2)
    expect(bit?.lastSeenChapter).toBe(2)
    // 仍按首次出场升序：林衍(1) 在前
    expect(contacts.map((c) => c.characterUid)).toEqual([UID_LIN, UID_BIT])
  })

  test('放宽不越界：promoted 候选出场章未写完（> 知识边界）不纳入', () => {
    const settings: CharacterSettingEntry[] = [
      { characterUid: UID_BIT, name: '镇岳堂伤者', settingPath: 'bible/characters/镇岳堂伤者.md' },
    ]
    // 出场章 5 > 已完成边界 3 → 还没真出场，排除
    const { contacts } = buildContactList(new Map(), 3, settings, undefined, new Map([[UID_BIT, 5]]))
    expect(contacts).toEqual([])
  })

  test('放宽仅限已建档：promoted 候选无身份档（不在 settings）不纳入', () => {
    const { contacts } = buildContactList(new Map(), 3, [], undefined, new Map([[UID_BIT, 2]]))
    expect(contacts).toEqual([])
  })
})

describe('aggregatePromotedCandidateChapters', () => {
  test('只读 status=promoted 的候选，跳过未转正 candidate', () => {
    const db = new Database(':memory:')
    db.run(MEMORY_DDL)
    db.run("INSERT INTO meta (key, value) VALUES ('novel_id', 'novel-1')")
    db.run(
      `INSERT INTO candidate_characters (novel_id, character_uid, name, proposed_chapter, status) VALUES
       ('novel-1', ?, '镇岳堂伤者', 2, 'promoted'),
       ('novel-1', ?, '待出场候选', 7, 'candidate')`,
      UID_BIT,
      UID_FUTURE,
    )
    const reader = makeBunReader(db)
    const byUid = aggregatePromotedCandidateChapters(reader)
    reader.close()

    expect(byUid.get(UID_BIT)).toBe(2)
    expect(byUid.has(UID_FUTURE)).toBe(false) // status=candidate 不计
  })

  test('缺表 / 读失败返回空 Map', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.run("INSERT INTO meta (key, value) VALUES ('novel_id', 'novel-1')")
    const reader = makeBunReader(db)
    expect(aggregatePromotedCandidateChapters(reader).size).toBe(0)
    reader.close()
  })
})

describe('enrichContactsWithStatuses', () => {
  const baseList = () =>
    buildContactList(
      new Map([
        [UID_LIN, { firstAppearedChapter: 1, lastSeenChapter: 3 }],
        [UID_SU, { firstAppearedChapter: 3, lastSeenChapter: 3 }],
      ]),
      3,
      [
        { characterUid: UID_LIN, name: '林衍', settingPath: 'bible/characters/林衍.md' },
        { characterUid: UID_SU, name: '苏暮', settingPath: 'bible/characters/苏暮.md' },
      ],
    )

  test('把引擎返回的 statuses 回填到对应 uid 的 currentStatus', () => {
    const enriched = enrichContactsWithStatuses(
      baseList(),
      new Map([
        [UID_LIN, '刚赢下一场硬战，右臂伤势未愈'],
        [UID_SU, '刚救回伤员，精神紧绷'],
      ]),
    )
    expect(enriched.contacts.map((c) => c.currentStatus)).toEqual([
      '刚赢下一场硬战，右臂伤势未愈',
      '刚救回伤员，精神紧绷',
    ])
    // 知识边界与联系人集合不变（只富化 currentStatus）。
    expect(enriched.knowledgeBoundaryChapter).toBe(3)
    expect(enriched.contacts.map((c) => c.characterUid)).toEqual([UID_LIN, UID_SU])
  })

  test('部分命中：未命中的 uid 保持 null', () => {
    const enriched = enrichContactsWithStatuses(baseList(), new Map([[UID_LIN, '右臂带伤']]))
    expect(enriched.contacts.map((c) => c.currentStatus)).toEqual(['右臂带伤', null])
  })

  test('空 Map（引擎降级）原样返回、currentStatus 全 null', () => {
    const list = baseList()
    const enriched = enrichContactsWithStatuses(list, new Map())
    expect(enriched).toBe(list)
    expect(enriched.contacts.every((c) => c.currentStatus === null)).toBe(true)
  })
})

describe('readAppearedCharacterContacts', () => {
  test('端到端：返回林衍/苏暮，排除未来反派与未建档角色', async () => {
    const project = await tempProject()
    await seedCharacterFiles(project)
    const db = seededDb()
    const openMemoryDb: OpenMemoryDb = () => makeBunReader(db)

    const result = await readAppearedCharacterContacts({ projectPath: project, openMemoryDb })
    expect(result.knowledgeBoundaryChapter).toBe(3)
    expect(result.contacts.map((contact) => contact.name)).toEqual(['林衍', '苏暮'])
    // currentStatus 真相已搬到引擎（novel_character_statuses）：本读取层一律留 null，不再折叠 facts/cards。
    expect(result.contacts.map((contact) => contact.currentStatus)).toEqual([null, null])
    for (const contact of result.contacts) {
      expect(contact.settingPath.startsWith('bible/characters/')).toBe(true)
      expect(contact.lastSeenChapter).toBeLessThanOrEqual(result.knowledgeBoundaryChapter ?? 0)
    }
  })

  test('端到端：已建档 promoted 配角（抽取漏登记 chapter_summaries）也进联系人', async () => {
    const project = await tempProject()
    await seedCharacterFiles(project)
    // 镇岳堂伤者：有身份档（sketch）、chapter_summaries 里没有它，仅靠 promoted 候选记录其出场章
    await writeFile(
      join(project, 'bible', 'characters', '镇岳堂伤者.md'),
      `<!-- character_identity: {"character_uid":"${UID_BIT}","name":"镇岳堂伤者","profile_stage":"sketch"} -->\n# 镇岳堂伤者\n野路伤者。`,
      'utf-8',
    )
    const db = seededDb()
    db.run(
      `INSERT INTO candidate_characters (novel_id, character_uid, name, proposed_chapter, status)
       VALUES ('novel-1', ?, '镇岳堂伤者', 2, 'promoted')`,
      UID_BIT,
    )
    const openMemoryDb: OpenMemoryDb = () => makeBunReader(db)

    const result = await readAppearedCharacterContacts({ projectPath: project, openMemoryDb })
    expect(result.contacts.map((contact) => contact.name)).toContain('镇岳堂伤者')
    const bit = result.contacts.find((contact) => contact.characterUid === UID_BIT)
    expect(bit?.firstAppearedChapter).toBe(2)
  })

  test('memory.db 打开失败时联系人为空、边界为 null（中性空态）', async () => {
    const project = await tempProject()
    await seedCharacterFiles(project)
    const openMemoryDb: OpenMemoryDb = () => {
      throw new Error('db missing')
    }
    const result = await readAppearedCharacterContacts({ projectPath: project, openMemoryDb })
    expect(result.contacts).toEqual([])
    expect(result.knowledgeBoundaryChapter).toBeNull()
  })
})
