/**
 * G0 实测探针 · 主线 A①「远卷丢失」（issue #242）
 *
 * 不写小说、不调 LLM：L2 温层的截断是确定性逻辑（readers.ts `arcSummaries.shift()`
 * + `estimateBlockTokens` + BLOCK_BUDGETS.arc_summaries=2000）。本探针走**真实** builder
 * `novelBuildWritingContextPack`，合成 N 卷卷摘要喂进去，直接量出：
 *   - 撞预算前能保留几卷、第几卷起开始丢、远卷（第 1 卷）还在不在包里
 *   - L2 区块在 6/12/20 卷时的真实 token 曲线
 *
 * 跑：cd mcp-server && npx vitest run src/handlers/g0-memory-probe.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

vi.mock("../utils/embedding.js", () => ({ embed: vi.fn(async () => null) }));

import { initSchema } from "../migrate.js";
import type { ToolContext } from "../types.js";
import {
  novelBuildWritingContextPack,
  novelCharacterState,
  novelRelationship,
  novelQuery,
  novelExtractionScaffold,
} from "./readers.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const p of cleanup) rmSync(p, { recursive: true, force: true });
  cleanup.length = 0;
});

const CHAPTERS_PER_VOL = 60; // 每卷 60 章 ≈ 18 万字（3000 字/章）作为规模换算基准

/** 生成 n 个中文字符的卷摘要文本（每字 estimateTokens=1，逼近真实卷摘要密度） */
function cjkSummary(n: number): string {
  const base =
    "本卷主线推进英雄历经磨难势力格局剧变伏笔交错恩怨纠葛逐渐成型危机四伏暗流涌动旧敌伏诛新局开启身世线索浮现";
  let s = "";
  while (s.length < n) s += base;
  return s.slice(0, n);
}

function setup(): { ctx: ToolContext; root: string } {
  const root = mkdtempSync(join(tmpdir(), "g0-probe-"));
  cleanup.push(root);
  mkdirSync(join(root, ".narracat"), { recursive: true });
  mkdirSync(join(root, "bible"), { recursive: true });
  writeFileSync(join(root, "bible", "premise.md"), "# 前提\n");
  const db = new Database(":memory:");
  initSchema(db);
  return {
    ctx: { novelId: "novel-g0", db, projectRoot: root, wordsPerChapter: 3000 } as ToolContext,
    root,
  };
}

/** 灌 numVols 卷的 volume 摘要 + 为 targetChapter 造一个最小细纲文件 */
function seed(
  ctx: ToolContext,
  root: string,
  numVols: number,
  summaryLen: number,
  targetChapter: number,
): void {
  const stmt = ctx.db.prepare(
    `INSERT INTO arc_summaries (novel_id, scope, scope_id, chapter_start, chapter_end, summary)
     VALUES (?, 'volume', ?, ?, ?, ?)`,
  );
  for (let v = 1; v <= numVols; v++) {
    const start = (v - 1) * CHAPTERS_PER_VOL + 1;
    const end = v * CHAPTERS_PER_VOL;
    stmt.run(ctx.novelId, `V${String(v).padStart(2, "0")}`, start, end, cjkSummary(summaryLen));
  }
  const padded = String(targetChapter).padStart(3, "0");
  mkdirSync(join(root, "outline", "vol-99"), { recursive: true });
  writeFileSync(
    join(root, "outline", "vol-99", `ch-${padded}.md`),
    `# 第${targetChapter}章细纲\n- 戏剧焦点：占位\n`,
  );
}

interface Pack {
  arc_summaries: Array<{ scope: string; scope_id: string; chapter_start: number }>;
  warnings: string[];
}

async function runScenario(numVols: number, summaryLen: number): Promise<{
  kept: number;
  dropped: number;
  blockTokens: number;
  vol1InPack: boolean;
  earliestKeptVol: number;
}> {
  const { ctx, root } = setup();
  const targetChapter = numVols * CHAPTERS_PER_VOL + 1; // 站在「全部卷都已完结」的当下写下一章
  seed(ctx, root, numVols, summaryLen, targetChapter);

  const res = (await novelBuildWritingContextPack({ chapter: targetChapter }, ctx)) as {
    ok: boolean;
    pack_path: string;
  };
  expect(res.ok).toBe(true);

  const pack = JSON.parse(readFileSync(res.pack_path, "utf-8")) as Pack;
  const vols = pack.arc_summaries.filter((s) => s.scope === "volume");
  const kept = vols.length;
  const blockTokens = estimateBlockTokens(pack.arc_summaries);
  const vol1InPack = vols.some((s) => s.scope_id === "V01");
  const earliestKeptVol = kept > 0 ? Math.min(...vols.map((s) => Number(s.scope_id.slice(1)))) : 0;
  return { kept, dropped: numVols - kept, blockTokens, vol1InPack, earliestKeptVol };
}

