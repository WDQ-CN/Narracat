/**
 * 网格对标尺（issue #428 / M2R.2）—— novel_get_grid_benchmark
 *
 * 只读、只度量、不阻断（ADR-0030 评价层）：把本书已提交章纲的两个实测值
 * （章末钩 none 率 / 爽点间隔）摆到 59 部头部网文的驱动特征分布上，报一个中文读数。
 * 不产生 errors[]，不产生新的 warnings[] 词条——不是判断，是对照。
 *
 * 设计见 docs/plans/2026-07-08-grid-benchmark-design.md。本轮只做维度 1+2（章末钩 none 率 /
 * 爽点间隔，不分强度）；维度 3「施压-释放节奏」需要 downturn 类字段，留白待 M2R.3。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArcMetaRow, ToolContext } from "../types.js";
import type { ChapterOutlineItem } from "./validators.js";
import { chapterFileSegment, volumeDirSegment } from "./state-sync.js";

// ============================================================
// 驱动特征归位（口径与 scripts/corpus-factory/lib/grid-stats.mjs 的 DRIVE_BUCKET_MAP 同源，
// 两侧各自维护但语义对齐——设计 §2.2）
// ============================================================

export type DriveBucket = "high_frequency_small" | "mid_large_escalation" | "delayed_payoff";

interface DriveBucketRule {
  bucket: DriveBucket;
  /** genre 自由文本命中任一关键词即归入该桶（数组顺序=优先级，先中先得） */
  keywords: readonly string[];
  /** true = 该规则本身是粗归近似（如古代言情），需要在对标文案里显式注明 */
  approx?: boolean;
}

// 关键词覆盖 agent-core/narracat/commands/setup.md「金手指反馈回路」既有三档定义的例举词
// （高频小爽：甜宠/纯爱/现言/宅斗/种田日常；中大爽升级：玄幻/修真/科幻末世/系统流/都市异能；
// 攒糖引爆：悬疑/无限流/推理/诡秘），供关键词兜底匹配用户自由文本 genre（如「东方修仙·升级流」）。
const DRIVE_BUCKET_RULES: readonly DriveBucketRule[] = [
  {
    // 古代言情类关键词优先于下面的通用高频小爽关键词判断——"宅斗"/"种田"本身在两条规则里都可能
    // 出现（古代宅斗 vs 现代宅斗），古代言情类信号更具体，排在前面先命中才能正确标近似。
    // 古代言情粗组混宫廷权谋（偏中大爽升级）与宅斗成长（偏高频小爽），按数量占优粗归高频小爽型——
    // 非精确科学分类，是「非题材标签硬归」精神下的兜底近似（设计 §3 开放问题2）
    bucket: "high_frequency_small",
    keywords: ["古代言情", "古言", "宫斗", "宫廷"],
    approx: true,
  },
  {
    bucket: "high_frequency_small",
    keywords: ["纯爱", "现代言情", "都市情感", "甜宠", "现言", "宅斗", "种田", "日常"],
  },
  {
    bucket: "mid_large_escalation",
    keywords: ["玄幻", "异能", "修真", "修仙", "科幻", "末世", "系统流", "都市异能"],
  },
  {
    bucket: "delayed_payoff",
    keywords: ["悬疑", "无限流", "推理", "诡秘"],
  },
];

export interface DriveBucketResolution {
  bucket: DriveBucket | "global";
  /** 非 null = 需要在对标文案里显式注明的近似归位/回退全局池说明；精确命中时为 null */
  note: string | null;
}

/**
 * genre 自由文本 → 驱动特征桶。命中不了任何关键词（或 genre 为空）→ 回退 "global"，
 * 不报错、不阻断——这是「非题材标签硬归」的兜底，不是失败态（设计 §2.2B）。
 */
export function resolveDriveBucket(genre: string | null | undefined): DriveBucketResolution {
  const g = (genre ?? "").trim();
  if (g) {
    for (const rule of DRIVE_BUCKET_RULES) {
      if (rule.keywords.some((kw) => g.includes(kw))) {
        return {
          bucket: rule.bucket,
          note: rule.approx
            ? `genre「${g}」按驱动特征近似归位（古代言情类题材混合中大爽升级/高频小爽两种子倾向，按数量占优粗归，非精确判定）`
            : null,
        };
      }
    }
  }
  return {
    bucket: "global",
    note: g
      ? `genre「${g}」未识别出驱动特征关键词，对照全局分布（非按驱动特征细分）`
      : "未设置 genre，对照全局分布（非按驱动特征细分）",
  };
}

