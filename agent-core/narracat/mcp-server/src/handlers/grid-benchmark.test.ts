/**
 * 网格对标尺测试（issue #428 / M2R.2）
 *
 * 跑：cd mcp-server && npx vitest run src/handlers/grid-benchmark.test.ts
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

import { initSchema } from "../migrate.js";
import type { ToolContext } from "../types.js";
import {
  resolveDriveBucket,
  computeHookNoneRate,
  computePayoffInterval,
  collectSubmittedChapters,
  rankAmongBooks,
  buildGridBenchmark,
  buildBenchmarkNote,
  novelGetGridBenchmark,
  GRID_BENCHMARK_THRESHOLDS,
  GRID_BENCHMARK_TABLE,
  buildArcVelocityTarget,
  novelGetArcVelocityTarget,
} from "./grid-benchmark.js";

// ============================================================
// resolveDriveBucket
// ============================================================

describe("resolveDriveBucket", () => {
  it("精确关键词命中 → 无 note（非近似）", () => {
    expect(resolveDriveBucket("现代都市甜宠")).toEqual({ bucket: "high_frequency_small", note: null });
    expect(resolveDriveBucket("东方玄幻升级流")).toEqual({ bucket: "mid_large_escalation", note: null });
    expect(resolveDriveBucket("无限流悬疑推理")).toEqual({ bucket: "delayed_payoff", note: null });
  });

  it("setup.md 例举词覆盖：修真/修仙/系统流/都市异能 → 中大爽升级型", () => {
    expect(resolveDriveBucket("东方修仙·升级流").bucket).toBe("mid_large_escalation");
    expect(resolveDriveBucket("系统流爽文").bucket).toBe("mid_large_escalation");
    expect(resolveDriveBucket("都市异能觉醒").bucket).toBe("mid_large_escalation");
  });

  it("古代言情类命中 → 近似归位到高频小爽型，note 显式声明近似", () => {
    const r = resolveDriveBucket("古代言情宅斗");
    expect(r.bucket).toBe("high_frequency_small");
    expect(r.note).toMatch(/近似归位/);
  });

  it("未识别关键词 → 回退 global，note 显式声明回退", () => {
    const r = resolveDriveBucket("青春校园无CP");
    expect(r.bucket).toBe("global");
    expect(r.note).toMatch(/未识别出驱动特征关键词/);
  });

  it("genre 为空/未设置 → 回退 global，note 显式声明未设置", () => {
    expect(resolveDriveBucket(null).bucket).toBe("global");
    expect(resolveDriveBucket(null).note).toMatch(/未设置 genre/);
    expect(resolveDriveBucket(undefined).bucket).toBe("global");
    expect(resolveDriveBucket("   ").bucket).toBe("global");
  });
});

// ============================================================
// computeHookNoneRate / computePayoffInterval（边界：零提交/单章/跨卷）
// ============================================================

describe("computeHookNoneRate", () => {
  it("零提交 → null", () => {
    expect(computeHookNoneRate([])).toBeNull();
  });

  it("单章且无 end_hook 字段 → null（分母为0，不编造）", () => {
    expect(computeHookNoneRate([{ chapter: 1 }])).toBeNull();
  });

  it("单章且有 end_hook → 可计算(0% 或 100%)", () => {
    expect(computeHookNoneRate([{ chapter: 1, end_hook: "none" }])).toEqual({ value_pct: 100, n: 1 });
    expect(computeHookNoneRate([{ chapter: 1, end_hook: "danger" }])).toEqual({ value_pct: 0, n: 1 });
  });

  it("缺字段的章不计入分母（老数据兼容，同 checkHookCadence 语义）", () => {
    const r = computeHookNoneRate([
      { chapter: 1, end_hook: "none" },
      { chapter: 2 }, // 缺字段，不计
      { chapter: 3, end_hook: "danger" },
      { chapter: 4, end_hook: "none" },
    ]);
    expect(r).toEqual({ value_pct: +((2 / 3) * 100).toFixed(1), n: 3 });
  });
});

describe("computePayoffInterval", () => {
  it("零提交 → null", () => {
    expect(computePayoffInterval([])).toBeNull();
  });

  it("单章 → null（无相邻对，算不出间隔）", () => {
    expect(computePayoffInterval([{ chapter: 1, payoff_beat: "reveal" }])).toBeNull();
  });

  it("全部无 payoff_beat → null", () => {
    expect(computePayoffInterval([{ chapter: 1 }, { chapter: 2 }])).toBeNull();
  });

  it("跨卷连续章号：间隔按全局章号差算，不因跨卷断档", () => {
    // 卷1第12章、卷2第13/16章各有 payoff_beat：间隔 = 1, 3
    const r = computePayoffInterval([
      { chapter: 12, payoff_beat: "reveal" },
      { chapter: 13, payoff_beat: "sweet" },
      { chapter: 16, payoff_beat: "level_up" },
    ]);
    expect(r).toEqual({ median: 2, n: 2 }); // gaps=[1,3] → median=2
  });
});

// ============================================================
// rankAmongBooks（书间名次对照——池化比例≠书间中位的 P3 修正核心）
// ============================================================

describe("rankAmongBooks", () => {
  const rates = [10, 20, 30, 40, 50] as const;

  it("低于全部 → books_below 0", () => {
    expect(rankAmongBooks(5, rates)).toEqual({ n_books: 5, books_below: 0, median_pct: 30 });
  });

  it("高于全部 → books_below = n", () => {
    expect(rankAmongBooks(99, rates)).toEqual({ n_books: 5, books_below: 5, median_pct: 30 });
  });

  it("落中间 → 只数严格更低的", () => {
    expect(rankAmongBooks(35, rates).books_below).toBe(3); // 10/20/30
  });

  it("相等值不算「高于」", () => {
    expect(rankAmongBooks(30, rates).books_below).toBe(2); // 10/20；30 相等不计
  });

  it("偶数本 → 中位取中间两值均值", () => {
    expect(rankAmongBooks(0, [10, 20, 30, 40]).median_pct).toBe(25);
  });

  it("桶样本极小(n=5，攒糖桶实况)也给出诚实名次，不编分位数", () => {
    const delayedPayoff = GRID_BENCHMARK_TABLE.delayed_payoff.hook_none_rate_by_book_pct;
    const r = rankAmongBooks(20, delayedPayoff); // [7.8,12.9,17.3,57,78.8]
    expect(r).toEqual({ n_books: 5, books_below: 3, median_pct: 17.3 });
  });
});

// ============================================================
// collectSubmittedChapters / buildGridBenchmark / novelGetGridBenchmark
// （用手写 arc_meta + outline JSON 文件模拟已提交章纲，绕开完整 submit 校验链）
// ============================================================

interface Fixture {
  ctx: ToolContext;
  root: string;
  db: Database.Database;
}

let cleanupPaths: string[] = [];
afterEach(() => {
  for (const p of cleanupPaths) rmSync(p, { recursive: true, force: true });
  cleanupPaths = [];
});

function createFixture(genre: string | null = null): Fixture {
  const root = mkdtempSync(join(tmpdir(), "narracat-grid-benchmark-"));
  cleanupPaths.push(root);
  const db = new Database(":memory:");
  initSchema(db);
  return {
    root,
    db,
    ctx: {
      novelId: "novel-test",
      db,
      projectRoot: root,
      estimatedTotalChapters: 60,
      wordsPerChapter: 3000,
      styleProfile: "web_standard",
      genre,
    },
  };
}

function insertArc(
  db: Database.Database,
  arc: { arc_id: string; volume_no: number; chapter_start: number; chapter_end: number },
): void {
  db.prepare(
    `INSERT INTO arc_meta (novel_id, arc_id, volume_no, title, chapter_start, chapter_end, core_question, irreversible_change, next_arc_seed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("novel-test", arc.arc_id, arc.volume_no, "测试 arc", arc.chapter_start, arc.chapter_end, "q", "c", "s");
}

/** 写 outline/vol-VV/ch-NNN.json（不经过完整 novel_submit_chapter_outline 校验链，只模拟落盘产物） */
function writeChapterJson(
  root: string,
  volume: number,
  chapter: number,
  fields: { end_hook?: string; payoff_beat?: string },
): void {
  const volDir = join(root, "outline", `vol-${String(volume).padStart(2, "0")}`);
  mkdirSync(volDir, { recursive: true });
  const padded = String(chapter).padStart(3, "0");
  writeFileSync(
    join(volDir, `ch-${padded}.json`),
    JSON.stringify({
      chapter,
      title: `第${chapter}章`,
      positioning: "测试定位",
      beats: ["入场", "推进", "收尾"],
      storyline_focus: [],
      characters: [],
      pov_character: { character_uid: "11111111-1111-4111-8111-111111111111", name: "测试角色" },
      ...fields,
    }),
  );
}