// 逐字复刻 readers.ts:1262 的真实估算算法，仅用于报告 L2 区块 token（不参与截断判定）
function estimateBlockTokens(block: unknown): number {
  const text = JSON.stringify(block);
  let total = 0;
  for (const ch of text) total += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.3;
  return Math.ceil(total);
}

describe("G0·A① L2 温层远卷丢失（确定性实测，零 LLM）", () => {
  it("跑 6/12/20 卷 × 卷摘要长度敏感性矩阵，量出远卷丢失曲线", async () => {
    const volCounts = [3, 6, 9, 12, 16, 20];
    const summaryLens = [400, 650, 800]; // 报告假设单条卷摘要 ~500–800 字

    const rows: string[] = [];
    rows.push("| 卷数 | ~字数规模 | 卷摘要字/条 | 原始卷数 | 保留卷数 | 丢弃卷数 | L2区块token | 最早保留卷 | 第1卷在包? |");
    rows.push("|---|---|---|---|---|---|---|---|---|");

    for (const len of summaryLens) {
      for (const v of volCounts) {
        const r = await runScenario(v, len);
        const wan = Math.round((v * CHAPTERS_PER_VOL * 3000) / 10000);
        rows.push(
          `| ${v} | ~${wan}万 | ${len} | ${v} | ${r.kept} | ${r.dropped} | ${r.blockTokens} | V${String(r.earliestKeptVol).padStart(2, "0")} | ${r.vol1InPack ? "✅" : "❌丢"} |`,
        );
        // sanity：保留卷数不可能超过原始卷数，且至少保留 1 卷（builder 的 length>1 守卫）
        expect(r.kept).toBeGreaterThanOrEqual(1);
        expect(r.kept).toBeLessThanOrEqual(v);
      }
      rows.push("|---|---|---|---|---|---|---|---|---|");
    }

    // eslint-disable-next-line no-console
    console.log("\n=== G0·A① 远卷丢失实测（BLOCK_BUDGETS.arc_summaries=2000）===\n" + rows.join("\n") + "\n");

    // 决定性断言：20 卷 / 650 字必然丢弃远卷（验证 P4 最痛点真实存在）
    const worst = await runScenario(20, 650);
    expect(worst.dropped).toBeGreaterThan(0);
    expect(worst.vol1InPack).toBe(false);
  });
});

// ============================================================
// G0·A①-fix 远卷贯穿线常驻层 + 核心伏笔豁免（切片 #303，确定性实测，零 LLM）
//
// A① 暴露 L2 温层把远卷 shift 丢弃。本块验证修复：WCP 新增 through_line_anchor 常驻层，
// 把全书核心线（engine facts subject='全书' + storylines.is_through_line=1 + major 伏笔）
// 独立常驻、永不随卷滚动丢弃；同时 L2 仍守 1600 预算照常滚动（证明没关掉预算）。
// 全部数据 authored（直接 INSERT 模拟 novel_submit_outline 写入），不调 LLM。
// ============================================================

const ENGINE_PREDICATES = [
  "central_dramatic_question",
  "protagonist_core_desire",
  "protagonist_core_lack",
  "antagonistic_force",
  "stakes_progression",
];