// ============================================================
// 静态对照表：手工蒸馏自 corpus-factory-data/grid/grid-stats.json 的 by_drive_bucket / global
// （scripts/corpus-factory/grid-stats.mjs 产出，该目录 gitignore 不入仓，数字随源码提交）。
//
// 数据口径：59 部头部网文 / 23,853 章，生成于 2026-07-07（issue #428 片1；PR #434 评审 P3 修正）。
//
// 两个维度的统计语义刻意不同，别混：
// - 章末钩 none 率是**书间对比量**——存排序后的逐书 none 率数组（按书先算、再收集），运行时
//   与本书比名次。不能用池化比例（章加权，长书被放大）冒充书间中位：实测 delayed_payoff 桶
//   池化 28.9% vs 逐书中位 17.3%，差 11.6 个百分点。且小桶（5/8 本）报「百分位」就是编数，
//   名次表述在任何 n 下都诚实。
// - 爽点间隔是**章级量**——池化的章间隔分布（数千个章间隔样本）当「同类头部章间隔分布」讲
//   成立，保留分位数表述。
//
// 逐书 none 率中位参考：high_frequency_small 32.0（范围 9.5-65.8）/ mid_large_escalation
// 25.8（10.2-46.9）/ delayed_payoff 17.3（7.8-78.8）/ global 30.9（7.8-78.8）。
// 复核命令：node scripts/corpus-factory/grid-stats.mjs（需本机 corpus-factory-data/grid 存在），
// 对 grid-stats.json 各桶的 chapter_end_hook.none_rate_by_book_pct 与 payoff.interval_combined。
// ============================================================

export const GRID_BENCHMARK_TABLE: Record<
  DriveBucket | "global",
  {
    /** 逐书章末钩 none 率（%），升序。书间对比量，运行时按名次对照 */
    hook_none_rate_by_book_pct: readonly number[];
    /** 章级爽点间隔分位数（池化章间隔分布，非书间统计） */
    payoff_interval_chapters: { p25: number; median: number; p75: number; p90: number };
  }
> = {
  high_frequency_small: {
    // 43 本（纯爱/现代言情/古代言情近似）
    hook_none_rate_by_book_pct: [
      9.5, 11.6, 11.8, 13.5, 13.9, 17.8, 18.6, 19.3, 19.6, 20.5, 20.8, 21.9, 22.9, 24.4, 24.6,
      25.6, 25.8, 26.5, 27.4, 27.6, 30.9, 32, 32.3, 33.5, 34.5, 35.2, 36.1, 37.9, 38.4, 40,
      43.2, 43.3, 43.5, 44, 45.5, 47.7, 51.1, 55.1, 56.5, 57.3, 58.2, 59.7, 65.8,
    ],
    payoff_interval_chapters: { p25: 1, median: 1, p75: 2, p90: 3 },
  },
  mid_large_escalation: {
    // 8 本（玄幻异能/科幻末世）
    hook_none_rate_by_book_pct: [10.2, 15.6, 24.1, 25.1, 26.5, 32, 35, 46.9],
    payoff_interval_chapters: { p25: 1, median: 1, p75: 2, p90: 3 },
  },
  delayed_payoff: {
    // 5 本（悬疑无限流）
    hook_none_rate_by_book_pct: [7.8, 12.9, 17.3, 57, 78.8],
    payoff_interval_chapters: { p25: 1, median: 1, p75: 2, p90: 4 },
  },
  global: {
    // 全部 59 本（含未归位的"其他"3 本）
    hook_none_rate_by_book_pct: [
      7.8, 9.5, 10.2, 11.6, 11.8, 12.9, 13.5, 13.9, 15.6, 17.3, 17.8, 18.6, 19.3, 19.6, 20.5,
      20.8, 21.9, 22.2, 22.9, 24.1, 24.4, 24.6, 25.1, 25.6, 25.8, 26.5, 26.5, 27.4, 27.6, 30.9,
      32, 32, 32, 32.3, 33.5, 34.5, 35, 35.2, 36.1, 37.9, 38.4, 40, 43.2, 43.3, 43.5, 44, 45.5,
      46.9, 47.7, 51.1, 55.1, 56.5, 57, 57.3, 58.2, 58.3, 59.7, 65.8, 78.8,
    ],
    payoff_interval_chapters: { p25: 1, median: 1, p75: 2, p90: 3 },
  },
};

/** arc 速度靶开局窗口（章）——与 corpus 蒸馏侧 openingPropulsionRatio 的 windowN 对齐 */
export const ARC_VELOCITY_OPENING_WINDOW = 15;

