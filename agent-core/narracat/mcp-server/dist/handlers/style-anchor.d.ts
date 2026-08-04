/**
 * 本书声音样章锚：作者在正文里划选、标记为「本书该是这个味道」的定稿段落。
 *
 * 两个工具都是 App 确定性直调（不进 agent 工具面）：
 * - novel_submit_style_anchor：add / remove；
 * - novel_list_style_anchors：面板展示用。
 *
 * excerpt 存的是标记那一刻的正文快照——作者事后修改该章正文不回溯改锚，锚记的是「当时那个语感」。
 * 校验里的「在正文中存在」按去空白比对：跨段划选时浏览器给的换行形态与 md 原文不同，逐字比对会误杀。
 */
import type { ToolContext } from "../types.js";
export declare const MAX_ANCHORS = 3;
export declare const MIN_EXCERPT_CHARS = 80;
export declare const MAX_EXCERPT_CHARS = 400;
export interface StyleAnchorRow {
    anchor_id: string;
    chapter: number;
    excerpt: string;
    created_at: string;
}
/** 同步读全部锚（最新在前），供 WCP builder 与 list 工具共用 */
export declare function listStyleAnchorRows(ctx: ToolContext): StyleAnchorRow[];
export declare function novelSubmitStyleAnchor(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelListStyleAnchors(_args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
