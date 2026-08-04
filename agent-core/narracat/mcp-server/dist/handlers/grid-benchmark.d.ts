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
import type { ToolContext } from "../types.js";
import type { ChapterOutlineItem } from "./validators.js";
export type DriveBucket = "high_frequency_small" | "mid_large_escalation" | "delayed_payoff";
export interface DriveBucketResolution {
    bucket: DriveBucket | "global";
    /** 非 null = 需要在对标文案里显式注明的近似归位/回退全局池说明；精确命中时为 null */
    note: string | null;
}
/**
 * genre 自由文本 → 驱动特征桶。命中不了任何关键词（或 genre 为空）→ 回退 "global"，
 * 不报错、不阻断——这是「非题材标签硬归」的兜底，不是失败态（设计 §2.2B）。
 */
export declare function resolveDriveBucket(genre: string | null | undefined): DriveBucketResolution;
export declare const GRID_BENCHMARK_TABLE: Record<DriveBucket | "global", {
    /** 逐书章末钩 none 率（%），升序。书间对比量，运行时按名次对照 */
    hook_none_rate_by_book_pct: readonly number[];
    /** 章级爽点间隔分位数（池化章间隔分布，非书间统计） */
    payoff_interval_chapters: {
        p25: number;
        median: number;
        p75: number;
        p90: number;
    };
}>;
/** arc 速度靶开局窗口（章）——与 corpus 蒸馏侧 openingPropulsionRatio 的 windowN 对齐 */
export declare const ARC_VELOCITY_OPENING_WINDOW = 15;
/**
 * arc 层定速靶（阶段一前馈 + 提交后软量对照）——手工蒸馏自 corpus grid 逐章推进力分布，
 * 口径与 scripts/corpus-factory/lib/grid-stats.mjs 的 chapterPropulsion/zeroPropulsionMaxRun/
 * openingPropulsionRatio 同源。护栏取宽松界：max_dormancy_run 取逐书 p90（只拦比 90% 头部更慢的），
 * opening_propulsion_ratio_pct 取逐书 p25（只拦落到头部下四分位以下的）。
 * 复核命令：node scripts/corpus-factory/grid-stats.mjs（需本机 corpus-factory-data/grid）。
 * 数字口径：59 部头部网文 / 23,853 章，蒸馏于 2026-07-09。
 */
export declare const ARC_VELOCITY_TARGET_TABLE: Record<DriveBucket | "global", {
    max_dormancy_run: number;
    opening_propulsion_ratio_pct: number;
}>;
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
export declare const GRID_BENCHMARK_THRESHOLDS: {
    readonly min_sample_chapters: 20;
};
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
export declare function collectSubmittedChapters(ctx: ToolContext): Promise<CollectedChapter[]>;
/** 章末钩 none 率：分母只算已声明 end_hook 字段的章（缺字段的存量章不计入，语义同 checkHookCadence 的 unknown 态） */
export declare function computeHookNoneRate(chapters: CollectedChapter[]): {
    value_pct: number;
    n: number;
} | null;
/** 爽点间隔（不分强度）：相邻两个 payoff_beat 非空的章号差，按章号升序算，跨卷章号连续不特殊处理 */
export declare function computePayoffInterval(chapters: CollectedChapter[]): {
    median: number;
    n: number;
} | null;
/**
 * 书间名次对照：本书值在同类逐书数组（升序）里高于多少本。
 * 名次表述在任何 n 下都诚实（攒糖桶只有 5 本，报 p90 就是编数）；相等值不算「高于」。
 */
export declare function rankAmongBooks(value: number, sortedRatesAsc: readonly number[]): {
    n_books: number;
    books_below: number;
    median_pct: number;
};
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
export declare function buildGridBenchmark(ctx: ToolContext): Promise<GridBenchmarkResult>;
export declare function novelGetGridBenchmark(_args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
/**
 * 供 novel_submit_chapter_outline 在满足最小样本量时追加的独立字段（与 warnings 平级但语义
 * 不同——warnings 是问题，这是中性对照）。样本不足时返回 null，调用方不追加该字段。
 */
export declare function buildBenchmarkNote(ctx: ToolContext): Promise<string | null>;
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
export declare function buildArcVelocityTarget(ctx: ToolContext): ArcVelocityTarget;
/** MCP 工具入口：novel_get_arc_velocity_target（阶段一前馈，随包投递给架构师） */
export declare function novelGetArcVelocityTarget(_args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export {};
