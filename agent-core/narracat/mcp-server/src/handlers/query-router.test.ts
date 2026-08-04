/**
 * 查询类型路由器测试
 *
 * 1) classifyQuery 纯启发式分类：测题集 + 准确率门槛（确定性，不调 LLM / embedding）
 * 2) novelQuery 路由分流集成：route 字段透传 + 弧线只出摘要 + 多跳带种子 + 单点零回归
 *
 * 跑：cd mcp-server && npx vitest run src/handlers/query-router.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

vi.mock("../utils/embedding.js", () => ({ embed: vi.fn(async () => null) }));

import { classifyQuery, type QueryRoute } from "./query-router.js";
import type { ResolvedCharacter } from "./alias-map.js";
import { initSchema } from "../migrate.js";
import { ftsInsert } from "../utils/fts.js";
import { novelQuery } from "./readers.js";
import type { ToolContext } from "../types.js";

// ============================================================
// 1) classifyQuery — 纯启发式分类
// ============================================================

function aliasMapOf(
  ...entries: Array<{ canonical: string; uid?: string; aliases?: string[] }>
): Map<string, ResolvedCharacter> {
  const m = new Map<string, ResolvedCharacter>();
  for (const e of entries) {
    const resolved: ResolvedCharacter = { canonical: e.canonical, uid: e.uid ?? null };
    m.set(e.canonical, resolved);
    for (const a of e.aliases ?? []) m.set(a, resolved);
  }
  return m;
}

describe("classifyQuery — 纯启发式分类", () => {
  const aliasMap = aliasMapOf(
    { canonical: "萧炎", uid: "uid-xiao", aliases: ["炎帝"] },
    { canonical: "药尘", uid: "uid-yao", aliases: ["药老"] },
    { canonical: "云韵", uid: "uid-yun" },
  );

  const cases: Array<{ q: string; route: QueryRoute; desc: string }> = [
    { q: "萧炎的武器是什么", route: "point", desc: "单角色+无意图词→单点" },
    { q: "玄重尺现在在谁手里", route: "point", desc: "无已知角色+无意图词→单点" },
    { q: "三千炎炎法的口诀", route: "point", desc: "功法名单点查询" },
    { q: "萧炎和炎帝是不是同一个人", route: "point", desc: "同一角色两名去重=1实体+无意图→单点" },
    { q: "复仇线的整体走向", route: "arc", desc: "无角色+弧线词→弧线" },
    { q: "梳理一下成长历程", route: "arc", desc: "弧线词 梳理/历程→弧线" },
    { q: "魂殿和萧家之间的恩怨始末", route: "arc", desc: "关系词但无已知角色种子→弧线" },
    { q: "萧炎和药尘的关系", route: "multi_hop", desc: "两已知角色→多跳" },
    { q: "炎帝和药老谁更强", route: "multi_hop", desc: "别名命中两角色→多跳" },
    { q: "萧炎的人脉关系网", route: "multi_hop", desc: "单角色+关系词→多跳(单种子)" },
    { q: "谁同时欠萧炎的人情又忌惮云韵", route: "multi_hop", desc: "两角色交集→多跳" },
  ];

  for (const c of cases) {
    it(`「${c.q}」→ ${c.route}（${c.desc}）`, () => {
      expect(classifyQuery(c.q, aliasMap).route).toBe(c.route);
    });
  }

  it("分类准确率 = 100%（测题集全中，Gate）", () => {
    const correct = cases.filter(
      (c) => classifyQuery(c.q, aliasMap).route === c.route,
    ).length;
    expect(correct).toBe(cases.length);
  });

  it("multi_hop 返回去重后的角色种子（含 uid，供 PPR 预留）", () => {
    const r = classifyQuery("萧炎和药尘的关系", aliasMap);
    expect(r.route).toBe("multi_hop");
    expect(r.seedEntities.map((e) => e.canonical).sort()).toEqual(["萧炎", "药尘"].sort());
    expect(r.seedEntities.every((e) => e.uid !== null)).toBe(true);
  });

  it("别名命中归并到 canonical（炎帝→萧炎，不重复计数）", () => {
    const r = classifyQuery("萧炎和炎帝是不是同一个人", aliasMap);
    expect(r.seedEntities.map((e) => e.canonical)).toEqual(["萧炎"]);
  });

  it("空 aliasMap 时不误判多跳（关系词无种子→弧线，纯事实→单点）", () => {
    const empty = new Map<string, ResolvedCharacter>();
    expect(classifyQuery("萧炎和药尘的关系", empty).route).toBe("arc");
    expect(classifyQuery("萧炎的武器", empty).route).toBe("point");
  });

  it("前缀名（P1）：林晚/林晚晴 共存，查询林晚晴 → 只命中林晚晴（单点，不误判多跳）", () => {
    const prefixMap = aliasMapOf(
      { canonical: "林晚", uid: "u-lw" },
      { canonical: "林晚晴", uid: "u-lwq" },
    );
    const r = classifyQuery("林晚晴的目标是什么", prefixMap);
    expect(r.seedEntities.map((e) => e.canonical)).toEqual(["林晚晴"]);
    expect(r.route).toBe("point");
  });

  it("前缀名：两名真实共现仍各自命中 → 多跳", () => {
    const prefixMap = aliasMapOf(
      { canonical: "林晚", uid: "u-lw" },
      { canonical: "林晚晴", uid: "u-lwq" },
    );
    const r = classifyQuery("林晚和林晚晴是什么关系", prefixMap);
    expect(r.seedEntities.map((e) => e.canonical).sort()).toEqual(["林晚", "林晚晴"].sort());
    expect(r.route).toBe("multi_hop");
  });
});

// ============================================================
// 2) novelQuery — 路由分流集成
// ============================================================

interface QueryResult {
  ok: boolean;
  route: QueryRoute;
  count: number;
  seed_entities?: string[];
  results: Array<{ content: string; source: string; chapter: number | null; score: number }>;
}

describe("novelQuery — 路由分流集成", () => {
  const NOVEL = "novel-g2";
  const cleanup: string[] = [];
  afterEach(() => {
    for (const p of cleanup) rmSync(p, { recursive: true, force: true });
    cleanup.length = 0;
  });

  function setupNovel(): ToolContext {
    const root = mkdtempSync(join(tmpdir(), "g2-router-"));
    cleanup.push(root);
    mkdirSync(join(root, "bible", "characters"), { recursive: true });
    writeFileSync(
      join(root, "bible", "characters", "萧炎.md"),
      `<!-- character_identity: {"character_uid":"uid-xiao"} -->\n# 萧炎\n别名: 炎帝\n`,
    );
    writeFileSync(
      join(root, "bible", "characters", "药尘.md"),
      `<!-- character_identity: {"character_uid":"uid-yao"} -->\n# 药尘\n别名: 药老\n`,
    );
    const db = new Database(":memory:");
    initSchema(db);
    return {
      novelId: NOVEL,
      db,
      projectRoot: root,
      wordsPerChapter: 3000,
    } as ToolContext;
  }

  function seedFact(
    ctx: ToolContext,
    id: string,
    subject: string,
    predicate: string,
    object: string,
    fromChapter: number,
  ): void {
    ctx.db
      .prepare(
        `INSERT INTO facts (id, novel_id, subject, predicate, object, sector, from_chapter)
         VALUES (?, ?, ?, ?, ?, 'semantic', ?)`,
      )
      .run(id, NOVEL, subject, predicate, object, fromChapter);
    ftsInsert(ctx.db, `${subject} ${predicate} ${object}`, "facts", id, NOVEL, "semantic");
  }

  function seedVolumeSummary(
    ctx: ToolContext,
    scopeId: string,
    start: number,
    end: number,
    summary: string,
  ): void {
    ctx.db
      .prepare(
        `INSERT INTO arc_summaries (novel_id, scope, scope_id, chapter_start, chapter_end, summary)
         VALUES (?, 'volume', ?, ?, ?, ?)`,
      )
      .run(NOVEL, scopeId, start, end, summary);
    ftsInsert(ctx.db, summary, "arc_summaries", `volume:${scopeId}`, NOVEL, "semantic");
  }

  it("arc 路由：弧线查询只返回摘要类来源，过滤掉零碎事实", async () => {
    const ctx = setupNovel();
    // 卷摘要与一条事实共享同一长串（FTS 都会命中），用以验证 arc 过滤把事实丢掉
    seedVolumeSummary(ctx, "V01", 1, 60, "本卷复仇线整体走向魂殿步步紧逼局势剧变");
    seedFact(ctx, "f-arc", "萧炎", "goal", "复仇线整体走向密谋", 5);

    const r = (await novelQuery({ query: "复仇线整体走向" }, ctx)) as QueryResult;
    expect(r.ok).toBe(true);
    expect(r.route).toBe("arc");
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.every((x) => x.source === "arc_summary")).toBe(true);
  });

  it("multi_hop 路由：两角色查询打 multi_hop 标记并带去重种子", async () => {
    const ctx = setupNovel();
    seedFact(ctx, "f-x", "萧炎", "identity", "萧炎炎盟盟主统领群雄", 10);
    seedFact(ctx, "f-y", "药尘", "identity", "药尘斗气大陆老怪物", 12);

    const r = (await novelQuery({ query: "萧炎和药尘的关系" }, ctx)) as QueryResult;
    expect(r.ok).toBe(true);
    expect(r.route).toBe("multi_hop");
    expect(r.seed_entities?.slice().sort()).toEqual(["萧炎", "药尘"].sort());
  });

  it("point 路由：单点查询零回归（route=point、不带 seed_entities、结构不变）", async () => {
    const ctx = setupNovel();
    seedFact(ctx, "f-p", "玄重尺", "location", "玄重尺埋在加玛废墟下落不明", 8);

    const r = (await novelQuery({ query: "玄重尺下落不明" }, ctx)) as QueryResult;
    expect(r.ok).toBe(true);
    expect(r.route).toBe("point");
    expect(r.seed_entities).toBeUndefined();
    expect(Array.isArray(r.results)).toBe(true);
    for (const item of r.results) {
      expect(typeof item.content).toBe("string");
      expect(typeof item.source).toBe("string");
      expect(typeof item.score).toBe("number");
    }
  });

  it("空库查询：仍返回 ok + route + count=0", async () => {
    const ctx = setupNovel();
    const r = (await novelQuery({ query: "毫不相关的查询词串" }, ctx)) as QueryResult;
    expect(r.ok).toBe(true);
    expect(r.route).toBe("point");
    expect(r.count).toBe(0);
  });
});
