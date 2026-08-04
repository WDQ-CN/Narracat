/**
 * 写工具实现（12 个）
 *
 * 每个 agent 只持有自己产物的提交工具：
 * - setup / write 主会话 : novel_submit_premise / novel_commit_extraction_union（多采样并集落库）
 * - memory-keeper       : novel_commit_chapter / novel_submit_extraction / novel_stage_extraction / novel_consolidate
 * - continuity-editor   : novel_submit_review
 * - outline-architect   : novel_submit_outline / novel_submit_chapter_outline
 * - 补登 / 修复          : novel_register_foreshadowing / novel_rollback_chapter
 *
 * 统一纪律：入口 ajv + 语义校验 → 通过整体写入 / 失败返回
 * { ok: false, errors: [{field, expected, actual, hint}] }；
 * 一切渲染产物（outline md / review md / 叙述者腔调节）由本文件从已验证数据机械生成。
 */
import type { OutlinePayload, PremiseCardsPayload } from "./validators.js";
import type { ToolContext } from "../types.js";
/** 刷新一批角色（按 uid）的状态卡；返回实际写入的角色名。跨 handler 复用（见 character-entity.ts） */
export declare function refreshCharacterCards(ctx: ToolContext, characters: Iterable<{
    uid: string;
    name: string;
}>, asOfChapter: number): string[];
export declare function novelCommitChapter(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelSubmitExtraction(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelStageExtraction(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelCommitExtractionUnion(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelConsolidate(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelSubmitReview(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function backfillReviewArtifacts(ctx: ToolContext): Promise<void>;
/**
 * 立项卡机械渲染为只读 premise.md。九卡按固定序渲染；缺卡安静跳过（降级不报错）。
 * 第 9「留白声明」由各条 certainty 自动汇总，不读手写。
 */
export declare function renderPremiseMarkdown(payload: PremiseCardsPayload): string;
export declare function novelSubmitPremise(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function backfillPremiseArtifacts(ctx: ToolContext): Promise<void>;
export declare function backfillOutlineArtifacts(ctx: ToolContext): Promise<void>;
interface NarratorVoiceData {
    values: Map<string, string>;
    examples: Array<{
        source_excerpt: string;
        mechanism_note?: string;
    }>;
}
/** 机械渲染 master-outline.md：引擎字段 + 叙述者腔调节 + 故事线 + 伏笔注册表 + 卷结构。 */
export declare function renderMasterOutlineMarkdown(payload: OutlinePayload, narratorVoice: NarratorVoiceData | null): string;
export declare function novelSubmitOutline(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelSubmitChapterOutline(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelRegisterForeshadowing(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelUpdateOutlineBookField(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelRollbackChapter(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelSubmitDialogueSamples(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export {};
