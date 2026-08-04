/**
 * G4b 轻量双时间轴测试（ADR-0025）
 *
 * 覆盖：迁移 v12→13 回填 / 写入口 event_chapter + invalidated_by / 折叠零回归 /
 * event 视角时点回溯（倒叙 fact）/ rollback 清 invalidated_by。
 *
 * 跑：cd mcp-server && npx vitest run src/handlers/bitemporal.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

vi.mock("../utils/embedding.js", () => ({ embed: vi.fn(async () => null) }));

import { initSchema, SCHEMA_VERSION } from "../migrate.js";
import type { ToolContext } from "../types.js";
import { novelSubmitExtraction, novelRollbackChapter } from "./writers.js";
import { novelCharacterState, novelRelationship } from "./readers.js";
import { foldCharacterCard } from "./character-card-fold.js";

const UID = "11111111-1111-4111-8111-111111111111";
const NOVEL = "novel-g4b";
const cleanup: string[] = [];
afterEach(() => {
  for (const p of cleanup) rmSync(p, { recursive: true, force: true });
  cleanup.length = 0;
});

function setup(): ToolContext {
  const root = mkdtempSync(join(tmpdir(), "g4b-"));
  cleanup.push(root);
  mkdirSync(join(root, "bible", "characters"), { recursive: true });
  writeFileSync(
    join(root, "bible", "characters", "林晚.md"),
    `<!-- character_identity: {"character_uid":"${UID}","name":"林晚"} -->\n# 林晚\n`,
  );
  const db = new Database(":memory:");
  initSchema(db);
  return { novelId: NOVEL, db, projectRoot: root, wordsPerChapter: 3000 } as ToolContext;
}

interface FactColRow {
  id: string;
  from_chapter: number;
  event_chapter: number | null;
  invalidated_at_chapter: number | null;
  invalidated_by: string | null;
}
const factByObject = (ctx: ToolContext, object: string): FactColRow =>
  ctx.db
    .prepare(
      "SELECT id, from_chapter, event_chapter, invalidated_at_chapter, invalidated_by FROM facts WHERE novel_id = ? AND object = ?",
    )
    .get(NOVEL, object) as FactColRow;

const submit = (ctx: ToolContext, chapter: number, facts: unknown[]) =>
  novelSubmitExtraction({ chapter, facts }, ctx);

/** §3.3 用例专用：直插 fact 行，可显式指定 source / created_at 以构造同章平手场景。 */
function insertFact(
  ctx: ToolContext,
  f: {
    id: string;
    subject: string;
    subject_character_uid: string;
    predicate: string;
    object: string;
    from_chapter: number;
    event_chapter?: number;
    source?: string;
    created_at?: string;
  },
): void {
  ctx.db
    .prepare(
      `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, sector, from_chapter, event_chapter, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'semantic', ?, ?, ?, ?)`,
    )
    .run(
      f.id,
      NOVEL,
      f.subject,
      f.subject_character_uid,
      f.predicate,
      f.object,
      f.from_chapter,
      f.event_chapter ?? f.from_chapter,
      f.source ?? "extracted",
      f.created_at ?? "2026-07-13 00:00:00",
    );
}

const cardAt = async (ctx: ToolContext, at: number): Promise<Record<string, string>> => {
  const r = (await novelCharacterState({ character_uid: UID, at_chapter: at }, ctx)) as {
    card: Record<string, string>;
  };
  return r.card;
};