/**
 * arc 层定速靶（阶段一前馈 + 提交后软量对照）——手工蒸馏自 corpus grid 逐章推进力分布，
 * 口径与 scripts/corpus-factory/lib/grid-stats.mjs 的 chapterPropulsion/zeroPropulsionMaxRun/
 * openingPropulsionRatio 同源。护栏取宽松界：max_dormancy_run 取逐书 p90（只拦比 90% 头部更慢的），
 * opening_propulsion_ratio_pct 取逐书 p25（只拦落到头部下四分位以下的）。
 * 复核命令：node scripts/corpus-factory/grid-stats.mjs（需本机 corpus-factory-data/grid）。
 * 数字口径：59 部头部网文 / 23,853 章，蒸馏于 2026-07-09。
 */
export const ARC_VELOCITY_TARGET_TABLE: Record<
  DriveBucket | "global",
  { max_dormancy_run: number; opening_propulsion_ratio_pct: number }
> = {
  high_frequency_small: { max_dormancy_run: 7, opening_propulsion_ratio_pct: 73.3 },
  mid_large_escalation: { max_dormancy_run: 6.8, opening_propulsion_ratio_pct: 78.33 },
  delayed_payoff: { max_dormancy_run: 5.2, opening_propulsion_ratio_pct: 80 },
  global: { max_dormancy_run: 7, opening_propulsion_ratio_pct: 73.3 },
};

/**
 * 最小样本量阈值：已提交章数 < 此值时判「样本不足」，不勉强出对照读数；
 * novel_submit_chapter_outline 的 benchmark_note 追加复用同一阈值。
 *
 * 核算依据（基于 corpus-factory-data/grid/grid-stats.json 实测分布，2026-07-07）：
 * - 爽点间隔：全局 payoff≠none 覆盖率 57.2%（100% - none 谱 42.8%）。已提交 N 章时期望
 *   payoff 事件数 ≈0.572N，期望可算间隔样本数 ≈0.572N-1。N=10 时仅 ≈4.7 个间隔——明显
 *   不够算出稳定中位数；N=20 时 ≈10.4 个间隔，是"不算太噪"的下限。
 * - 章末钩 none 率：比例估计标准误 SE=√(p(1-p)/n)，全局 none 率 p≈0.301。N=10 时
 *   SE≈14.5 个百分点（噪声过大）；N=20 时 SE≈10.2 个百分点（仍偏噪但配合"仅供参考、
 *   不影响提交"的定位可接受）。
 * 两个维度都指向 20 章量级，取 20 为最小样本量阈值。
 */
export const GRID_BENCHMARK_THRESHOLDS = {
  min_sample_chapters: 20,
} as const;

// ============================================================
// 计算：从已提交章纲算两维实测值
// ============================================================

interface CollectedChapter {
  chapter: number;
  end_hook?: ChapterOutlineItem["end_hook"];
  payoff_beat?: ChapterOutlineItem["payoff_beat"];
}

/**
 * 读全书已提交章纲（outline/vol-VV/ch-NNN.json），按 arc_meta 声明的章号范围遍历，
 * 文件不存在（未规划）/ JSON 损坏一律跳过——与 checkHookCadence/checkOpeningRetention
 * 同款读盘容错，不阻断。返回按章号升序。
 */
export async function collectSubmittedChapters(ctx: ToolContext): Promise<CollectedChapter[]> {
  const arcRows = ctx.db
    .prepare(
      `SELECT arc_id, volume_no, chapter_start, chapter_end FROM arc_meta WHERE novel_id = ?`,
    )
    .all(ctx.novelId) as Array<Pick<ArcMetaRow, "arc_id" | "volume_no" | "chapter_start" | "chapter_end">>;

  const out: CollectedChapter[] = [];
  for (const arc of arcRows) {
    const volDir = volumeDirSegment(arc.volume_no);
    for (let c = arc.chapter_start; c <= arc.chapter_end; c += 1) {
      const jsonPath = join(ctx.projectRoot, "outline", volDir, `ch-${chapterFileSegment(c)}.json`);
      if (!existsSync(jsonPath)) continue;
      try {
        const parsed = JSON.parse(await readFile(jsonPath, "utf-8")) as ChapterOutlineItem;
        out.push({ chapter: c, end_hook: parsed.end_hook, payoff_beat: parsed.payoff_beat });
      } catch {
        // 落盘 JSON 损坏 → 跳过该章，不阻断统计
      }
    }
  }
  out.sort((a, b) => a.chapter - b.chapter);
  return out;
}

