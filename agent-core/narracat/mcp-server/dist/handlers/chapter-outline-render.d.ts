/**
 * 单章细纲的机械渲染（首行「# 第N章 …」是 App 锚点）。
 *
 * 写入侧（novel_submit_chapter_outline）与读取侧（WritingContextPack builder）共用同一渲染，
 * 保证写手看到的章纲文本与结构化 ch-NNN.json 一致——尤其 payoff_beat 等「重提已有章」时才补的字段：
 * 已存在的 .md 受保护不覆盖会变陈旧，读取侧从 .json 现渲染即可避免写手丢字段。
 *
 * 支持两种形态（按运行时 beats 字段是否为数组分支）：
 * - 旧形态（无 beats）：scenes 列表式，向后兼容存量 ch-NNN.json
 * - 新形态（有 beats）：positioning + beats 骨架式
 */
import type { ChapterOutlineItem } from "./validators.js";
/** payoff_beat 英文枚举 → 中文展示标签（渲染层；枚举 SSOT 在 outline-structure.json） */
export declare const PAYOFF_BEAT_LABEL: Record<string, string>;
/** end_hook 英文枚举 → 中文展示标签（渲染层；枚举 SSOT 在 outline-structure.json） */
export declare const END_HOOK_LABEL: Record<string, string>;
/** payoff_intensity 英文枚举 → 中文展示标签（渲染层；枚举 SSOT 在 outline-structure.json） */
export declare const PAYOFF_INTENSITY_LABEL: Record<string, string>;
export interface ChapterOutlineRenderContext {
    /** storyline_id → 名称（缺则只显 id） */
    storylineNames: Map<string, string>;
    /** foreshadowing_id → 描述（缺则只显 id + action） */
    foreshadowingDescriptions: Map<string, string>;
}
/** 渲染单章细纲为 md 文本（不含落盘；写入侧与 WCP 读取侧共用，确保两侧一致）。 */
export declare function renderChapterOutlineMarkdown(ch: ChapterOutlineItem, ctx: ChapterOutlineRenderContext): string;
