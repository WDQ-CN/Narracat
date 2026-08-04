/**
 * facts 实体图构建 + PPR 多跳召回集成测试
 *
 * 1) buildEntityGraph 纯函数：两类边（relationship 双 uid / 非 rel 的 object 提及）
 * 2) novelQuery multi_hop：在与 g0-probe ③ 同构的图（关系链 + 交集）上，证明 PPR
 *    能召回 ≥2 跳关系与交集——对照 baseline（relationship 接口 2 跳一律 null）。
 *
 * 跑：cd mcp-server && npx vitest run src/handlers/entity-graph.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

vi.mock("../utils/embedding.js", () => ({ embed: vi.fn(async () => null) }));

import { buildEntityGraph, type GraphFactRow } from "./entity-graph.js";
import type { ResolvedCharacter } from "./alias-map.js";
import { initSchema } from "../migrate.js";
import { novelQuery, novelRelationship } from "./readers.js";
import type { ToolContext } from "../types.js";

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

// ============================================================
// 1) buildEntityGraph — 纯函数
// ============================================================

describe("buildEntityGraph", () => {
  const aliasMap = aliasMapOf(
    { canonical: "萧炎", uid: "u-a" },
    { canonical: "药尘", uid: "u-b" },
    { canonical: "纳兰嫣然", uid: "u-x" },
  );

  it("relationship fact → 双 uid 无向边", () => {
    const facts: GraphFactRow[] = [
      { id: "r1", subject_character_uid: "u-a", subject_character_b_uid: "u-b", predicate: "relationship", object: "结义兄弟" },
    ];
    const g = buildEntityGraph(facts, aliasMap);
    expect(g.adjacency.get("u-a")?.get("u-b")).toBe(1);
    expect(g.adjacency.get("u-b")?.get("u-a")).toBe(1);
    expect(g.factsByEntity.get("u-a")?.has("r1")).toBe(true);
    expect(g.factsByEntity.get("u-b")?.has("r1")).toBe(true);
  });

  it("非关系 fact → subject 与 object 提及角色建隐式边", () => {
    const facts: GraphFactRow[] = [
      { id: "f1", subject_character_uid: "u-x", subject_character_b_uid: null, predicate: "debt", object: "欠萧炎白银千两" },
    ];
    const g = buildEntityGraph(facts, aliasMap);
    expect(g.adjacency.get("u-x")?.get("u-a")).toBe(1); // 纳兰嫣然 → 萧炎
  });

  it("object 未提及已知角色 → 仅建节点、无边", () => {
    const facts: GraphFactRow[] = [
      { id: "f2", subject_character_uid: "u-a", subject_character_b_uid: null, predicate: "location", object: "在加玛帝国边境" },
    ];
    const g = buildEntityGraph(facts, aliasMap);
    expect(g.adjacency.get("u-a")?.size ?? 0).toBe(0);
    expect(g.factsByEntity.get("u-a")?.has("f2")).toBe(true);
  });

  it("无 subject_character_uid 的 fact 跳过", () => {
    const facts: GraphFactRow[] = [
      { id: "f3", subject_character_uid: null, subject_character_b_uid: null, predicate: "location", object: "萧炎" },
    ];
    expect(buildEntityGraph(facts, aliasMap).factsByEntity.size).toBe(0);
  });

  it("前缀名（P2）：object='林晚晴受伤' 只连林晚晴，不误连林晚", () => {
    const prefixMap = aliasMapOf(
      { canonical: "林晚", uid: "u-lw" },
      { canonical: "林晚晴", uid: "u-lwq" },
      { canonical: "赵伯", uid: "u-zb" },
    );
    const facts: GraphFactRow[] = [
      { id: "f1", subject_character_uid: "u-zb", subject_character_b_uid: null, predicate: "status", object: "林晚晴受伤" },
    ];
    const g = buildEntityGraph(facts, prefixMap);
    expect(g.adjacency.get("u-zb")?.get("u-lwq")).toBe(1); // 赵伯 → 林晚晴
    expect(g.adjacency.get("u-zb")?.has("u-lw")).toBe(false); // 不误连林晚
  });
});

// ============================================================
// 2) novelQuery multi_hop — PPR 多跳召回（对照 baseline）
// ============================================================

interface QueryResult {
  ok: boolean;
  route: string;
  seed_entities?: string[];
  results: Array<{ content: string; source: string; score: number }>;
}

describe("novelQuery multi_hop — PPR 多跳召回", () => {
  const NOVEL = "novel-g3";
  const cleanup: string[] = [];
  afterEach(() => {
    for (const p of cleanup) rmSync(p, { recursive: true, force: true });
    cleanup.length = 0;
  });

  function writeChar(root: string, name: string, uid: string | null): void {
    const idComment =
      uid === null ? "" : `<!-- character_identity: {"character_uid":"${uid}"} -->\n`;
    writeFileSync(join(root, "bible", "characters", `${name}.md`), `${idComment}# ${name}\n`);
  }

  function rel(
    ctx: ToolContext,
    id: string,
    subject: string,
    aUid: string,
    bUid: string,
    object: string,
  ): void {
    ctx.db
      .prepare(
        `INSERT INTO facts (id, novel_id, subject, subject_character_uid, subject_character_b_uid, predicate, object, sector, from_chapter)
         VALUES (?, ?, ?, ?, ?, 'relationship', ?, 'semantic', 1)`,
      )
      .run(id, NOVEL, subject, aUid, bUid, object);
  }

  function attr(
    ctx: ToolContext,
    id: string,
    subject: string,
    uid: string,
    predicate: string,
    object: string,
  ): void {
    ctx.db
      .prepare(
        `INSERT INTO facts (id, novel_id, subject, subject_character_uid, subject_character_b_uid, predicate, object, sector, from_chapter)
         VALUES (?, ?, ?, ?, NULL, ?, ?, 'semantic', 1)`,
      )
      .run(id, NOVEL, subject, uid, predicate, object);
  }

  /** 与 g0-probe ③ 同构：关系链 萧炎-药尘-林轩-云韵 + 交集（纳兰同欠萧炎债又恨药尘） */
  function setupGraph(withUid = true): ToolContext {
    const root = mkdtempSync(join(tmpdir(), "g3-ppr-"));
    cleanup.push(root);
    mkdirSync(join(root, "bible", "characters"), { recursive: true });
    const uid = (u: string): string | null => (withUid ? u : null);
    for (const [name, u] of [
      ["萧炎", "u-a"],
      ["药尘", "u-b"],
      ["林轩", "u-c"],
      ["云韵", "u-d"],
      ["纳兰嫣然", "u-x"],
      ["海波东", "u-y"],
      ["古元", "u-z"],
    ] as const) {
      writeChar(root, name, uid(u));
    }
    const db = new Database(":memory:");
    initSchema(db);
    const ctx = { novelId: NOVEL, db, projectRoot: root, wordsPerChapter: 3000 } as ToolContext;
    // 关系链：相邻直接边，无 A-C / A-D 直接边
    rel(ctx, "r-ab", "萧炎与药尘", "u-a", "u-b", "结义兄弟");
    rel(ctx, "r-bc", "药尘与林轩", "u-b", "u-c", "师徒");
    rel(ctx, "r-cd", "林轩与云韵", "u-c", "u-d", "生死同盟");
    // 交集：纳兰 欠萧炎债 + 恨药尘；海波东 只欠萧炎；古元 只恨药尘
    attr(ctx, "f-x", "纳兰嫣然", "u-x", "debt", "欠萧炎白银千两");
    rel(ctx, "r-xb", "纳兰嫣然与药尘", "u-x", "u-b", "仇恨");
    attr(ctx, "f-y", "海波东", "u-y", "debt", "欠萧炎一个人情");
    rel(ctx, "r-zb", "古元与药尘", "u-z", "u-b", "仇恨");
    return ctx;
  }

  const firstIdx = (results: QueryResult["results"], name: string): number =>
    results.findIndex((r) => r.content.includes(name));

  it("2 跳：『萧炎和林轩的关系』经药尘连接——PPR 召回到路径，baseline 给不出", async () => {
    const ctx = setupGraph();
    // baseline 对照：relationship 接口查 萧炎-林轩（2 跳）→ 无直接边 → null
    const direct = (await novelRelationship(
      { character_a_uid: "u-a", character_b_uid: "u-c" },
      ctx,
    )) as { current_state: string | null };
    expect(direct.current_state).toBeNull();

    const r = (await novelQuery({ query: "萧炎和林轩的关系" }, ctx)) as QueryResult;
    expect(r.route).toBe("multi_hop");
    expect(r.seed_entities?.slice().sort()).toEqual(["林轩", "萧炎"].sort());
    // PPR 沿 萧炎—药尘—林轩 扩散，召回的 facts 触达中间人药尘与终点林轩
    const contents = r.results.map((x) => x.content).join(" / ");
    expect(contents).toContain("药尘");
    expect(contents).toContain("林轩");
  });

  it("交集：『谁欠萧炎的债又恨药尘』——纳兰排在只连一端的海波东/古元之前", async () => {
    const ctx = setupGraph();
    const r = (await novelQuery({ query: "谁欠萧炎的债又恨药尘" }, ctx)) as QueryResult;
    expect(r.route).toBe("multi_hop");
    expect(r.seed_entities?.slice().sort()).toEqual(["药尘", "萧炎"].sort());

    const idxNalan = firstIdx(r.results, "纳兰嫣然");
    const idxHai = firstIdx(r.results, "海波东");
    const idxGu = firstIdx(r.results, "古元");
    expect(idxNalan).toBeGreaterThanOrEqual(0); // 交集答案被召回
    expect(idxNalan).toBeLessThan(idxHai); // 排在只欠债的海波东前
    expect(idxNalan).toBeLessThan(idxGu); // 排在只记恨的古元前
  });

  it("种子无 uid（角色未建 character_identity）→ 回退多查询混合检索，不报错", async () => {
    const ctx = setupGraph(false);
    const r = (await novelQuery({ query: "萧炎和药尘的关系" }, ctx)) as QueryResult;
    expect(r.ok).toBe(true);
    expect(r.route).toBe("multi_hop");
    expect(Array.isArray(r.results)).toBe(true);
  });
});