/** 章末钩 none 率：分母只算已声明 end_hook 字段的章（缺字段的存量章不计入，语义同 checkHookCadence 的 unknown 态） */
export function computeHookNoneRate(
  chapters: CollectedChapter[],
): { value_pct: number; n: number } | null {
  const withHook = chapters.filter((c) => c.end_hook !== undefined && c.end_hook !== null);
  if (withHook.length === 0) return null;
  const noneCount = withHook.filter((c) => c.end_hook === "none").length;
  return { value_pct: +((noneCount / withHook.length) * 100).toFixed(1), n: withHook.length };
}

/** 爽点间隔（不分强度）：相邻两个 payoff_beat 非空的章号差，按章号升序算，跨卷章号连续不特殊处理 */
export function computePayoffInterval(
  chapters: CollectedChapter[],
): { median: number; n: number } | null {
  const sorted = [...chapters].sort((a, b) => a.chapter - b.chapter);
  const gaps: number[] = [];
  let lastChapter: number | null = null;
  for (const c of sorted) {
    if (c.payoff_beat == null) continue;
    if (lastChapter !== null) gaps.push(c.chapter - lastChapter);
    lastChapter = c.chapter;
  }
  if (gaps.length === 0) return null;
  const s = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return { median: +median.toFixed(2), n: gaps.length };
}

/**
 * 章级分位数读数（仅爽点间隔用——池化章间隔分布样本量数千，分位数表述成立；
 * 章末钩 none 率是书间量，走 rankAmongBooks 名次表述，禁用分位数措辞）。
 */
function intervalBandLabel(
  value: number,
  q: { p25: number; median: number; p75: number; p90: number },
): string {
  if (value > q.p90) return "高于同类章间隔P90（同类头部书少见）";
  if (value > q.p75) return "高于同类章间隔P75";
  if (value > q.median) return "略高于同类章间隔中位";
  if (value === q.median) return "接近同类章间隔中位";
  if (value >= q.p25) return "略低于同类章间隔中位";
  return "低于同类章间隔P25";
}

/**
 * 书间名次对照：本书值在同类逐书数组（升序）里高于多少本。
 * 名次表述在任何 n 下都诚实（攒糖桶只有 5 本，报 p90 就是编数）；相等值不算「高于」。
 */
export function rankAmongBooks(
  value: number,
  sortedRatesAsc: readonly number[],
): { n_books: number; books_below: number; median_pct: number } {
  const n = sortedRatesAsc.length;
  const booksBelow = sortedRatesAsc.filter((r) => r < value).length;
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sortedRatesAsc[mid] : (sortedRatesAsc[mid - 1] + sortedRatesAsc[mid]) / 2;
  return { n_books: n, books_below: booksBelow, median_pct: +median.toFixed(1) };
}

// ============================================================
// novel_get_grid_benchmark
// ============================================================

/** 章末钩 none 率指标：书间名次对照（不用池化比例冒充书间中位，不用分位数措辞） */
interface HookNoneRateMetric {
  value_pct: number;
  /** 同类逐书对照本数 */
  n_benchmark_books: number;
  /** 本书 none 率高于同类多少本（相等不计） */
  books_below: number;
  /** 同类逐书 none 率中位（书间统计量，非池化比例） */
  benchmark_book_median_pct: number;
  reading: string;
}

/** 爽点间隔指标：章级分位数对照（池化章间隔分布，样本量数千，分位数表述成立） */
interface PayoffIntervalMetric {
  value_median: number;
  /** 同类头部章间隔中位（章级量，非书间统计） */
  benchmark_chapter_median: number;
  reading: string;
}

export interface GridBenchmarkResult {
  ok: true;
  sample_size: number;
  drive_bucket: DriveBucket | "global" | null;
  bucket_note: string | null;
  metrics: {
    hook_none_rate?: HookNoneRateMetric;
    payoff_interval?: PayoffIntervalMetric;
  };
  note: string;
}