describe("collectSubmittedChapters", () => {
  it("按 arc_meta 声明的范围遍历，未落盘的章跳过", () => {
    const { ctx, root } = createFixture();
    insertArc(ctx.db, { arc_id: "V01-A01", volume_no: 1, chapter_start: 1, chapter_end: 3 });
    writeChapterJson(root, 1, 1, { end_hook: "danger", payoff_beat: "reveal" });
    // ch2 未落盘
    writeChapterJson(root, 1, 3, { end_hook: "none" });
    return collectSubmittedChapters(ctx).then((chs) => {
      expect(chs.map((c) => c.chapter)).toEqual([1, 3]);
    });
  });

  it("零提交（无 arc_meta）→ 空数组", async () => {
    const { ctx } = createFixture();
    expect(await collectSubmittedChapters(ctx)).toEqual([]);
  });
});

describe("buildGridBenchmark / novel_get_grid_benchmark", () => {
  it("样本不足（< 阈值）→ ok:true + 说明「数据不足」，无 metrics", async () => {
    const { ctx, root } = createFixture();
    insertArc(ctx.db, { arc_id: "V01-A01", volume_no: 1, chapter_start: 1, chapter_end: 5 });
    for (let c = 1; c <= 5; c += 1) writeChapterJson(root, 1, c, { end_hook: "danger" });

    const result = await buildGridBenchmark(ctx);
    expect(result.ok).toBe(true);
    expect(result.sample_size).toBe(5);
    expect(result.drive_bucket).toBeNull();
    expect(result.metrics).toEqual({});
    expect(result.note).toContain("样本不足");
    expect(result.note).toContain(String(GRID_BENCHMARK_THRESHOLDS.min_sample_chapters));
  });

  it("零提交 → sample_size 0，ok:true，不报错", async () => {
    const { ctx } = createFixture();
    const result = await buildGridBenchmark(ctx);
    expect(result.ok).toBe(true);
    expect(result.sample_size).toBe(0);
    expect(result.note).toContain("样本不足");
  });

  it("达到阈值 + genre 精确命中 → 报驱动桶百分位读数，永远 ok:true", async () => {
    const { ctx, root } = createFixture("现代都市甜宠");
    insertArc(ctx.db, { arc_id: "V01-A01", volume_no: 1, chapter_start: 1, chapter_end: 24 });
    for (let c = 1; c <= 24; c += 1) {
      writeChapterJson(root, 1, c, {
        end_hook: c % 3 === 0 ? "none" : "danger",
        payoff_beat: c % 4 === 0 ? "reveal" : undefined,
      });
    }
    const result = await buildGridBenchmark(ctx);
    expect(result.ok).toBe(true);
    expect(result.sample_size).toBe(24);
    expect(result.drive_bucket).toBe("high_frequency_small");
    expect(result.bucket_note).toBeNull();
    expect(result.metrics.hook_none_rate).toBeDefined();
    expect(result.metrics.payoff_interval).toBeDefined();
    // 名次对照：n=43 本、books_below 与手算一致、书间中位来自逐书数组而非池化比例
    const hm = result.metrics.hook_none_rate;
    expect(hm?.n_benchmark_books).toBe(
      GRID_BENCHMARK_TABLE.high_frequency_small.hook_none_rate_by_book_pct.length,
    );
    expect(hm?.benchmark_book_median_pct).toBe(32); // 43 本升序数组第 22 个
    // 24 章 8 个 none → 33.3%，高于数组中 <33.3 的 23 本
    expect(hm?.value_pct).toBeCloseTo(33.3, 1);
    expect(hm?.books_below).toBe(23);
    expect(hm?.reading).toContain("本头部书中的");
    expect(result.note).toContain("高于同类 43 本头部书中的 23 本");
    expect(result.note).toContain("同类头部章间隔中位");
    expect(result.note).toContain("仅供参考，不影响提交");
    // 工具入口同一结果
    const viaTool = await novelGetGridBenchmark({}, ctx);
    expect(viaTool).toEqual(result);
  });

  it("genre 归位不上 → 回退全局池且 note 显式注明回退", async () => {
    const { ctx, root } = createFixture("青春校园无CP");
    insertArc(ctx.db, { arc_id: "V01-A01", volume_no: 1, chapter_start: 1, chapter_end: 20 });
    for (let c = 1; c <= 20; c += 1) writeChapterJson(root, 1, c, { end_hook: "danger" });
    const result = await buildGridBenchmark(ctx);
    expect(result.drive_bucket).toBe("global");
    expect(result.bucket_note).toMatch(/未识别出驱动特征关键词/);
    expect(result.note).toContain("未识别出驱动特征关键词");
  });
});

