/**
 * 候选角色池工具实现（2 个）
 *
 * ADR-0015 渐进生长「内容实例层」：plan/write 期引入未建档角色时，作者可选「留作候选」，
 * 角色进候选角色池——不强制完整设定、不打断创作流。落盘即铸定 character_uid
 * （CharacterReference 契约），将来正式建档（/world）时复用同一 UID。
 *
 * - novel_register_candidate_character（写）：入候选池 / 标记已建档（promote）
 * - novel_list_candidate_characters（读）：列候选清单（供主会话识别新角色、App 渲染）
 *
 * 候选角色不入 facts / character_cards（无设定可入），与已出场角色的记忆体系隔离。
 */

import { randomUUID } from "node:crypto";
import { singleError } from "../types.js";
import type { ToolContext, CandidateCharacterRow } from "../types.js";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const VALID_SOURCES = ["plan", "write", "manual"] as const;
const VALID_STATUSES = ["candidate", "promoted"] as const;
const VALID_IMPORTANCE = ["minor", "major"] as const;

/**
 * novel_register_candidate_character —— 入候选池或标记已建档。
 *
 * name 必填；character_uid 可选（缺省自动铸造 lowercase UUID v4，与 novel_mint_character_uid 一致），
 * 便于建档时按 UID 复用同一身份。重复 UID upsert：更新 name/note/proposed_chapter/status。
 * status='promoted' 表示该候选已转为正式角色档案（/world 建档后回写），从候选清单淡出。
 */
export async function novelRegisterCandidateCharacter(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const name = args["name"];
  if (typeof name !== "string" || !name.trim()) {
    return singleError(
      "name",
      "非空字符串",
      name === undefined ? "missing" : String(name),
      "候选角色必须有显示名（name）",
    );
  }

  let uid = args["character_uid"];
  if (uid === undefined || uid === null || uid === "") {
    uid = randomUUID();
  } else if (typeof uid !== "string" || !UUID_V4_RE.test(uid)) {
    return singleError(
      "character_uid",
      "lowercase UUID v4，或省略由工具铸造",
      String(uid),
      "character_uid 须为经 novel_mint_character_uid 铸造的 lowercase UUID v4；新候选可省略此字段由工具自动铸造",
    );
  }

  const source = args["source"];
  if (source !== undefined && !VALID_SOURCES.includes(source as never)) {
    return singleError(
      "source",
      `${VALID_SOURCES.join(" / ")}`,
      String(source),
      "source 只接受 plan / write / manual",
    );
  }

  const status = args["status"];
  if (status !== undefined && !VALID_STATUSES.includes(status as never)) {
    return singleError(
      "status",
      `${VALID_STATUSES.join(" / ")}`,
      String(status),
      "status 只接受 candidate / promoted",
    );
  }

  const importanceArg = args["importance"];
  if (importanceArg !== undefined && !VALID_IMPORTANCE.includes(importanceArg as never)) {
    return singleError(
      "importance",
      `${VALID_IMPORTANCE.join(" / ")}`,
      String(importanceArg),
      "importance 只接受 minor（次要，进池静默不提醒）/ major（重要，写完正文提醒建档）；省略 = minor",
    );
  }
  // 省略时绑 null → 新插入经 COALESCE 落默认 'minor'、冲突更新保留既有（promote 回写不清掉重要度）。
  const importance =
    (importanceArg as CandidateCharacterRow["importance"] | undefined) ?? null;

  const proposedChapterArg = args["proposed_chapter"];
  let proposedChapter: number | null = null;
  if (proposedChapterArg !== undefined && proposedChapterArg !== null) {
    if (
      typeof proposedChapterArg !== "number" ||
      !Number.isInteger(proposedChapterArg) ||
      proposedChapterArg < 1
    ) {
      return singleError(
        "proposed_chapter",
        "integer ≥ 1，或省略",
        String(proposedChapterArg),
        "proposed_chapter 是该角色计划首次出场/被提及的章号，须为正整数或省略",
      );
    }
    proposedChapter = proposedChapterArg;
  }

  // 初始关系（可选）：候选与已建档角色的关系草稿，转正建档时回写为正式关系。
  // 省略时绑 null → 新插入存默认 '[]'、冲突更新经 COALESCE 保留既有（promote 回写不丢草稿）。
  const initialRelationshipsArg = args["initial_relationships"];
  let initialRelationshipsJson: string | null = null;
  if (initialRelationshipsArg !== undefined && initialRelationshipsArg !== null) {
    if (!Array.isArray(initialRelationshipsArg)) {
      return singleError(
        "initial_relationships",
        "数组，或省略",
        String(initialRelationshipsArg),
        "initial_relationships 是 [{other_character_uid, state}] 数组",
      );
    }
    for (const rel of initialRelationshipsArg) {
      const other = (rel as Record<string, unknown>)?.["other_character_uid"];
      const state = (rel as Record<string, unknown>)?.["state"];
      if (typeof other !== "string" || !other.trim() || typeof state !== "string" || !state.trim()) {
        return singleError(
          "initial_relationships[]",
          "每项含非空 other_character_uid + state",
          JSON.stringify(rel),
          "每个关系项须有 other_character_uid（已建档角色 uid）与 state（关系状态一句话）",
        );
      }
    }
    initialRelationshipsJson = JSON.stringify(
      initialRelationshipsArg.map((rel) => ({
        other_character_uid: ((rel as Record<string, unknown>)["other_character_uid"] as string).trim(),
        state: ((rel as Record<string, unknown>)["state"] as string).trim(),
      })),
    );
  }

  const note =
    typeof args["note"] === "string" && (args["note"] as string).trim()
      ? (args["note"] as string).trim()
      : null;
  const resolvedSource = (source as CandidateCharacterRow["source"]) ?? "write";
  const resolvedStatus = (status as CandidateCharacterRow["status"]) ?? "candidate";
  const characterUid = uid as string;
  const characterName = name.trim();

  ctx.db
    .prepare(
      `INSERT INTO candidate_characters
         (novel_id, character_uid, name, note, proposed_chapter, initial_relationships, importance, source, status, updated_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, '[]'), COALESCE(?, 'minor'), ?, ?, datetime('now'))
       ON CONFLICT(novel_id, character_uid) DO UPDATE SET
         name = excluded.name,
         note = COALESCE(excluded.note, candidate_characters.note),
         proposed_chapter = COALESCE(excluded.proposed_chapter, candidate_characters.proposed_chapter),
         initial_relationships = COALESCE(?, candidate_characters.initial_relationships),
         importance = COALESCE(?, candidate_characters.importance),
         source = excluded.source,
         status = excluded.status,
         updated_at = datetime('now')`,
    )
    .run(
      ctx.novelId,
      characterUid,
      characterName,
      note,
      proposedChapter,
      initialRelationshipsJson,
      importance,
      resolvedSource,
      resolvedStatus,
      initialRelationshipsJson,
      importance,
    );

  return {
    ok: true,
    character_uid: characterUid,
    name: characterName,
    status: resolvedStatus,
    message:
      resolvedStatus === "promoted"
        ? `候选角色「${characterName}」已标记为已建档`
        : `角色「${characterName}」已入候选池`,
  };
}