/** 在已 seed 卷摘要的库上，再注入贯穿线常驻层三类来源（authored） */
function seedThroughLine(ctx: ToolContext, targetChapter: number): void {
  // 5 个引擎字段（subject='全书' facts）
  const factStmt = ctx.db.prepare(
    `INSERT INTO facts (id, novel_id, subject, predicate, object, from_chapter)
     VALUES (?, ?, '全书', ?, ?, 1)`,
  );
  for (const p of ENGINE_PREDICATES) {
    factStmt.run(`f-${p}`, ctx.novelId, p, `全书锚点：${p} 的内容承诺`);
  }
  // 第 1 卷入场的贯穿故事线（is_through_line=1）+ 一条非贯穿线对照
  const slStmt = ctx.db.prepare(
    `INSERT INTO storylines (novel_id, id, name, type, priority, entry_chapter, status, is_through_line)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
  );
  slStmt.run(ctx.novelId, "SL-revenge", "身世复仇主线", "main", 1, 1, 1);
  slStmt.run(ctx.novelId, "SL-rivalry", "宿敌线", "rivalry", 2, 1, 1);
  slStmt.run(ctx.novelId, "SL-side", "本卷支线", "faction", 5, 1, 0);
  // 一个第 1 章埋设的 major 伏笔（跨度极大）+ 一个 small 伏笔对照
  // + 一个会进 due 的 non-major（medium，临期 numeric target ≤ chapter+10）——
  // 让测试③的「major 排在 non-major 前」排序断言真正落到 due 列表上，而非空转。
  const fsStmt = ctx.db.prepare(
    `INSERT INTO foreshadowing_registry (novel_id, id, type, description, planted_chapter, target_reveal)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  fsStmt.run(ctx.novelId, "F-ORIGIN", "major", "主角身世之谜：父亲死因", 1, "vol-20");
  fsStmt.run(ctx.novelId, "F-NEAR", "small", "近期临期小伏笔", null, null);
  fsStmt.run(
    ctx.novelId,
    "F-DUE",
    "medium",
    "临期中型伏笔（本章兑现）",
    targetChapter - 1,
    String(targetChapter + 5),
  );
}

interface AnchorPack {
  through_line_anchor: {
    engine_fields: Array<{ key: string; value: string }>;
    through_storylines: Array<{ id: string; name: string; type: string }>;
    core_foreshadowing: Array<{ id: string; description: string }>;
  };
  arc_summaries: Array<{ scope: string; scope_id: string }>;
  foreshadowing_due: { due: Array<{ id: string; type: string }>; others_count: number };
  warnings: string[];
}

async function buildAnchorPack(numVols: number, summaryLen: number): Promise<AnchorPack> {
  const { ctx, root } = setup();
  const targetChapter = numVols * CHAPTERS_PER_VOL + 1;
  seed(ctx, root, numVols, summaryLen, targetChapter);
  seedThroughLine(ctx, targetChapter);
  const res = (await novelBuildWritingContextPack({ chapter: targetChapter }, ctx)) as {
    ok: boolean;
    pack_path: string;
  };
  expect(res.ok).toBe(true);
  return JSON.parse(readFileSync(res.pack_path, "utf-8")) as AnchorPack;
}

describe("G0·A①-fix 远卷贯穿线常驻层 + 核心伏笔豁免（切片 #303）", () => {
  it("① 20 卷场景常驻层非空，engine_fields = 5、贯穿故事线全到位", async () => {
    const pack = await buildAnchorPack(20, 650);
    expect(pack.through_line_anchor.engine_fields).toHaveLength(5);
    const slIds = pack.through_line_anchor.through_storylines.map((s) => s.id);
    expect(slIds).toContain("SL-revenge");
    expect(slIds).toContain("SL-rivalry");
    // 非贯穿线不进常驻层
    expect(slIds).not.toContain("SL-side");
  });

  it("② 第 1 卷贯穿线进常驻层，而 V01 卷摘要已被 L2 滚动丢弃（常驻层与 L2 分离）", async () => {
    const pack = await buildAnchorPack(20, 650);
    // L2 仍滚动：远卷 V01 摘要不在 arc_summaries
    expect(pack.arc_summaries.some((s) => s.scope_id === "V01")).toBe(false);
    // 但第 1 卷入场的贯穿故事线仍在常驻层
    expect(
      pack.through_line_anchor.through_storylines.some((s) => s.id === "SL-revenge"),
    ).toBe(true);
  });

  it("③ major 伏笔跨 >20 章仍在常驻层 core_foreshadowing，且 due 中 major 排在 non-major 前", async () => {
    const pack = await buildAnchorPack(20, 650);
    const coreIds = pack.through_line_anchor.core_foreshadowing.map((f) => f.id);
    expect(coreIds).toContain("F-ORIGIN");
    // due 列表里 major 必须排在所有 non-major 之前。
    // 前置守卫：due 必须同时含 major 与 non-major，否则排序断言无可断之物（防回退成空转）。
    const due = pack.foreshadowing_due.due;
    const firstNonMajor = due.findIndex((d) => d.type !== "major");
    const lastMajor = due.map((d) => d.type).lastIndexOf("major");
    expect(firstNonMajor).not.toBe(-1); // F-DUE（medium，临期 target）必在 due
    expect(lastMajor).not.toBe(-1); // F-ORIGIN（major）必在 due
    expect(lastMajor).toBeLessThan(firstNonMajor);
    // F-ORIGIN（major）必在 due 中（getForeshadowingDue 对 major 恒 return true）
    expect(due.some((d) => d.id === "F-ORIGIN" && d.type === "major")).toBe(true);
    // F-DUE（medium）确实进了 due（确保排序断言落在真实 non-major 上）
    expect(due.some((d) => d.id === "F-DUE" && d.type === "medium")).toBe(true);
  });

  it("④ WCP 总 token ≤ 12000；L2 守 1600 预算且远卷仍按预算滚动丢弃（非保全策略）", async () => {
    const pack = await buildAnchorPack(20, 650);
    const total = estimateBlockTokens(pack) + estimateBlockTokens(pack.warnings);
    expect(total).toBeLessThanOrEqual(12000);
    // arc_summaries 预算上限现在是 1600
    expect(estimateBlockTokens(pack.arc_summaries)).toBeLessThanOrEqual(1600);
    // 20 卷未退化为全保留：仍在滚动 shift
    expect(pack.arc_summaries.length).toBeLessThan(20);
  });

  it("⑤ 3 卷代表密度场景（650 字/卷）：L2 仍保 ≥2 卷（1600 预算下降不致近卷雪崩）", async () => {
    // 650 字/卷是 G0 基线的代表密度（2×650=1300<1600，仍容纳 2 卷）。
    // 注：800 字/卷的极端高密度下 2 卷即 1600 撞顶、只保 1 卷——属预算物理上限，
    // 由 through_line_anchor 常驻层补偿全书核心信息，本切片接受该折中。
    const pack = await buildAnchorPack(3, 650);
    const vols = pack.arc_summaries.filter((s) => s.scope === "volume");
    expect(vols.length).toBeGreaterThanOrEqual(2);
  });

  it("⑥ core_foreshadowing 与 due 同滤：未种下（planted_chapter 晚于目标章）的 major 伏笔不进常驻层", async () => {
    // 终审 F1：core_foreshadowing 曾只按 type='major' 查询、未做 planted 过滤，
    // 会把「未来才种下」的 major 伏笔剧透进常驻层。修复后须与 foreshadowing_due
    // 同款 planted_chapter 过滤：只有已种下（planted_chapter ≤ 目标章，或为空）的进常驻层。
    const { ctx, root } = setup();
    const targetChapter = 4;
    mkdirSync(join(root, "outline", "vol-01"), { recursive: true });
    writeFileSync(
      join(root, "outline", "vol-01", `ch-${String(targetChapter).padStart(3, "0")}.md`),
      `# 第${targetChapter}章细纲\n- 戏剧焦点：占位\n`,
    );
    ctx.db
      .prepare(
        `INSERT INTO foreshadowing_registry (novel_id, id, type, description, planted_chapter, target_reveal)
         VALUES (?, ?, 'major', ?, ?, NULL)`,
      )
      .run(ctx.novelId, "F-PLANTED", "已种下的身世伏笔", 2);
    ctx.db
      .prepare(
        `INSERT INTO foreshadowing_registry (novel_id, id, type, description, planted_chapter, target_reveal)
         VALUES (?, ?, 'major', ?, ?, NULL)`,
      )
      .run(ctx.novelId, "F-FUTURE", "尚未种下的未来伏笔", 6);

    const res = (await novelBuildWritingContextPack({ chapter: targetChapter }, ctx)) as {
      ok: boolean;
      pack_path: string;
    };
    expect(res.ok).toBe(true);
    const pack = JSON.parse(readFileSync(res.pack_path, "utf-8")) as AnchorPack;
    const coreIds = pack.through_line_anchor.core_foreshadowing.map((f) => f.id);
    expect(coreIds).toContain("F-PLANTED");
    expect(coreIds).not.toContain("F-FUTURE");
  });
});

// ============================================================
// G0·A③ 多跳查询 baseline（确定性实测，零 LLM）
// 报告已从源码判定「无图遍历/多跳/PageRank」。本探针构造一张明确的多跳
// facts 图，用现有 3 个检索接口实测：每一跳的边都在库里、逐跳可查，但没有
// 任何接口能自动沿边走 ≥2 跳——给后续 PPR 改造立「当前多跳能力 = 0」的铁基线。
// ============================================================

const A = "uid-A";
const B = "uid-B";
const C = "uid-C";
const D = "uid-D";
const X = "uid-X"; // 欠 A 的债，且恨 B
const Y = "uid-Y"; // 只欠 A 的债
const Z = "uid-Z"; // 只恨 B

function rel(ctx: ToolContext, id: string, a: string, b: string, state: string): void {
  ctx.db
    .prepare(
      `INSERT INTO facts (id, novel_id, subject, subject_character_uid, subject_character_b_uid, predicate, object, from_chapter)
       VALUES (?, ?, ?, ?, ?, 'relationship', ?, 1)`,
    )
    .run(id, ctx.novelId, `${a}-${b}`, a, b, state);
}

function attr(ctx: ToolContext, id: string, uid: string, predicate: string, object: string): void {
  ctx.db
    .prepare(
      `INSERT INTO facts (id, novel_id, subject, subject_character_uid, subject_character_b_uid, predicate, object, from_chapter)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 1)`,
    )
    .run(id, ctx.novelId, uid, uid, predicate, object);
}

function seedGraph(ctx: ToolContext): void {
  // 关系链 A—B—C—D：只有相邻直接边，没有 A—C / A—D / B—D 的直接边
  rel(ctx, "r-ab", A, B, "结义兄弟");
  rel(ctx, "r-bc", B, C, "师徒");
  rel(ctx, "r-cd", C, D, "生死同盟");
  // 交集场景：X 同时「欠 A 债」+「恨 B」；Y 只欠 A 债；Z 只恨 B
  attr(ctx, "f-xdebt", X, "debt", "欠 A 白银千两");
  rel(ctx, "r-xb", X, B, "仇恨");
  attr(ctx, "f-ydebt", Y, "debt", "欠 A 一个人情");
  rel(ctx, "r-zb", Z, B, "仇恨");
}

async function relState(ctx: ToolContext, a: string, b: string): Promise<string | null> {
  const r = (await novelRelationship({ character_a_uid: a, character_b_uid: b }, ctx)) as {
    current_state: string | null;
  };
  return r.current_state;
}

describe("G0·A③ 多跳查询 baseline（确定性实测，零 LLM）", () => {
  it("逐跳可查、却无接口能走 ≥2 跳——量出 baseline", async () => {
    const { ctx } = setup();
    seedGraph(ctx);

    // —— 对照组：1-hop（直接边），应当全部答得出 ——
    const hopAB = await relState(ctx, A, B); // 结义兄弟
    const hopBC = await relState(ctx, B, C); // 师徒
    const hopCD = await relState(ctx, C, D); // 生死同盟

    // —— 多跳题：边都在库里，但问端到端关系 → 接口只查直接边 ——
    const hopAC = await relState(ctx, A, C); // 2-hop：A 经 B 连 C
    const hopAD = await relState(ctx, A, D); // 3-hop：A 经 B、C 连 D

    // —— 交集题：谁同时「欠 A 债」+「恨 B」？无单一接口可表达，只能逐个候选单点查询再人工求交 ——
    const candidates = [X, Y, Z];
    const intersect: string[] = [];
    let singlePointQueries = 0;
    for (const c of candidates) {
      const state = (await novelCharacterState({ character_uid: c }, ctx)) as {
        card: Record<string, string>;
      };
      singlePointQueries += 1;
      const owesA = (state.card["debt"] ?? "").includes("A");
      const hatesB = (await relState(ctx, c, B)) === "仇恨";
      singlePointQueries += 1;
      if (owesA && hatesB) intersect.push(c);
    }

    // novelQuery 相似度召回对结构化多跳/交集是否有用（embed 已 mock，仅 FTS）
    const q = (await novelQuery({ query: "欠债 仇恨" }, ctx)) as { count: number };

    const rows = [
      "| 题 | 类型 | 跳数 | 接口 | 系统返回 | 一次答出? |",
      "|---|---|---|---|---|---|",
      `| 对照1 | 直接关系 A-B | 1 | relationship | ${hopAB ?? "null"} | ✅ |`,
      `| 对照2 | 直接关系 B-C | 1 | relationship | ${hopBC ?? "null"} | ✅ |`,
      `| 对照3 | 直接关系 C-D | 1 | relationship | ${hopCD ?? "null"} | ✅ |`,
      `| 多跳1 | A 经谁连 C | 2 | relationship | ${hopAC ?? "null"}（查无直接边） | ❌ |`,
      `| 多跳2 | A 经谁连 D | 3 | relationship | ${hopAD ?? "null"}（查无直接边） | ❌ |`,
      `| 交集 | 谁欠A债又恨B | — | 无原生接口 | 须 ${singlePointQueries} 次单点查询+客户端求交→得「${intersect.join(",") || "∅"}」 | ❌ |`,
      `| 交集(替代) | novelQuery相似度召回 | — | query | count=${q.count}（相似度≠求交，无法定位交集） | ❌ |`,
    ];
    // eslint-disable-next-line no-console
    console.log("\n=== G0·A③ 多跳 baseline 实测 ===\n" + rows.join("\n") + "\n");
    // eslint-disable-next-line no-console
    console.log(
      `当前多跳原生回答率 = 0/2；1-hop 回答率 = 3/3；交集查询：答案可手工拼出（${intersect.join(",")}）但需 ${singlePointQueries} 次单点查询，无单一接口 → PPR baseline = 0\n`,
    );

    // 决定性断言：每一跳的边都在库（逐跳可查），但 ≥2 跳端到端关系一律查不到
    expect(hopAB).not.toBeNull();
    expect(hopBC).not.toBeNull();
    expect(hopCD).not.toBeNull();
    expect(hopAC).toBeNull(); // 2-hop：A-C 无直接边 → 系统答「无关系」
    expect(hopAD).toBeNull(); // 3-hop：A-D 无直接边
    expect(intersect).toEqual([X]); // 交集答案存在，但只能靠多次单点查询人工拼，非一次查询
  });
});

// ============================================================
// G1b·抽取脚手架结构确定性测试（切片 #304，零 LLM）
//
// novel_extraction_scaffold 把弱模型抽取所需的三类确定性参考一次性聚合：
// alias_table（角色档案解析）/ known_facts_summary（前文已知 facts）/ predicate_cheatsheet（12 谓词）。
// 本块只验证脚手架确实被机械组装出来、token 受控（宁短勿长）、纯只读不写。
// 召回率真机评测不在此处。
// ============================================================

interface ScaffoldResult {
  ok: boolean;
  chapter: number;
  alias_table: Array<{ canonical: string; aliases: string[]; uid: string | null }>;
  known_facts_summary: Array<{
    subject: string;
    predicate: string;
    object: string;
    from_chapter: number;
  }>;
  predicate_cheatsheet: string[];
  token_estimate: number;
}

/** 写一个角色档案：含 character_identity uid + 别名行 */
function writeCharacterFile(
  root: string,
  canonical: string,
  uid: string | null,
  aliases: string[],
): void {
  mkdirSync(join(root, "bible", "characters"), { recursive: true });
  const idComment =
    uid === null
      ? ""
      : `<!-- character_identity: ${JSON.stringify({ character_uid: uid, name: canonical })} -->\n`;
  const aliasLine = aliases.length ? `别名: ${aliases.join("、")}\n` : "";
  writeFileSync(
    join(root, "bible", "characters", `${canonical}.md`),
    `${idComment}# ${canonical}\n${aliasLine}`,
  );
}

function insertFact(
  ctx: ToolContext,
  id: string,
  subject: string,
  predicate: string,
  object: string,
  fromChapter: number,
): void {
  ctx.db
    .prepare(
      `INSERT INTO facts (id, novel_id, subject, predicate, object, from_chapter)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ctx.novelId, subject, predicate, object, fromChapter);
}

describe("G1b·脚手架结构确定性测试（切片 #304，零 LLM）", () => {
  it("① alias_table 非空：两个角色档案 → 转置表含 canonical + uid", async () => {
    const { ctx, root } = setup();
    writeCharacterFile(root, "张三", "uid-zhangsan", ["三哥", "老张"]);
    writeCharacterFile(root, "李四", "uid-lisi", ["四弟"]);

    const r = (await novelExtractionScaffold({ chapter: 5 }, ctx)) as ScaffoldResult;
    expect(r.ok).toBe(true);
    expect(r.alias_table.length).toBeGreaterThanOrEqual(2);
    const zhangsan = r.alias_table.find((e) => e.canonical === "张三");
    expect(zhangsan).toBeDefined();
    expect(zhangsan?.uid).toBe("uid-zhangsan");
    expect(zhangsan?.aliases).toEqual(expect.arrayContaining(["三哥", "老张"]));
  });

  it("② known_facts_summary 章号边界：只返回 from_chapter < chapter 的事实", async () => {
    const { ctx } = setup();
    insertFact(ctx, "f1", "张三", "location", "京城", 3);
    insertFact(ctx, "f2", "张三", "injury", "断臂", 4);
    insertFact(ctx, "f3", "张三", "status", "重伤", 5); // 当前章，应被排除

    const r = (await novelExtractionScaffold({ chapter: 5 }, ctx)) as ScaffoldResult;
    expect(r.known_facts_summary).toHaveLength(2);
    expect(r.known_facts_summary.every((f) => f.from_chapter < 5)).toBe(true);
  });

  it("③ predicate_cheatsheet 恒为 12 项且含核心谓词", async () => {
    const { ctx } = setup();
    const r = (await novelExtractionScaffold({ chapter: 1 }, ctx)) as ScaffoldResult;
    expect(r.predicate_cheatsheet).toHaveLength(12);
    expect(r.predicate_cheatsheet).toContain("identity");
    expect(r.predicate_cheatsheet).toContain("injury");
    expect(r.predicate_cheatsheet).toContain("status");
    expect(r.predicate_cheatsheet).toContain("relationship");
  });

  it("④ token_estimate 受控：典型项目（8 角色×1 别名 + 12 facts）< 800（宁短勿长）", async () => {
    const { ctx, root } = setup();
    for (let i = 0; i < 8; i++) {
      writeCharacterFile(root, `角色${i}`, `uid-${i}`, [`别名${i}`]);
    }
    for (let i = 0; i < 12; i++) {
      insertFact(ctx, `mid-${i}`, `角色${i % 8}`, "status", `状态描述${i}`, 1);
    }

    const r = (await novelExtractionScaffold({ chapter: 100 }, ctx)) as ScaffoldResult;
    expect(r.token_estimate).toBeLessThan(800);
  });

  it("⑤ token_estimate 极端密度仍受控：20 角色×2 别名 + 30 facts → LIMIT 30 截断、总量 < 1500", async () => {
    // 全 CJK 极端密度（每字≈1 token）下，alias_table≈485 + facts≈793 + 谓词表≈37 ≈ 1333。
    // 仍 < 1500、且只占 WCP 总预算 12000 的 ~11%；known_facts_summary 由 LIMIT 30 机械封顶。
    // 脚手架是独立只读工具、不进 WCP，无需 800 硬上限；本断言守「随语料增长仍有界」。
    const { ctx, root } = setup();
    for (let i = 0; i < 20; i++) {
      writeCharacterFile(root, `角色${i}`, `uid-${i}`, [`别名甲${i}`, `别名乙${i}`]);
    }
    for (let i = 0; i < 40; i++) {
      insertFact(ctx, `bulk-${i}`, `角色${i % 20}`, "status", `状态描述${i}`, 1);
    }

    const r = (await novelExtractionScaffold({ chapter: 100 }, ctx)) as ScaffoldResult;
    expect(r.known_facts_summary).toHaveLength(30); // LIMIT 30 截断生效（库里 40 条只回 30）
    expect(r.token_estimate).toBeLessThan(1500);
  });

  it("⑥ 写隔离：调用前后 facts 行数不变（纯只读）", async () => {
    const { ctx, root } = setup();
    writeCharacterFile(root, "张三", "uid-zhangsan", ["三哥"]);
    insertFact(ctx, "g1", "张三", "location", "京城", 1);
    const countStmt = ctx.db.prepare("SELECT COUNT(*) AS n FROM facts");
    const before = (countStmt.get() as { n: number }).n;

    await novelExtractionScaffold({ chapter: 5 }, ctx);

    const after = (countStmt.get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it("⑦ 参数校验：chapter 缺失 / 非正整数 → ok:false 带 errors", async () => {
    const { ctx } = setup();
    const r = (await novelExtractionScaffold({}, ctx)) as { ok: boolean; errors: unknown[] };
    expect(r.ok).toBe(false);
    expect(Array.isArray(r.errors)).toBe(true);
  });
});