/** 核心计算：供 novel_get_grid_benchmark 工具与 novel_submit_chapter_outline 的 benchmark_note 共用 */
export async function buildGridBenchmark(ctx: ToolContext): Promise<GridBenchmarkResult> {
  const chapters = await collectSubmittedChapters(ctx);
  const sampleSize = chapters.length;

  if (sampleSize < GRID_BENCHMARK_THRESHOLDS.min_sample_chapters) {
    return {
      ok: true,
      sample_size: sampleSize,
      drive_bucket: null,
      bucket_note: null,
      metrics: {},
      note: `已提交 ${sampleSize} 章，样本不足（对标尺最少需 ${GRID_BENCHMARK_THRESHOLDS.min_sample_chapters} 章）——数据不足，暂不对标`,
    };
  }

  const resolution = resolveDriveBucket(ctx.genre);
  const table = GRID_BENCHMARK_TABLE[resolution.bucket];

  const metrics: GridBenchmarkResult["metrics"] = {};
  const noteParts: string[] = [];

  const hookNone = computeHookNoneRate(chapters);
  if (hookNone) {
    const rank = rankAmongBooks(hookNone.value_pct, table.hook_none_rate_by_book_pct);
    const reading = `你的章末钩 none 率 ${hookNone.value_pct}%，高于同类 ${rank.n_books} 本头部书中的 ${rank.books_below} 本（同类逐书中位 ${rank.median_pct}%）`;
    metrics.hook_none_rate = {
      value_pct: hookNone.value_pct,
      n_benchmark_books: rank.n_books,
      books_below: rank.books_below,
      benchmark_book_median_pct: rank.median_pct,
      reading,
    };
    noteParts.push(reading);
  }

  const interval = computePayoffInterval(chapters);
  if (interval) {
    const label = intervalBandLabel(interval.median, table.payoff_interval_chapters);
    metrics.payoff_interval = {
      value_median: interval.median,
      benchmark_chapter_median: table.payoff_interval_chapters.median,
      reading: label,
    };
    noteParts.push(
      `爽点间隔${label}（同类头部章间隔中位约${table.payoff_interval_chapters.median}章，本书约${interval.median}章）`,
    );
  }

  const approxNote = resolution.note ? `${resolution.note}。` : "";
  const body = noteParts.length > 0 ? noteParts.join("，") : "已提交章纲暂无可计算的 end_hook/payoff_beat 数据";
  return {
    ok: true,
    sample_size: sampleSize,
    drive_bucket: resolution.bucket,
    bucket_note: resolution.note,
    metrics,
    note: `${approxNote}${body}。仅供参考，不影响提交。`,
  };
}

export async function novelGetGridBenchmark(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  return buildGridBenchmark(ctx);
}

/**
 * 供 novel_submit_chapter_outline 在满足最小样本量时追加的独立字段（与 warnings 平级但语义
 * 不同——warnings 是问题，这是中性对照）。样本不足时返回 null，调用方不追加该字段。
 */
export async function buildBenchmarkNote(ctx: ToolContext): Promise<string | null> {
  const result = await buildGridBenchmark(ctx);
  if (result.sample_size < GRID_BENCHMARK_THRESHOLDS.min_sample_chapters) return null;
  return result.note;
}

// ============================================================
// arc 层定速靶（前馈）——取本书桶靶，供规划前投递给架构师
// ============================================================

export interface ArcVelocityTarget {
  ok: true;
  drive_bucket: DriveBucket | "global";
  bucket_note: string | null;
  target: {
    max_dormancy_run: number;
    opening_propulsion_ratio_pct: number;
    opening_window: number;
  };
  brief: string;
}

/** 取本书 arc 层定速靶（前馈用）。brief 是随包投递给架构师的一句人话靶——含数字，因为它是数据不是 agent prompt。 */
export function buildArcVelocityTarget(ctx: ToolContext): ArcVelocityTarget {
  const resolution = resolveDriveBucket(ctx.genre);
  const t = ARC_VELOCITY_TARGET_TABLE[resolution.bucket];
  const approx = resolution.note ? `（${resolution.note}）` : "";
  const maxDormancyRunDisplay = Math.round(t.max_dormancy_run);
  const brief =
    `同类头部节奏靶${approx}：主线别连续休眠超 ${maxDormancyRunDisplay} 章（一段没有具体对抗、没往前推的戏），` +
    `开局前 ${ARC_VELOCITY_OPENING_WINDOW} 章至少 ${t.opening_propulsion_ratio_pct}% 的章要有推进；` +
    `排 arc 时别把开局或中段整段停靠去写练功/家庭慢戏。`;
  return {
    ok: true,
    drive_bucket: resolution.bucket,
    bucket_note: resolution.note,
    target: {
      max_dormancy_run: t.max_dormancy_run,
      opening_propulsion_ratio_pct: t.opening_propulsion_ratio_pct,
      opening_window: ARC_VELOCITY_OPENING_WINDOW,
    },
    brief,
  };
}

/** MCP 工具入口：novel_get_arc_velocity_target（阶段一前馈，随包投递给架构师） */
export async function novelGetArcVelocityTarget(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  return buildArcVelocityTarget(ctx);
}
