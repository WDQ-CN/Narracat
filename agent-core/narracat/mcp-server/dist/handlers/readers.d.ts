/**
 * 读工具实现（12 个；novel_query_style_reference 在独立 handler 中）
 *
 * - 检索统一走 hybrid（FTS5 + 向量，RRF 合并），排序加确定性章节距离衰减
 *   score * 1/(1 + 0.05 * chapter_distance)
 * - novel_build_writing_context_pack 是纯代码 builder：按区块预算组装、
 *   超限硬截断并写入 warnings，落盘 .narracat/context-packs/ch-NNN.json
 * - 参数错误统一返回 { ok: false, errors: [{field, expected, actual, hint}] }
 */
import type { ToolContext, ArcMetaRow } from "../types.js";
/**
 * 章目标字数区间：有 words_per_chapter → ±20%（`[round(x*0.8), round(x*1.2)]`）；
 * 缺失 → 通用默认 2400-3600。本 builder（区块字数区间）与 state-sync.ts 的
 * checkManuscriptContract（机械合同字数下限/上限）共用同一份公式，避免两处独立漂移。
 */
export declare function getChapterWordCountRange(wordsPerChapter: number | null | undefined): [number, number];
export declare function novelQuery(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelChapterSummary(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelCharacterState(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelCharacterStatuses(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelRelationship(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelForeshadowingStatus(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelForeshadowingDensity(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelGetArc(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
/**
 * 机械扫本章正文的 AI 腔马脚（破折号密度 + 「不是X是Y」对仗转折密度/连排），代码算不用 LLM。
 * 正文全程不经 MCP、历来无门；本工具 Read 正文 → 扫 → 返 errors[]+hint，供写手定点擦除
 * 自修正（与账房层同构的回路，落点在 /write 步骤 5 末尾）。只扫确定的机械对仗腔、不判文笔好坏。
 */
export declare function novelCheckProseHygiene(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelGetReview(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelFailedReviews(_args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelGetStructureBudget(_args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelListStructureCards(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
/**
 * 该章是否已收尾入库：chapter_summaries 有该章记录，等价于「已过审校 + 洁净门 + 重缝的成稿」
 * ——novel_commit_chapter 是这张表唯一写入口，写入前已跑过 checkReviewFreshness（记忆写入门）。
 * 未收尾章可能是失败中断留下的残稿，不得当本书语感基准。也供 style-anchor.ts 的作者标记判据复用
 * （作者标记只看「已收尾」这一档，不叠加下面的审校新鲜度严档——见该文件头注）。
 */
export declare function isChapterCommitted(ctx: ToolContext, chapter: number): boolean;
interface ForeshadowingDueItem {
    id: string;
    type: "small" | "medium" | "major";
    description: string;
    planted_chapter?: number;
    target_reveal?: string;
}
interface ForeshadowingDue {
    due: ForeshadowingDueItem[];
    others_count: number;
}
/**
 * 从本章细纲全文提取『伏笔动作』显式引用的伏笔 id（spec §4.1 P1 后半句）。
 * registry id 形如 F-SWORD-CORE / S-HERB / F-MAJ-01：大写字母/数字段，连字符分隔。
 * 正则刻意放宽——细纲全文里不在 registry 里的巧合 id 自然在 getForeshadowingDue 里匹配不上
 * 任何行，无害；只用于白名单穿透，不用于其他判定。
 */
export declare function extractReferencedForeshadowingIds(chapterOutlineText: string): string[];
/**
 * 伏笔 due-list 过滤：major 全部 + medium 限本卷 + small 限本 arc
 * + target_reveal ≤ 本章+10 的临期项；其余活跃伏笔只计数。
 * 未种下（planted_chapter 晚于目标章）的条目整体排除——不进 due 也不进计数，
 * 除非其 id 出现在 referencedIds 白名单（本章细纲『伏笔动作』显式引用，spec §4.1 P1 后半句：
 * 架构师既然在细纲里点名要用，写手就该看到，不该被「未种下」的机械过滤挡在外面）。
 */
export declare function getForeshadowingDue(ctx: ToolContext, chapter: number, arc: ArcMetaRow | undefined, volumeRange: {
    chapter_start: number;
    chapter_end: number;
} | null, currentVolume: number | null, referencedIds?: string[]): ForeshadowingDue;
export declare function novelWritingContext(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
/** 在 manuscript/vol-VV/ch-NNN.md 中定位指定章号的正文文件（与细纲同构的按卷扫描） */
export declare function findChapterManuscriptFile(projectRoot: string, chapter: number): Promise<string | null>;
export interface ChapterOutlineForPack {
    text: string;
    /** 结构化 foreshadowing_touch[].id 去重；.json 缺失/解析失败（旧书）时为 null，消费方回退正则 */
    touchIds: string[] | null;
}
export interface ParsedRenderedOutline {
    dramatic_focus: string | null;
    characters: string[];
    pressure_points: string[];
}
/** 解析机械渲染的细纲（格式由 novel_submit_chapter_outline 渲染器保证）。
 *  新格式（含「## 场景骨架」）从编号 beats 取 pressure_points、从「## 本章定位」取 dramatic_focus；
 *  旧格式保留原「- 戏剧焦点 / - 压力点」逻辑。出场角色两格式通用（renderer 新旧都渲 `- 出场角色:`）。 */
export declare function parseRenderedOutline(text: string): ParsedRenderedOutline;
/**
 * 自由文本（tone/pacing）正向化：按小句切分，形容词位的校准词就地去除、保留正向名词；
 * 谓语/独立位的校准词整小句丢弃（其正当意图由 POSITIVE_CRAFT 统一承接）。
 * 返回 [cleaned, droppedCalibration]——droppedCalibration 仅在丢弃了整小句时为真。
 * 导出供单测。
 */
export declare function positivizeNarratorFreeText(text: string): [string, boolean];
/**
 * 句长处方正向化：命中小句里就地删掉处方词——删完仍有实义的保留（「短句快节奏」→「快节奏」），
 * 只剩处方本身的整小句丢弃（「段落实短」/「描写精简」）。正当意图由 POSITIVE_PROSODY 承接。
 * 返回 [cleaned, droppedProsody]。导出供单测。
 */
export declare function positivizeProsody(text: string): [string, boolean];
/**
 * 风格关键词（顿号/逗号分隔表）正向化：丢弃命中校准词的 token，保留正向腔调词。
 * 返回 [cleaned, droppedRestraint, droppedProsody]——两类命中分开报，供出口追加对症的正向句。
 */
export declare function positivizeStyleKeywords(text: string): [string, boolean, boolean];
/** 风格指令渲染：叙述声音数据 + style_profile 档位 → 一段中文自然语言 */
export declare function renderStyleDirective(voice: Map<string, string> | null, styleProfile: string | null, warnings: string[]): string;
/** 抽象词占比：cross-chapter-warnings §2 算法（导出供单测） */
export declare function abstractRatio(text: string): number;
export declare function novelBuildWritingContextPack(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
/**
 * 抽取脚手架（纯只读）：把弱模型抽取所需的确定性参考一次性聚合。
 * - alias_table：bible/characters/*.md 解析的「canonical → 别名[] + uid」转置表，归一角色名
 * - known_facts_summary：前文（from_chapter < chapter）已入库的有效 facts 最近 30 条，判断 change_type
 * - predicate_cheatsheet：12 个受控谓词常量，选谓词
 * - dimension_cheatsheet：本书状态词表存在时按维度给谓词+值域提示（词表缺失时该键不出现，T4）
 * 不含任何写操作，不读章节正文（正文由 memory-keeper 自行 Read）。
 */
export declare function novelExtractionScaffold(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelGetCharacterDialogueSamples(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelPackAuthoringVocab(): Promise<unknown>;
export declare function novelPackAuthoringPreview(args: Record<string, unknown>): Promise<unknown>;
export {};
