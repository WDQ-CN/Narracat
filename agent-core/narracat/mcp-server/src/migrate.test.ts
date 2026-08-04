import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema, recordNovelId, SCHEMA_VERSION } from "./migrate.js";

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

function schemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

describe("initSchema additive migration", () => {
  it("全新库初始化到当前版本，候选表带 initial_relationships 列", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(columnNames(db, "candidate_characters")).toContain("initial_relationships");
  });

  it("v9 形态旧库就地加列升级，零数据丢失", () => {
    const db = new Database(":memory:");
    // 模拟 v9：meta + 不带 initial_relationships 的候选表 + 不带 is_through_line 的故事线表 + v9 形态的 chapter_reviews（无 reviewed_manuscript_sha256），各塞一行旧数据
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE candidate_characters (
        novel_id TEXT NOT NULL, character_uid TEXT NOT NULL, name TEXT NOT NULL,
        note TEXT, proposed_chapter INTEGER,
        source TEXT NOT NULL DEFAULT 'write', status TEXT NOT NULL DEFAULT 'candidate',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (novel_id, character_uid)
      );
      CREATE TABLE storylines (
        novel_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
        type TEXT NOT NULL, priority INTEGER NOT NULL, entry_chapter INTEGER NOT NULL,
        planned_payoff_chapter INTEGER, status TEXT NOT NULL DEFAULT 'active',
        PRIMARY KEY (novel_id, id)
      );
      CREATE TABLE facts (
        id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, subject TEXT NOT NULL,
        subject_character_uid TEXT, subject_character_b_uid TEXT,
        predicate TEXT NOT NULL, object TEXT NOT NULL, sector TEXT NOT NULL DEFAULT 'semantic',
        from_chapter INTEGER NOT NULL, invalidated_at_chapter INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    `);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '9')").run();
    db.prepare(
      "INSERT INTO candidate_characters (novel_id, character_uid, name) VALUES ('n', 'u', '旧候选')",
    ).run();
    db.prepare(
      "INSERT INTO storylines (novel_id, id, name, type, priority, entry_chapter) VALUES ('n', 'SL-1', '旧主线', 'main', 1, 1)",
    ).run();
    db.prepare(
      "INSERT INTO facts (id, novel_id, subject, predicate, object, from_chapter) VALUES ('f-old', 'n', '旧角色', 'location', '旧地点', 3)",
    ).run();

    initSchema(db);

    expect(columnNames(db, "candidate_characters")).toContain("initial_relationships");
    expect(columnNames(db, "storylines")).toContain("is_through_line");
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    const row = db
      .prepare("SELECT name, initial_relationships FROM candidate_characters WHERE character_uid = 'u'")
      .get() as { name: string; initial_relationships: string };
    expect(row.name).toBe("旧候选");
    expect(row.initial_relationships).toBe("[]");
    // 存量故事线行零损失，新列回填默认 0
    const sl = db
      .prepare("SELECT name, is_through_line FROM storylines WHERE id = 'SL-1'")
      .get() as { name: string; is_through_line: number };
    expect(sl.name).toBe("旧主线");
    expect(sl.is_through_line).toBe(0);
    // facts 新轴（v13）：event_chapter 回填 = from_chapter，invalidated_by 列就位
    const f = db
      .prepare("SELECT event_chapter, invalidated_by FROM facts WHERE id = 'f-old'")
      .get() as { event_chapter: number; invalidated_by: string | null };
    expect(f.event_chapter).toBe(3);
    expect(f.invalidated_by).toBeNull();
  });

  it("v11 形态旧库（无 extraction_stage）升到 v12 后建出该表", () => {
    const db = new Database(":memory:");
    // 全新库建到当前版本，再降回 v11 + 删 extraction_stage，模拟 v11 库
    initSchema(db);
    db.exec("DROP TABLE IF EXISTS extraction_stage");
    db.prepare("UPDATE meta SET value = '11' WHERE key = 'schema_version'").run();
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='extraction_stage'")
        .get(),
    ).toBeUndefined();

    initSchema(db);

    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='extraction_stage'")
        .get(),
    ).toBeDefined();
  });

  it("幂等：重复 initSchema 不报错、列不重复", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() => initSchema(db)).not.toThrow();
    expect(columnNames(db, "candidate_characters").filter((c) => c === "initial_relationships")).toHaveLength(1);
  });
});

describe("character_dialogue_samples 新表迁移", () => {
  it("全新库建出 character_dialogue_samples 表并含全部必填列", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const cols = columnNames(db, "character_dialogue_samples");
    expect(cols).toContain("id");
    expect(cols).toContain("novel_id");
    expect(cols).toContain("chapter");
    expect(cols).toContain("character");
    expect(cols).toContain("character_uid");
    expect(cols).toContain("dialogue_text");
    expect(cols).toContain("dialogue_type");
    expect(cols).toContain("created_at");
    expect(cols).toContain("updated_at");
  });

  it("全新库 schema_version 等于 SCHEMA_VERSION=21", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(21);
  });

  it("v14 形态旧库升级后建出 character_dialogue_samples 表", () => {
    const db = new Database(":memory:");
    // 建到当前版本再降回 v14，模拟旧库
    initSchema(db);
    db.exec("DROP TABLE IF EXISTS character_dialogue_samples");
    db.prepare("UPDATE meta SET value = '14' WHERE key = 'schema_version'").run();

    initSchema(db);

    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    const tbl = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='character_dialogue_samples'",
      )
      .get();
    expect(tbl).toBeDefined();
  });

  it("dialogue_type 列存在 CHECK 约束（非法值插入应抛错）", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() =>
      db.exec(`
        INSERT INTO character_dialogue_samples
          (id, novel_id, chapter, character, character_uid, dialogue_text, dialogue_type, created_at, updated_at)
        VALUES
          ('id-1', 'n1', 1, '角色A', 'uid-a', '你好吗？', 'invalid_type', datetime('now'), datetime('now'))
      `),
    ).toThrow();
  });

  it("合法的 dialogue_type 值可以插入", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const types = ["dialogue", "monologue", "thought", "action_narration"] as const;
    for (const t of types) {
      expect(() =>
        db.exec(`
          INSERT INTO character_dialogue_samples
            (id, novel_id, chapter, character, character_uid, dialogue_text, dialogue_type, created_at, updated_at)
          VALUES
            ('id-${t}', 'n1', 1, '角色A', 'uid-a', '台词-${t}', '${t}', datetime('now'), datetime('now'))
        `),
      ).not.toThrow();
    }
  });
});

describe("v16 → v17: facts.source", () => {
  it("新库 facts 含 source 列且默认 extracted", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const cols = db.prepare("PRAGMA table_info(facts)").all() as Array<{ name: string; dflt_value: string | null }>;
    const source = cols.find((c) => c.name === "source");
    expect(source).toBeDefined();
    expect(source?.dflt_value).toBe("'extracted'");
    db.close();
  });

  it("v16 旧库升级补列且存量行落 extracted", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare("UPDATE meta SET value = '16' WHERE key = 'schema_version'").run();
    // 模拟 v16：删掉 source 列不可行（SQLite 3.35+ 可 DROP COLUMN）
    db.exec("ALTER TABLE facts DROP COLUMN source");
    db.prepare(
      `INSERT INTO facts (id, novel_id, subject, predicate, object, from_chapter)
       VALUES ('f1', 'n1', '苏见', 'ability', '练气', 1)`,
    ).run();
    initSchema(db);
    const row = db.prepare("SELECT source FROM facts WHERE id = 'f1'").get() as { source: string };
    expect(row.source).toBe("extracted");
    expect((db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string }).value).toBe(String(SCHEMA_VERSION));
    db.close();
  });
});

describe("v17 → v18: planned_state_changes 计划表（A4×D2 片3）", () => {
  it("全新库建出 planned_state_changes 表并含五态 CHECK", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const cols = (db.prepare("PRAGMA table_info(planned_state_changes)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    for (const col of ["id", "novel_id", "chapter", "character_uid", "character_name", "dimension", "operation", "value", "reason", "status", "deferred_to_chapter"]) {
      expect(cols).toContain(col);
    }
    expect(() =>
      db
        .prepare(
          "INSERT INTO planned_state_changes (id, novel_id, chapter, character_uid, character_name, dimension, operation, value, status) VALUES ('p1','n1',1,'u1','张三','ability','set','筑基','exploded')",
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it("v17 旧库升级后建出该表", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.exec("DROP TABLE IF EXISTS planned_state_changes");
    db.prepare("UPDATE meta SET value = '17' WHERE key = 'schema_version'").run();
    initSchema(db);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='planned_state_changes'").get(),
    ).toBeDefined();
    expect((db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string }).value).toBe(String(SCHEMA_VERSION));
    db.close();
  });
});

describe("arc_meta.antagonist_agent 迁移（issue #429，v15→v16）", () => {
  it("全新库 arc_meta 带 antagonist_agent 列", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(columnNames(db, "arc_meta")).toContain("antagonist_agent");
  });

  it("v15 形态旧库升级后 arc_meta 加列，存量行零损失、新列回填 NULL", () => {
    const db = new Database(":memory:");
    // 建到当前版本，再把 arc_meta 换回不含 antagonist_agent 的 v15 形态并塞一行旧数据
    initSchema(db);
    db.exec(`
      DROP TABLE arc_meta;
      CREATE TABLE arc_meta (
        novel_id TEXT NOT NULL, arc_id TEXT NOT NULL, volume_no INTEGER NOT NULL,
        title TEXT NOT NULL, chapter_start INTEGER NOT NULL, chapter_end INTEGER NOT NULL,
        core_question TEXT NOT NULL, irreversible_change TEXT NOT NULL, next_arc_seed TEXT NOT NULL,
        payoff_beats TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (novel_id, arc_id)
      );
      INSERT INTO arc_meta (novel_id, arc_id, volume_no, title, chapter_start, chapter_end, core_question, irreversible_change, next_arc_seed, payoff_beats)
      VALUES ('n', 'V01-A01', 1, '旧弧', 1, 10, '旧核心问题', '旧不可逆变化', '旧种子', '[]');
    `);
    db.prepare("UPDATE meta SET value = '15' WHERE key = 'schema_version'").run();

    initSchema(db);

    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(columnNames(db, "arc_meta")).toContain("antagonist_agent");
    const row = db
      .prepare("SELECT title, antagonist_agent FROM arc_meta WHERE arc_id = 'V01-A01'")
      .get() as { title: string; antagonist_agent: string | null };
    expect(row.title).toBe("旧弧");
    expect(row.antagonist_agent).toBeNull();
  });
});

describe("v18 → v19: facts 加 secret_known 列（片4 secret 本人已知晓）", () => {
  it("全新库 facts 表带 secret_known 列且默认 0", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const cols = (db.prepare("PRAGMA table_info(facts)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain("secret_known");
    expect(SCHEMA_VERSION).toBe(21);
    db.close();
  });

  it("v18 旧库升级后 facts 加 secret_known 列，存量行零损失、新列默认 0", () => {
    const db = new Database(":memory:");
    // 建到当前版本，再把 v18 降级模拟（删 secret_known）
    initSchema(db);
    // 删除新列以模拟 v18 形态
    db.exec(`
      CREATE TABLE facts_v18 AS SELECT
        id, novel_id, subject, subject_character_uid, subject_character_b_uid,
        predicate, object, sector, from_chapter, event_chapter, invalidated_at_chapter,
        invalidated_by, source, created_at, updated_at
      FROM facts;
      DROP TABLE facts;
      ALTER TABLE facts_v18 RENAME TO facts;
    `);
    db.prepare(
      `INSERT INTO facts (id, novel_id, subject, predicate, object, from_chapter)
       VALUES ('f-secret', 'n1', '秘密角色', 'secret', '隐藏身份', 1)`,
    ).run();
    db.prepare("UPDATE meta SET value = '18' WHERE key = 'schema_version'").run();

    initSchema(db);

    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    const cols = columnNames(db, "facts");
    expect(cols).toContain("secret_known");
    const row = db
      .prepare("SELECT secret_known FROM facts WHERE id = 'f-secret'")
      .get() as { secret_known: number };
    expect(row.secret_known).toBe(0);
    db.close();
  });

  it("重复迁移幂等（再跑一次 initSchema 不报错且不重复加列）", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() => initSchema(db)).not.toThrow();
    expect(columnNames(db, "facts").filter((c) => c === "secret_known")).toHaveLength(1);
    db.close();
  });
});

describe("v19 → v20: chapter_reviews.reviewed_manuscript_sha256", () => {
  it("全新库 chapter_reviews 带 reviewed_manuscript_sha256 列", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const cols = (db.prepare("PRAGMA table_info(chapter_reviews)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain("reviewed_manuscript_sha256");
    db.close();
  });

  it("v19 形态旧库（无该列）升到 v20 后就地加列，既有行保留且列值为 NULL", () => {
    const db = new Database(":memory:");
    initSchema(db);
    // 模拟 v19 旧库：删掉新列、回退版本号
    db.exec("ALTER TABLE chapter_reviews DROP COLUMN reviewed_manuscript_sha256");
    db.prepare("UPDATE meta SET value = '19' WHERE key = 'schema_version'").run();
    db.prepare(
      "INSERT INTO chapter_reviews (novel_id, chapter, verdict, issues_json) VALUES ('n1', 1, 'pass', '[]')",
    ).run();

    initSchema(db);

    const row = db
      .prepare("SELECT verdict, reviewed_manuscript_sha256 FROM chapter_reviews WHERE novel_id = 'n1'")
      .get() as { verdict: string; reviewed_manuscript_sha256: string | null };
    expect(row.verdict).toBe("pass");
    expect(row.reviewed_manuscript_sha256).toBeNull();
    db.close();
  });
});

describe("recordNovelId", () => {
  function metaNovelId(db: Database.Database): string | undefined {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'novel_id'").get() as
      | { value: string }
      | undefined;
    return row?.value;
  }

  it("全新库写入 config 的 novel_id", () => {
    const db = new Database(":memory:");
    initSchema(db);
    recordNovelId(db, "novel-a");
    expect(metaNovelId(db)).toBe("novel-a");
    db.close();
  });

  it("空 novelId fail-loud（防 JS 直调 dist 的调用方漏传——静默跳过与延迟崩溃都更难排障）", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() => recordNovelId(db, "")).toThrow(/非空 novelId/);
    expect(() => recordNovelId(db, undefined as unknown as string)).toThrow(/非空 novelId/);
    expect(metaNovelId(db)).toBeUndefined();
    db.close();
  });

  it("重复调用幂等，meta 只留一行 novel_id", () => {
    const db = new Database(":memory:");
    initSchema(db);
    recordNovelId(db, "novel-c");
    recordNovelId(db, "novel-c");
    const rows = db.prepare("SELECT value FROM meta WHERE key = 'novel_id'").all();
    expect(rows).toHaveLength(1);
    db.close();
  });

  it("已存 id 与 config 不一致时以 config 为准并告警", () => {
    const db = new Database(":memory:");
    initSchema(db);
    recordNovelId(db, "novel-old");
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    recordNovelId(db, "novel-new");
    expect(metaNovelId(db)).toBe("novel-new");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("novel-old"));
    warn.mockRestore();
    db.close();
  });
});

it("v20 老库升级到 v21 后有 style_anchors 表", () => {
  const dir = mkdtempSync(join(tmpdir(), "migrate-v21-"));
  const db = new Database(join(dir, "memory.db"));
  initSchema(db); // 注意：initSchema 只接一个参数，novel_id 由 recordNovelId 单独写
  db.prepare("UPDATE meta SET value = '20' WHERE key = 'schema_version'").run();
  db.exec("DROP TABLE IF EXISTS style_anchors");

  initSchema(db);

  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='style_anchors'")
    .get() as { name?: string } | undefined;
  expect(row?.name).toBe("style_anchors");
  expect(
    (db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string }).value,
  ).toBe("21");

  db.close();
  rmSync(dir, { recursive: true, force: true });
});
