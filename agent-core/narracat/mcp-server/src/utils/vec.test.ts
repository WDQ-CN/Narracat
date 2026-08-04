import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

// embedding 模型在测试环境不可用，用确定性 512 维假向量替身（与生产维度一致）。
const EMBED_DIM = 512;
vi.mock("./embedding.js", () => ({
  embed: vi.fn(async (text: string) => {
    const v = new Float32Array(EMBED_DIM);
    // 由文本派生一个稳定但可区分的向量，便于断言「确有写入」
    for (let i = 0; i < text.length && i < EMBED_DIM; i++) v[i] = text.charCodeAt(i) / 1000;
    return v;
  }),
  getEmbeddingDim: () => EMBED_DIM,
}));

import { initSchema } from "../migrate.js";
import { initVecTable, isVecAvailable, backfillVectors } from "./vec.js";

const NOVEL_ID = "novel-test";

function newDb(): Database.Database {
  const db = new Database(":memory:");
  sqliteVec.load(db);
  initSchema(db);
  return db;
}

function vecCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM memory_vec").get() as { n: number }).n;
}

function vecDim(db: Database.Database): number | null {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_vec'")
    .get() as { sql: string } | undefined;
  const m = row?.sql.match(/embedding\s+float\[(\d+)\]/i);
  return m ? parseInt(m[1], 10) : null;
}

let db: Database.Database;
beforeEach(() => {
  db = newDb();
});
afterEach(() => {
  db.close();
});

describe("initVecTable 维度变更重建", () => {
  it("检测到旧维度向量表时整表重建为当前维度", () => {
    // 先建一个旧维度（768）的向量表，模拟换模型前的存量库
    db.exec(`CREATE VIRTUAL TABLE memory_vec USING vec0(
      source_table TEXT, source_id TEXT, novel_id TEXT, sector TEXT, embedding float[768]
    )`);
    expect(vecDim(db)).toBe(768);

    const ok = initVecTable(db, EMBED_DIM);
    expect(ok).toBe(true);
    expect(isVecAvailable()).toBe(true);
    expect(vecDim(db)).toBe(EMBED_DIM);
  });

  it("维度一致时不重建（IF NOT EXISTS 幂等）", () => {
    expect(initVecTable(db, EMBED_DIM)).toBe(true);
    expect(initVecTable(db, EMBED_DIM)).toBe(true);
    expect(vecDim(db)).toBe(EMBED_DIM);
  });
});

describe("backfillVectors 历史向量回填", () => {
  beforeEach(() => {
    initVecTable(db, EMBED_DIM);
    // 直写源表数据（绕过写工具），模拟 embedding 失效期间只进了 SQLite、没进向量索引
    db.prepare(
      `INSERT INTO facts (id, novel_id, subject, predicate, object, sector, from_chapter)
       VALUES (?, ?, ?, ?, ?, 'semantic', 1)`,
    ).run("f1", NOVEL_ID, "林晚", "持有", "断魂刀");
    db.prepare(
      `INSERT INTO chapter_summaries (id, novel_id, chapter, summary)
       VALUES (?, ?, ?, ?)`,
    ).run("c1", NOVEL_ID, 1, "林晚初入药圃，与赵伯结识。");
    db.prepare(
      `INSERT INTO arc_summaries (novel_id, scope, scope_id, chapter_start, chapter_end, summary)
       VALUES (?, 'arc', 'arc-1', 1, 10, ?)`,
    ).run(NOVEL_ID, "第一弧：药圃风云。");
  });

  it("补齐三张表缺失的向量", async () => {
    expect(vecCount(db)).toBe(0);
    const { backfilled } = await backfillVectors(db, NOVEL_ID);
    expect(backfilled).toBe(3);
    expect(vecCount(db)).toBe(3);

    // 校验 source_id 重建正确（arc 用 scope:scope_id 复合键）
    const ids = (
      db.prepare("SELECT source_table, source_id FROM memory_vec ORDER BY source_table").all() as Array<{
        source_table: string;
        source_id: string;
      }>
    ).map((r) => `${r.source_table}:${r.source_id}`);
    expect(ids).toContain("facts:f1");
    expect(ids).toContain("chapter_summaries:c1");
    expect(ids).toContain("arc_summaries:arc:arc-1");
  });

  it("幂等：已补齐后再次调用零新增", async () => {
    await backfillVectors(db, NOVEL_ID);
    const { backfilled } = await backfillVectors(db, NOVEL_ID);
    expect(backfilled).toBe(0);
    expect(vecCount(db)).toBe(3);
  });

  it("仅补缺口：已有向量的行跳过", async () => {
    await backfillVectors(db, NOVEL_ID);
    // 新增一条 facts，仅它应被补
    db.prepare(
      `INSERT INTO facts (id, novel_id, subject, predicate, object, sector, from_chapter)
       VALUES (?, ?, ?, ?, ?, 'semantic', 2)`,
    ).run("f2", NOVEL_ID, "赵伯", "身份", "药圃管事");
    const { backfilled } = await backfillVectors(db, NOVEL_ID);
    expect(backfilled).toBe(1);
    expect(vecCount(db)).toBe(4);
  });
});
