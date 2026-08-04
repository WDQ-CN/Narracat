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

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { ToolContext } from "../types.js";
import { singleError } from "../types.js";
import { findChapterManuscriptFile, isChapterCommitted } from "./readers.js";

export const MAX_ANCHORS = 3;
export const MIN_EXCERPT_CHARS = 80;
export const MAX_EXCERPT_CHARS = 400;

export interface StyleAnchorRow {
  anchor_id: string;
  chapter: number;
  excerpt: string;
  created_at: string;
}

/** 同步读全部锚（最新在前），供 WCP builder 与 list 工具共用 */
export function listStyleAnchorRows(ctx: ToolContext): StyleAnchorRow[] {
  return ctx.db
    .prepare(
      `SELECT anchor_id, chapter, excerpt, created_at FROM style_anchors
       WHERE novel_id = ? ORDER BY created_at DESC, anchor_id DESC`,
    )
    .all(ctx.novelId) as StyleAnchorRow[];
}

function countChars(text: string): number {
  return Array.from(text.trim()).length;
}

function stripWhitespace(text: string): string {
  return text.replace(/\s+/gu, "");
}

export async function novelSubmitStyleAnchor(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const action = args["action"];
  if (action !== "add" && action !== "remove") {
    return singleError("action", '"add" 或 "remove"', String(action), "add=标记一段样章，remove=删除一段");
  }

  if (action === "remove") {
    const anchorId = typeof args["anchor_id"] === "string" ? args["anchor_id"].trim() : "";
    if (!anchorId) {
      return singleError("anchor_id", "非空字符串", String(args["anchor_id"]), "传入要删除的样章 anchor_id");
    }
    ctx.db
      .prepare(`DELETE FROM style_anchors WHERE novel_id = ? AND anchor_id = ?`)
      .run(ctx.novelId, anchorId);
    return { ok: true, anchor_id: anchorId, total: listStyleAnchorRows(ctx).length };
  }

  const chapter = args["chapter"];
  if (typeof chapter !== "number" || !Number.isInteger(chapter) || chapter < 1) {
    return singleError("chapter", "integer ≥ 1", String(chapter), "传入该段落所在的章号");
  }
  const excerpt = typeof args["excerpt"] === "string" ? args["excerpt"].trim() : "";
  const chars = countChars(excerpt);
  if (chars < MIN_EXCERPT_CHARS || chars > MAX_EXCERPT_CHARS) {
    return singleError(
      "excerpt",
      `${MIN_EXCERPT_CHARS}-${MAX_EXCERPT_CHARS} 字`,
      `${chars} 字`,
      `样章取 ${MIN_EXCERPT_CHARS}-${MAX_EXCERPT_CHARS} 字：太短读不出语感，太长挤占写手的上下文`,
    );
  }

  const existing = listStyleAnchorRows(ctx);
  if (existing.length >= MAX_ANCHORS) {
    return singleError(
      "excerpt",
      `最多 ${MAX_ANCHORS} 段样章`,
      `已有 ${existing.length} 段`,
      `已有 ${MAX_ANCHORS} 段样章，先删一段再标新的`,
    );
  }

  const manuscriptPath = await findChapterManuscriptFile(ctx.projectRoot, chapter);
  if (manuscriptPath === null) {
    return singleError("chapter", "该章正文文件存在", `第 ${chapter} 章无正文`, "只能给已写完的章节标样章");
  }
  // 判据=已收尾入库（chapter_summaries 有该章记录，复用 readers.ts 的 isChapterCommitted）。
  // 未收尾章可能是写作中断留下的残稿，不能被当成「作者选定的已定稿段落」。
  //
  // 有意不叠加 checkReviewFreshness（审校新鲜度指纹门）：那道门是防 AI 出错的机制，作者主动
  // 划选并标记一段文字时他本人就是权威，不需要再让机器复核一遍；且刀 1 之前写的老章审校记录
  // 没有正文指纹，一律严判会把存量书的所有章全部拒掉，功能对老书当场失效。审校新鲜度严档只用
  // 在系统自己替作者做决定的自动兜底取样（见 readers.ts pickAutoVoiceSample）。
  if (!isChapterCommitted(ctx, chapter)) {
    return singleError(
      "chapter",
      "该章已完成并收尾入库",
      `第 ${chapter} 章尚未收尾`,
      "这一章还没写完，写完并收尾后再标样章",
    );
  }
  const content = await readFile(manuscriptPath, "utf-8");
  if (!stripWhitespace(content).includes(stripWhitespace(excerpt))) {
    return singleError(
      "excerpt",
      "该段落出现在本章正文中",
      "正文中未找到这段文字",
      "样章必须是本章正文里的原话；正文若已改动，请重新划选当前正文里的段落",
    );
  }

  // 唯一性只能由随机段承担：计数值（该章第几段/全书第几段）在「先加后删再加」的正常用法下
  // 会撞出已被删除又被后来者复用的编号，导致 INSERT 撞主键（(novel_id, anchor_id) 是主键）。
  const anchorId = `ch${String(chapter).padStart(3, "0")}-${randomUUID().slice(0, 8)}`;
  ctx.db
    .prepare(
      `INSERT INTO style_anchors (novel_id, anchor_id, chapter, excerpt) VALUES (?, ?, ?, ?)`,
    )
    .run(ctx.novelId, anchorId, chapter, excerpt);

  return { ok: true, anchor_id: anchorId, total: existing.length + 1 };
}

export async function novelListStyleAnchors(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  return { ok: true, anchors: listStyleAnchorRows(ctx), max: MAX_ANCHORS };
}