describe("buildBenchmarkNote（供 novel_submit_chapter_outline 追加用）", () => {
  it("样本不足 → 返回 null（调用方不追加字段）", async () => {
    const { ctx, root } = createFixture();
    insertArc(ctx.db, { arc_id: "V01-A01", volume_no: 1, chapter_start: 1, chapter_end: 3 });
    for (let c = 1; c <= 3; c += 1) writeChapterJson(root, 1, c, { end_hook: "danger" });
    expect(await buildBenchmarkNote(ctx)).toBeNull();
  });

  it("达到阈值 → 返回非空中文说明", async () => {
    const { ctx, root } = createFixture();
    insertArc(ctx.db, { arc_id: "V01-A01", volume_no: 1, chapter_start: 1, chapter_end: 20 });
    for (let c = 1; c <= 20; c += 1) {
      writeChapterJson(root, 1, c, {
        end_hook: c % 3 === 0 ? "none" : "danger",
        payoff_beat: c % 5 === 0 ? "reveal" : undefined,
      });
    }
    const note = await buildBenchmarkNote(ctx);
    expect(note).not.toBeNull();
    expect(note).toContain("仅供参考，不影响提交");
  });
});

function ctxWith(genre: string | null): any {
  return { genre };
}

describe("buildArcVelocityTarget", () => {
  it("按 genre 归桶取靶，brief 含数字（数据、非 prompt）", () => {
    const r = buildArcVelocityTarget(ctxWith("都市异能·系统流"));
    expect(r.ok).toBe(true);
    expect(r.drive_bucket).toBe("mid_large_escalation");
    expect(r.target.opening_window).toBe(15);
    expect(typeof r.target.max_dormancy_run).toBe("number");
    expect(r.brief).toMatch(/主线/);
    expect(r.brief).toMatch(new RegExp(`休眠超 ${Math.round(r.target.max_dormancy_run)} 章`));
  });

  it("genre 归不上桶时回退 global 并在 bucket_note 说明", () => {
    const r = buildArcVelocityTarget(ctxWith(null));
    expect(r.drive_bucket).toBe("global");
    expect(r.bucket_note).toMatch(/全局/);
  });

  it("novelGetArcVelocityTarget 返回本书靶", async () => {
    const r = (await novelGetArcVelocityTarget({}, ctxWith("玄幻") as any)) as any;
    expect(r.ok).toBe(true);
    expect(r.target.opening_window).toBe(15);
  });
});