describe("迁移 v12 → 13", () => {
  it("facts 加 event_chapter（回填=from_chapter）+ invalidated_by，schema_version=13", () => {
    const db = new Database(":memory:");
    // 模拟 v12 库：meta + 旧 facts（无 event_chapter / invalidated_by）+ 真实 v12 已存在的 candidate_characters（无 importance，由 v14 迁移补列）+ chapter_reviews
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE facts (
        id TEXT PRIMARY KEY, novel_id TEXT, subject TEXT, subject_character_uid TEXT,
        subject_character_b_uid TEXT, predicate TEXT, object TEXT,
        sector TEXT DEFAULT 'semantic', from_chapter INTEGER, invalidated_at_chapter INTEGER,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE candidate_characters (
        novel_id TEXT NOT NULL, character_uid TEXT NOT NULL, name TEXT NOT NULL,
        note TEXT, proposed_chapter INTEGER, initial_relationships TEXT DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'write', status TEXT NOT NULL DEFAULT 'candidate',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (novel_id, character_uid)
      );
      CREATE TABLE arc_meta (
        novel_id TEXT NOT NULL, arc_id TEXT NOT NULL, volume_no INTEGER NOT NULL,
        title TEXT NOT NULL, chapter_start INTEGER NOT NULL, chapter_end INTEGER NOT NULL,
        core_question TEXT NOT NULL, irreversible_change TEXT NOT NULL, next_arc_seed TEXT NOT NULL,
        payoff_beats TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (novel_id, arc_id)
      );
      CREATE TABLE chapter_reviews (
        novel_id TEXT NOT NULL, chapter INTEGER NOT NULL,
        verdict TEXT NOT NULL CHECK(verdict IN ('pass','fail')),
        issues_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (novel_id, chapter)
      );
      INSERT INTO meta VALUES ('schema_version','12');
      INSERT INTO facts (id, novel_id, subject, predicate, object, from_chapter) VALUES ('f1','n','林晚','location','在青云宗',5);
    `);
    initSchema(db);
    const cols = (db.prepare("PRAGMA table_info(facts)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain("event_chapter");
    expect(cols).toContain("invalidated_by");
    const row = db.prepare("SELECT event_chapter, invalidated_by FROM facts WHERE id='f1'").get() as {
      event_chapter: number | null;
      invalidated_by: string | null;
    };
    expect(row.event_chapter).toBe(5); // 回填 = from_chapter
    expect(row.invalidated_by).toBeNull();
    // v12→13 加列后继续跑到当前版本（含 v14 candidate_characters.importance），断言落在最新版
    const ver = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as {
      value: string;
    };
    expect(ver.value).toBe(String(SCHEMA_VERSION));
  });
});

describe("写入口：event_chapter + invalidated_by", () => {
  it("new fact：event_chapter = from_chapter = 入库章，invalidated_by 为空", async () => {
    const ctx = setup();
    await submit(ctx, 5, [
      { subject: "林晚", predicate: "location", object: "在青云宗", change_type: "new" },
    ]);
    const f = factByObject(ctx, "在青云宗");
    expect(f.from_chapter).toBe(5);
    expect(f.event_chapter).toBe(5);
    expect(f.invalidated_by).toBeNull();
  });

  it("update：旧值 invalidated_by 指向新 fact id，新值 event_chapter = 更新章", async () => {
    const ctx = setup();
    await submit(ctx, 5, [
      { subject: "林晚", predicate: "location", object: "在青云宗", change_type: "new" },
    ]);
    await submit(ctx, 10, [
      { subject: "林晚", predicate: "location", object: "在魔渊", change_type: "update" },
    ]);
    const oldF = factByObject(ctx, "在青云宗");
    const newF = factByObject(ctx, "在魔渊");
    expect(oldF.invalidated_at_chapter).toBe(10);
    expect(oldF.invalidated_by).toBe(newF.id); // 溯源：被哪条新事实取代
    expect(newF.event_chapter).toBe(10);
    expect(newF.invalidated_by).toBeNull();
  });
});

describe("折叠零回归（默认 event = ingestion）", () => {
  it("character_state 按 at 章折叠：ch7 看到旧值、ch10 看到新值", async () => {
    const ctx = setup();
    await submit(ctx, 5, [
      { subject: "林晚", predicate: "location", object: "在青云宗", change_type: "new" },
    ]);
    await submit(ctx, 10, [
      { subject: "林晚", predicate: "location", object: "在魔渊", change_type: "update" },
    ]);
    expect((await cardAt(ctx, 7)).location).toBe("在青云宗");
    expect((await cardAt(ctx, 10)).location).toBe("在魔渊");
  });
});

describe("event 视角时点回溯（倒叙 fact）", () => {
  it("event_chapter < from_chapter 的补叙事实，按 event 章回溯可召回", async () => {
    const ctx = setup();
    // 第 8 章补叙「其实第 2 章就埋下的秘密」：event=2、ingestion=8
    ctx.db
      .prepare(
        `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, sector, from_chapter, event_chapter)
         VALUES ('rev', ?, '林晚', ?, 'secret', '身世之谜', 'semantic', 8, 2)`,
      )
      .run(NOVEL, UID);
    // 站在第 3 章视角：event=2 ≤ 3 → 召回（单轴 from=8 会漏）
    expect((await cardAt(ctx, 3)).secret).toBe("身世之谜");
    // 第 1 章视角：event=2 > 1 → 不召回
    expect((await cardAt(ctx, 1)).secret).toBeUndefined();
  });
});

describe("rollback 清 invalidated_by", () => {
  it("回滚后被恢复的旧事实 invalidated_at_chapter 与 invalidated_by 均清空", async () => {
    const ctx = setup();
    await submit(ctx, 5, [
      { subject: "林晚", predicate: "location", object: "在青云宗", change_type: "new" },
    ]);
    await submit(ctx, 10, [
      { subject: "林晚", predicate: "location", object: "在魔渊", change_type: "update" },
    ]);
    await novelRollbackChapter({ chapter: 10 }, ctx);
    const restored = factByObject(ctx, "在青云宗");
    expect(restored.invalidated_at_chapter).toBeNull();
    expect(restored.invalidated_by).toBeNull();
    // 第 10 章的新值已被回滚删除，折叠回到旧值
    expect((await cardAt(ctx, 10)).location).toBe("在青云宗");
  });
});

describe("event 轴一致性（PR #325 审核 P1）", () => {
  const UID2 = "22222222-2222-4222-8222-222222222222";

  it("relationship 倒叙：event_chapter < from_chapter 的补叙关系按 event 章召回", async () => {
    const ctx = setup();
    // 第 8 章补叙「其实第 2 章就已结义」：event=2、ingestion=8
    ctx.db
      .prepare(
        `INSERT INTO facts (id, novel_id, subject, subject_character_uid, subject_character_b_uid, predicate, object, sector, from_chapter, event_chapter)
         VALUES ('rel-rev', ?, '林晚|某乙', ?, ?, 'relationship', '结义兄弟', 'semantic', 8, 2)`,
      )
      .run(NOVEL, UID, UID2);
    const at3 = (await novelRelationship(
      { character_a_uid: UID, character_b_uid: UID2, at_chapter: 3 },
      ctx,
    )) as { current_state: string | null };
    expect(at3.current_state).toBe("结义兄弟"); // event=2 ≤ 3 → 召回（单轴 from=8 会漏）
    const at1 = (await novelRelationship(
      { character_a_uid: UID, character_b_uid: UID2, at_chapter: 1 },
      ctx,
    )) as { current_state: string | null };
    expect(at1.current_state).toBeNull(); // event=2 > 1 → 不召回
  });

  it("交错排序：同 predicate 两条按 event 轴取最新，不被 ingestion 更晚者盖过", async () => {
    const ctx = setup();
    // A：event=2 / ingestion=8（补叙的旧事件）；B：event=5 / ingestion=5（正常）。第 6 章两者皆有效
    ctx.db
      .prepare(
        `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, sector, from_chapter, event_chapter)
         VALUES ('fa', ?, '林晚', ?, 'location', '旧地点A', 'semantic', 8, 2)`,
      )
      .run(NOVEL, UID);
    ctx.db
      .prepare(
        `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, sector, from_chapter, event_chapter)
         VALUES ('fb', ?, '林晚', ?, 'location', '新地点B', 'semantic', 5, 5)`,
      )
      .run(NOVEL, UID);
    // 按 event 轴 B(event=5) 比 A(event=2) 新 → 当前值是 B；若按旧 from_chapter DESC 会错选 A(from=8)
    expect((await cardAt(ctx, 6)).location).toBe("新地点B");
  });
});

describe("§3.3 同章 authored 压 extracted", () => {
  it("同 event 章两条 fact，authored 先插、extracted 后插，折叠赢家仍是 authored", () => {
    const ctx = setup();
    // authored 先插（created_at 更早），extracted 后插——现状排序 created_at DESC 会让 extracted 赢
    insertFact(ctx, {
      id: "a1",
      subject: "张三",
      subject_character_uid: UID,
      predicate: "ability",
      object: "金丹",
      from_chapter: 8,
      event_chapter: 8,
      source: "authored",
      created_at: "2026-07-13 00:00:00",
    });
    insertFact(ctx, {
      id: "e1",
      subject: "张三",
      subject_character_uid: UID,
      predicate: "ability",
      object: "筑基",
      from_chapter: 8,
      event_chapter: 8,
      source: "extracted",
      created_at: "2026-07-13 00:01:00",
    });
    const card = foldCharacterCard(ctx, UID, 10);
    // 无词表 → v1 扁平卡：ability 当前值必须是 authored 的金丹
    expect((card as Record<string, string>)["ability"]).toBe("金丹");
  });

  it("更晚章的 extracted 仍压过更早章的 authored（时序为王在前，source 只破同章平手）", () => {
    const ctx = setup();
    insertFact(ctx, {
      id: "a1",
      subject: "张三",
      subject_character_uid: UID,
      predicate: "ability",
      object: "金丹",
      from_chapter: 8,
      event_chapter: 8,
      source: "authored",
      created_at: "2026-07-13 00:00:00",
    });
    insertFact(ctx, {
      id: "e2",
      subject: "张三",
      subject_character_uid: UID,
      predicate: "ability",
      object: "元婴",
      from_chapter: 12,
      event_chapter: 12,
      source: "extracted",
      created_at: "2026-07-13 00:01:00",
    });
    const card = foldCharacterCard(ctx, UID, 15);
    expect((card as Record<string, string>)["ability"]).toBe("元婴");
  });
});