/**
 * novel_list_candidate_characters —— 列候选角色清单。
 *
 * 默认只列 status='candidate'（待出场）；status='promoted' 列已建档的；status='all' 列全部。
 * 供主会话在 plan/write 期识别「这名字是不是已留过候选/别名」，供 App 渲染候选池入口。
 */
export async function novelListCandidateCharacters(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const statusArg = args["status"];
  let where = "novel_id = ? AND status = 'candidate'";
  const params: unknown[] = [ctx.novelId];
  if (statusArg === "promoted") {
    where = "novel_id = ? AND status = 'promoted'";
  } else if (statusArg === "all") {
    where = "novel_id = ?";
  } else if (statusArg !== undefined && statusArg !== "candidate") {
    return singleError(
      "status",
      "candidate / promoted / all（省略 = candidate）",
      String(statusArg),
      "status 只接受 candidate / promoted / all",
    );
  }

  // 重要度过滤（ADR-0023）：省略 = 全部（App 目录用）；major = 写完正文只提醒的重要候选。
  const importanceArg = args["importance"];
  if (importanceArg !== undefined && !VALID_IMPORTANCE.includes(importanceArg as never)) {
    return singleError(
      "importance",
      `${VALID_IMPORTANCE.join(" / ")}（省略 = 全部）`,
      String(importanceArg),
      "importance 过滤只接受 minor / major",
    );
  }
  if (importanceArg !== undefined) {
    where += " AND importance = ?";
    params.push(importanceArg);
  }

  const rows = ctx.db
    .prepare(
      `SELECT character_uid, name, note, proposed_chapter, initial_relationships, importance, source, status
         FROM candidate_characters
        WHERE ${where}
        ORDER BY COALESCE(proposed_chapter, 999999), created_at`,
    )
    .all(...params) as Pick<
    CandidateCharacterRow,
    | "character_uid"
    | "name"
    | "note"
    | "proposed_chapter"
    | "initial_relationships"
    | "importance"
    | "source"
    | "status"
  >[];

  return {
    ok: true,
    candidates: rows.map((r) => ({
      character_uid: r.character_uid,
      name: r.name,
      note: r.note ?? undefined,
      proposed_chapter: r.proposed_chapter ?? undefined,
      initial_relationships: parseInitialRelationships(r.initial_relationships),
      importance: r.importance,
      source: r.source,
      status: r.status,
    })),
    count: rows.length,
  };
}

/** 解析候选行的 initial_relationships JSON；损坏 / 空 / null 一律返回空数组。 */
function parseInitialRelationships(raw: string | null): Array<{ other_character_uid: string; state: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (rel): rel is { other_character_uid: string; state: string } =>
        Boolean(rel) &&
        typeof rel === "object" &&
        typeof (rel as Record<string, unknown>).other_character_uid === "string" &&
        typeof (rel as Record<string, unknown>).state === "string",
    );
  } catch {
    return [];
  }
}
