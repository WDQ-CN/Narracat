/**
 * 章级计划状态变更：兑现比对 + 作者处置（A4×D2 片3 软兑现门）
 *
 * 账本分离：planned_state_changes 是计划账，facts 是事实账，两账无直接冲突面——
 * 兑现比对只做机械匹配（uid + 维度谓词 + 值精确 + 章号），不自动顺延不打回：
 * 挪后半章可能是合理节奏，未兑现只出报告卡交作者处置（软门，dogfood 攒误报率后再议硬化）。
 *
 * 两个工具：
 * - novel_check_state_delivery（主会话，write 收尾）：本章 planned 行逐条比对已落库 facts，
 *   命中机械落 delivered，未命中返回报告；
 * - novel_resolve_planned_state（App 确定性直调，不进 agent 工具面）：报告卡四动作落账
 *   defer（原行留审计+目标章新行）/ cancel / acknowledge / mark_delivered。
 */

import { randomUUID } from "node:crypto";
import { readFile, writeFile, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ToolContext } from "../types.js";
import { errorResponse, singleError } from "../types.js";
import { attributeFact, loadStateVocabulary } from "./state-dimensions.js";
import { renderChapterOutlineMarkdown } from "./chapter-outline-render.js";
import { checkStateChanges } from "./validators.js";
import type { ChapterOutlineItem } from "./validators.js";

// ============================================================
// 共享 helper（writers.ts 提交路径与本文件 novelUpdateChapterStateChanges 共用）
// ============================================================

export interface MirrorEntry {
  character_uid: string;
  character_name: string;
  dimension: string;
  operation: "set" | "add" | "remove";
  value: string;
  reason: string | null;
}

/**
 * #448 镜像纪律（writers 提交与 App 编辑共用）：只清 planned 保处置历史。
 *
 * `dedupe` 无缺省值，两个调用点显式传，语义不同（PR#456 评审 F3 先例 + 终审 Fix 3a）：
 * - `'any-status'`——架构师重提交（writers.ts 提交路径）：同键任意状态既有行都跳过插入，
 *   防止重排把已处置（delivered/cancelled/…）的历史行悄悄复活成新 planned 行。
 * - `'planned-only'`——作者在账本区显式重加同键计划（novel_update_chapter_state_changes）：
 *   只看同键是否已有 planned 行去重，同键终态行（如 cancelled）不拦——那是历史账，
 *   作者这次显式意图应当成功入账，否则会出现 ok:true 却计划表无 planned 行的假成功。
 */
export function mirrorChapterPlannedState(
  db: ToolContext["db"],
  novelId: string,
  chapter: number,
  entries: MirrorEntry[],
  dedupe: "any-status" | "planned-only",
): void {
  db.prepare(`DELETE FROM planned_state_changes WHERE novel_id = ? AND chapter = ? AND status = 'planned'`).run(novelId, chapter);
  const findSameKeyAnyStatus = db.prepare(
    `SELECT id FROM planned_state_changes
     WHERE novel_id = ? AND chapter = ? AND character_uid = ? AND dimension = ? AND operation = ? AND value = ?`,
  );
  const findSameKeyPlannedOnly = db.prepare(
    `SELECT id FROM planned_state_changes
     WHERE novel_id = ? AND chapter = ? AND character_uid = ? AND dimension = ? AND operation = ? AND value = ?
       AND status = 'planned'`,
  );
  const findSameKey = dedupe === "any-status" ? findSameKeyAnyStatus : findSameKeyPlannedOnly;
  const insert = db.prepare(
    `INSERT INTO planned_state_changes
       (id, novel_id, chapter, character_uid, character_name, dimension, operation, value, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const e of entries) {
    if (findSameKey.get(novelId, chapter, e.character_uid, e.dimension, e.operation, e.value)) continue;
    insert.run(randomUUID(), novelId, chapter, e.character_uid, e.character_name, e.dimension, e.operation, e.value, e.reason);
  }
}

/** 遍历 outline 下各 vol-NN 目录定位 ch-NNN.json（不依赖卷号入参；命名对齐 writers 写入侧）。 */
export async function locateChapterOutlineFile(
  projectRoot: string,
  chapter: number,
): Promise<{ jsonPath: string; mdPath: string } | null> {
  const outlineDir = join(projectRoot, "outline");
  let entries;
  try {
    entries = await readdir(outlineDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const base = `ch-${String(chapter).padStart(3, "0")}`;
  for (const ent of entries) {
    if (!ent.isDirectory() || !/^vol-\d+$/.test(ent.name)) continue;
    const jsonPath = join(outlineDir, ent.name, `${base}.json`);
    try {
      await readFile(jsonPath, "utf-8");
      return { jsonPath, mdPath: join(outlineDir, ent.name, `${base}.md`) };
    } catch {
      /* 不在此卷，继续 */
    }
  }
  return null;
}

/** 渲染上下文（同 writers 提交路径的两条查询）。 */
export function buildChapterRenderContext(ctx: ToolContext): {
  storylineNames: Map<string, string>;
  foreshadowingDescriptions: Map<string, string>;
} {
  const storylineRows = ctx.db.prepare(`SELECT id, name FROM storylines WHERE novel_id = ?`).all(ctx.novelId) as Array<{ id: string; name: string }>;
  const registryRows = ctx.db.prepare(`SELECT id, description FROM foreshadowing_registry WHERE novel_id = ?`).all(ctx.novelId) as Array<{ id: string; description: string }>;
  return {
    storylineNames: new Map(storylineRows.map((r) => [r.id, r.name])),
    foreshadowingDescriptions: new Map(registryRows.map((r) => [r.id, r.description])),
  };
}

/**
 * 文件先行+补偿（spec §3.4）：写新 json（tmp+rename 原子替换），md 写入与 dbWrite 一并纳入
 * 统一故障处理——两者任一失败都视为整体失败并回写旧 json/md，不留「json 已更新但 md/DB
 * 未跟上」的三处不一致缺口（评审 P1：md 写失败此前逃出补偿 try，会假报「文件已回滚」）。
 */
async function replaceOutlineFilesThenDb(
  paths: { jsonPath: string; mdPath: string },
  next: { jsonText: string; mdText: string },
  dbWrite: () => void,
): Promise<void> {
  const oldJson = await readFile(paths.jsonPath, "utf-8");
  let oldMd: string | null = null;
  try {
    oldMd = await readFile(paths.mdPath, "utf-8");
  } catch {
    oldMd = null;
  }
  const tmpPath = `${paths.jsonPath}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, next.jsonText, "utf-8");
  await rename(tmpPath, paths.jsonPath);
  try {
    await writeFile(paths.mdPath, next.mdText, "utf-8");
    dbWrite();
  } catch (error) {
    // 补偿：回写旧内容；补偿失败也 fail-loud（调用方转成 errors[]），提交即自愈
    await writeFile(paths.jsonPath, oldJson, "utf-8").catch(() => {});
    if (oldMd === null) await unlink(paths.mdPath).catch(() => {});
    else await writeFile(paths.mdPath, oldMd, "utf-8").catch(() => {});
    throw error;
  }
}

interface PlannedStateRow {
  id: string;
  novel_id: string;
  chapter: number;
  character_uid: string;
  character_name: string;
  dimension: string;
  operation: "set" | "add" | "remove";
  value: string;
  reason: string | null;
  status: "planned" | "delivered" | "deferred" | "cancelled" | "acknowledged";
  deferred_to_chapter: number | null;
}

interface DeliveryReportItem {
  id: string;
  character: string;
  dimension: string;
  operation: "set" | "add" | "remove";
  value: string;
  reason: string | null;
  note?: string;
}

function describeItem(row: PlannedStateRow, displayName: string): string {
  const op = row.operation === "remove" ? "失去" : row.operation === "add" ? "获得" : "变为";
  return `${row.character_name} 的${displayName}${op}「${row.value}」`;
}

export async function novelCheckStateDelivery(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const chapter = args["chapter"];
  if (typeof chapter !== "number" || !Number.isInteger(chapter) || chapter < 1) {
    return singleError("chapter", "不小于 1 的整数章号", String(chapter), "传入本次完成写作的章号");
  }

  const rows = ctx.db
    .prepare(
      `SELECT * FROM planned_state_changes
       WHERE novel_id = ? AND chapter = ? AND status = 'planned'
       ORDER BY rowid ASC`,
    )
    .all(ctx.novelId, chapter) as PlannedStateRow[];
  if (rows.length === 0) {
    return { ok: true, chapter, planned_total: 0, delivered: [], undelivered: [], message: "本章无计划状态变更" };
  }

  const vocab = loadStateVocabulary(ctx.projectRoot);
  const dimByKey = new Map((vocab?.dimensions ?? []).map((d) => [d.key, d]));

  // set/add：本章存在该值事实（生效点=本章）。晚些章被自然顶替不影响「本章已兑现」，但
  // 「从未生效」行（invalidated_at <= 自身生效章，即被作者 retract/correct 打掉的错误记录）
  // 不算兑现——否则已确认错误的抽取结果会被兑现门永久销账（PR#456 评审 F1）。
  const findDeliveredFact = ctx.db.prepare(
    `SELECT id FROM facts
     WHERE novel_id = ? AND subject_character_uid = ? AND subject_character_b_uid IS NULL
       AND predicate = ? AND object = ? AND COALESCE(event_chapter, from_chapter) = ?
       AND NOT (invalidated_at_chapter IS NOT NULL
                AND invalidated_at_chapter <= COALESCE(event_chapter, from_chapter))
     LIMIT 1`,
  );
  // remove：该值既有事实在本章被失效（自然失去的机械痕迹）。要求生效章严格早于失效章——
  // 生效章=失效章的行是「从未生效」（同上），不是失去（PR#456 评审 F1）。
  const findRemovedFact = ctx.db.prepare(
    `SELECT id FROM facts
     WHERE novel_id = ? AND subject_character_uid = ? AND subject_character_b_uid IS NULL
       AND predicate = ? AND object = ? AND invalidated_at_chapter = ?
       AND COALESCE(event_chapter, from_chapter) < invalidated_at_chapter
     LIMIT 1`,
  );
  const markDelivered = ctx.db.prepare(
    `UPDATE planned_state_changes SET status = 'delivered', updated_at = datetime('now') WHERE id = ?`,
  );

  const delivered: DeliveryReportItem[] = [];
  const undelivered: DeliveryReportItem[] = [];
  const tx = ctx.db.transaction(() => {
    for (const row of rows) {
      const dim = dimByKey.get(row.dimension);
      const displayName = dim?.display_name ?? row.dimension;
      const item: DeliveryReportItem = {
        id: row.id,
        character: row.character_name,
        dimension: displayName,
        operation: row.operation,
        value: row.value,
        reason: row.reason,
      };
      if (!vocab || !dim) {
        // 计划入账后词表变更（维度被删/词表丢失）：无法归谓词，按未兑现报告并注明，不静默吞
        undelivered.push({ ...item, note: `维度 ${row.dimension} 已不在词表内，无法机械比对` });
        continue;
      }
      // 归属一致性（PR#456 评审 F2）：facts 折叠按 attributeFact 归维（enum 值域优先、free 兜底），
      // 只按谓词+值匹配会让同谓词的另一维度误命中（如 skill 计划被 cultivation_level 的值销账）。
      // 计划值按归属规则落不进计划维度时，该计划在事实账上永远不可能兑现——按未兑现报告并注明。
      // 提交侧 checkStateChanges 已拒新增此类计划，此处兜底旧账与词表演进。
      const attributed = attributeFact(vocab, dim.predicate, row.value);
      if (attributed?.key !== row.dimension) {
        undelivered.push({
          ...item,
          note: `值「${row.value}」按词表归属规则${attributed ? `属维度 ${attributed.display_name}` : "无法归入任何维度"}，与计划维度不符，无法机械比对`,
        });
        continue;
      }
      const hit =
        row.operation === "remove"
          ? findRemovedFact.get(ctx.novelId, row.character_uid, dim.predicate, row.value, row.chapter)
          : findDeliveredFact.get(ctx.novelId, row.character_uid, dim.predicate, row.value, row.chapter);
      if (hit) {
        markDelivered.run(row.id);
        delivered.push(item);
      } else {
        undelivered.push({ ...item, note: describeItem(row, displayName) });
      }
    }
  });
  tx();

  return {
    ok: true,
    chapter,
    planned_total: rows.length,
    delivered,
    undelivered,
    message:
      undelivered.length === 0
        ? `本章 ${rows.length} 项计划状态变更全部兑现`
        : `本章计划状态变更 ${rows.length} 项：${delivered.length} 项已兑现，${undelivered.length} 项未在正文记忆中找到`,
  };
}

const RESOLVE_ACTIONS = new Set(["defer", "cancel", "acknowledge", "mark_delivered"] as const);
type ResolveAction = "defer" | "cancel" | "acknowledge" | "mark_delivered";

export async function novelResolvePlannedState(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const payload = (args["payload"] ?? {}) as Record<string, unknown>;
  const id = typeof payload["id"] === "string" ? payload["id"].trim() : "";
  const action = payload["action"];
  if (!id) {
    return singleError("payload.id", "计划行 id（非空字符串）", String(payload["id"]), "传入兑现报告卡携带的计划行 id");
  }
  if (typeof action !== "string" || !RESOLVE_ACTIONS.has(action as ResolveAction)) {
    return singleError("payload.action", "defer / cancel / acknowledge / mark_delivered", String(action), "四个处置动作之一");
  }

  const row = ctx.db
    .prepare(`SELECT * FROM planned_state_changes WHERE id = ? AND novel_id = ?`)
    .get(id, ctx.novelId) as PlannedStateRow | undefined;
  if (!row) {
    return singleError("payload.id", "存在的计划行", id, "计划行不存在或已随大纲重提交被替换，请刷新后重试");
  }
  if (row.status !== "planned") {
    return singleError("payload.id", "status=planned 的待处置计划行", `status=${row.status}`, "该计划已处置过，请刷新后重试");
  }

  if (action === "defer") {
    const toChapter = payload["to_chapter"];
    if (typeof toChapter !== "number" || !Number.isInteger(toChapter) || toChapter <= row.chapter) {
      return singleError("payload.to_chapter", `大于原计划章（${row.chapter}）的整数章号`, String(toChapter), "移到后续章节需要指定目标章");
    }
    // 写穿目标章 json（P1-2）：顺延行必须进目标章 json，否则架构师重提目标章时镜像重建会静默吃掉它
    const located = await locateChapterOutlineFile(ctx.projectRoot, toChapter);
    if (!located) {
      return singleError("payload.to_chapter", "已排出章纲的目标章", `第 ${toChapter} 章无章纲文件`, "目标章尚未排纲，请先排纲或换目标章");
    }
    let targetJson: Record<string, unknown>;
    try {
      targetJson = JSON.parse(await readFile(located.jsonPath, "utf-8")) as Record<string, unknown>;
    } catch {
      return singleError("payload.to_chapter", "可解析的目标章章纲 json", located.jsonPath, "目标章章纲文件损坏，请重新排纲");
    }
    // 旧格式（无 beats）章纲不支持 state_changes（同 novelUpdateChapterStateChanges 的校验），
    // defer 目标章落在旧格式章纲上同样 fail-loud 拒绝，不静默丢顺延行
    if (!Array.isArray((targetJson as { beats?: unknown }).beats)) {
      return singleError("payload.to_chapter", "新格式（beat 骨架）章纲的目标章", `第 ${toChapter} 章为旧格式章纲`, "旧格式章纲不支持计划状态变更编辑，请换目标章或先重排该章");
    }
    const targetList = Array.isArray(targetJson["state_changes"])
      ? ([...(targetJson["state_changes"] as unknown[])] as Array<Record<string, unknown>>)
      : [];
    // 目标 json 条目省略 operation 时按词表缺省解析（one→set / many→add，与
    // novelUpdateChapterStateChanges 侧同规），不能拿 row.operation 兜底——那是重言式，
    // 会把「隐含 add 获得某物」误判成与 defer 的 remove 同键，造成 json/DB 分裂
    const vocab = loadStateVocabulary(ctx.projectRoot);
    const dimCardinality = new Map((vocab?.dimensions ?? []).map((d) => [d.key, d.cardinality]));
    const resolveTargetOp = (sc: Record<string, unknown>): string =>
      (typeof sc["operation"] === "string" ? sc["operation"] : undefined) ??
      (dimCardinality.get(sc["dimension"] as string) === "one" ? "set" : "add");
    const sameKey = targetList.some((sc) => {
      const character = (sc["character"] ?? {}) as Record<string, unknown>;
      return (
        character["character_uid"] === row.character_uid &&
        sc["dimension"] === row.dimension &&
        resolveTargetOp(sc) === row.operation &&
        sc["value"] === row.value
      );
    });
    if (!sameKey && targetList.length >= STATE_CHANGES_MAX) {
      return singleError("payload.to_chapter", `目标章计划不超过 ${STATE_CHANGES_MAX} 条`, `已有 ${targetList.length} 条`, "目标章计划已满，请换一章");
    }
    if (!sameKey) {
      const entry: Record<string, unknown> = {
        character: { character_uid: row.character_uid, name: row.character_name },
        dimension: row.dimension,
        operation: row.operation,
        value: row.value,
      };
      if (row.reason) entry["reason"] = row.reason;
      targetList.push(entry);
    }

    const newId = randomUUID();
    const dbWrite = () => {
      const tx = ctx.db.transaction(() => {
        ctx.db
          .prepare(
            `UPDATE planned_state_changes
             SET status = 'deferred', deferred_to_chapter = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(toChapter, row.id);
        // 目标章新行（原行留审计）；同键**待兑现**行已存在则不重插，直接指认既有行。
        // 去重只看 status='planned'（PR#456 评审 F3）：目标章的同键终态行（cancelled/delivered/…）
        // 是历史账，不拦作者这次显式迁移——否则 defer 返回成功却没有产生任何待兑现计划（假成功）。
        const dup = ctx.db
          .prepare(
            `SELECT id FROM planned_state_changes
             WHERE novel_id = ? AND chapter = ? AND character_uid = ? AND dimension = ? AND operation = ? AND value = ?
               AND status = 'planned'`,
          )
          .get(ctx.novelId, toChapter, row.character_uid, row.dimension, row.operation, row.value) as
          | { id: string }
          | undefined;
        if (!dup) {
          ctx.db
            .prepare(
              `INSERT INTO planned_state_changes
                 (id, novel_id, chapter, character_uid, character_name, dimension, operation, value, reason)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              newId, ctx.novelId, toChapter,
              row.character_uid, row.character_name,
              row.dimension, row.operation, row.value, row.reason,
            );
        }
        return dup?.id;
      });
      return tx();
    };

    let existingId: string | undefined;
    try {
      if (sameKey) {
        existingId = dbWrite() as string | undefined; // json 无需改动，只落 DB
      } else {
        const nextJson = { ...targetJson, state_changes: targetList };
        const mdText = `${renderChapterOutlineMarkdown(nextJson as unknown as ChapterOutlineItem, buildChapterRenderContext(ctx))}\n`;
        await replaceOutlineFilesThenDb(located, { jsonText: `${JSON.stringify(nextJson, null, 2)}\n`, mdText }, () => {
          existingId = dbWrite() as string | undefined;
        });
      }
    } catch {
      return singleError("payload", "计划迁移写入成功", "写入失败（目标章文件已回滚）", "顺延失败，请重试");
    }
    return { ok: true, action, resolved_id: row.id, new_id: existingId ?? newId, to_chapter: toChapter };
  }

  const nextStatus = action === "cancel" ? "cancelled" : action === "acknowledge" ? "acknowledged" : "delivered";
  ctx.db
    .prepare(`UPDATE planned_state_changes SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(nextStatus, row.id);
  return { ok: true, action, resolved_id: row.id, status: nextStatus };
}

// ============================================================
// novel_update_chapter_state_changes — 章纲计划状态变更整段替换（App 确定性直调）
// ============================================================

const STATE_CHANGES_MAX = 8;

interface StateChangeJsonEntry {
  character: { character_uid: string; name: string };
  dimension: string;
  operation?: "set" | "add" | "remove";
  value: string;
  reason?: string;
}

function normalizeStateChangeEntry(raw: unknown, index: number): StateChangeJsonEntry | { error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const character = (r["character"] ?? {}) as Record<string, unknown>;
  const uid = typeof character["character_uid"] === "string" ? character["character_uid"].trim() : "";
  const name = typeof character["name"] === "string" ? character["name"].trim() : "";
  const dimension = typeof r["dimension"] === "string" ? r["dimension"].trim() : "";
  const value = typeof r["value"] === "string" ? r["value"].trim() : "";
  const reason = typeof r["reason"] === "string" ? r["reason"].trim() : "";
  const operation = r["operation"];
  if (!uid || !name || !dimension || !value) return { error: `第 ${index + 1} 条缺少角色/维度/值` };
  if (value.length > 60) return { error: `第 ${index + 1} 条值超 60 字` };
  if (reason.length > 100) return { error: `第 ${index + 1} 条缘由超 100 字` };
  if (operation !== undefined && operation !== "set" && operation !== "add" && operation !== "remove") {
    return { error: `第 ${index + 1} 条 operation 非法` };
  }
  const entry: StateChangeJsonEntry = { character: { character_uid: uid, name }, dimension, value };
  if (operation !== undefined) entry.operation = operation as StateChangeJsonEntry["operation"];
  if (reason) entry.reason = reason;
  return entry;
}

/**
 * 章纲计划状态变更整段替换（App 确定性直调，不进 agent 工具面）：作者在章纲卡编辑本章
 * state_changes——语义门与提交侧 checkStateChanges 同规，json+md+计划表由本工具协调写入
 * （文件先行+失败补偿，见 replaceOutlineFilesThenDb），CAS 防并发覆盖他人改动。
 */
export async function novelUpdateChapterStateChanges(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const payload = (args["payload"] ?? {}) as Record<string, unknown>;
  const chapter = payload["chapter"];
  if (typeof chapter !== "number" || !Number.isInteger(chapter) || chapter < 1) {
    return singleError("payload.chapter", "不小于 1 的整数章号", String(chapter), "传入要编辑的章号");
  }
  const rawList = payload["state_changes"];
  if (!Array.isArray(rawList)) {
    return singleError("payload.state_changes", "state_changes 数组（空数组合法）", String(rawList), "传入该章完整计划集合（整段替换）");
  }
  if (rawList.length > STATE_CHANGES_MAX) {
    return singleError("payload.state_changes", `不超过 ${STATE_CHANGES_MAX} 条`, `${rawList.length} 条`, "章级计划上限 8 条，请精简或移到相邻章");
  }
  const expected = payload["expected_state_changes"];
  if (!Array.isArray(expected)) {
    return singleError("payload.expected_state_changes", "读取时的 state_changes 数组（CAS 基线）", String(expected), "把加载章纲时拿到的 state_changes 原样回传");
  }

  const entries: StateChangeJsonEntry[] = [];
  for (const [i, raw] of rawList.entries()) {
    const normalized = normalizeStateChangeEntry(raw, i);
    if ("error" in normalized) {
      return singleError(`payload.state_changes[${i}]`, "完整的计划条目", normalized.error, "补齐角色（uid+名字）、维度、值");
    }
    entries.push(normalized);
  }

  // 语义门与提交侧同一把尺（维度∈词表 / enum 值域 / operation×cardinality / 归属一致性）
  const vocab = loadStateVocabulary(ctx.projectRoot);
  const gateErrors = checkStateChanges([{ chapter, state_changes: entries } as unknown as ChapterOutlineItem], vocab);
  if (gateErrors.length > 0) return errorResponse(gateErrors);

  const located = await locateChapterOutlineFile(ctx.projectRoot, chapter);
  if (!located) {
    return singleError("payload.chapter", "已排出章纲的章", `第 ${chapter} 章无章纲文件`, "该章尚未排纲，先排纲再编辑计划");
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(await readFile(located.jsonPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return singleError("payload.chapter", "可解析的章纲 json", located.jsonPath, "章纲文件损坏，请重新排纲");
  }
  // 旧格式（无 beats）章纲的 md 渲染不含状态变更节，放行会破坏「json/md/计划表三处一致」——
  // 本功能只对新格式生效，旧格式 fail-loud 拒绝
  if (!Array.isArray((json as { beats?: unknown }).beats)) {
    return singleError("payload.chapter", "新格式（beat 骨架）章纲", `第 ${chapter} 章为旧格式章纲`, "旧格式章纲不支持计划状态变更编辑");
  }
  // CAS：整段比对（读取快照 vs 磁盘现值）。expected 必须是读取 json 时的原样回传
  // （结构化克隆保键序），勿手工构造——手工构造的对象键序/字段集与磁盘序列化不保证一致，
  // 会让本该成功的保存误判为冲突（终审 Recommendation 3）。
  if (JSON.stringify(json["state_changes"] ?? []) !== JSON.stringify(expected)) {
    return singleError("payload.expected_state_changes", "与磁盘一致的读取快照", "已被其他提交更新", "章纲已被更新，请刷新后重试");
  }

  const nextJson = { ...json, state_changes: entries };
  const renderCtx = buildChapterRenderContext(ctx);
  const mdText = `${renderChapterOutlineMarkdown(nextJson as unknown as ChapterOutlineItem, renderCtx)}\n`;
  const dimCardinality = new Map((vocab?.dimensions ?? []).map((d) => [d.key, d.cardinality]));
  const mirror: MirrorEntry[] = entries.map((e) => ({
    character_uid: e.character.character_uid,
    character_name: e.character.name,
    dimension: e.dimension,
    operation: e.operation ?? (dimCardinality.get(e.dimension) === "one" ? "set" : "add"),
    value: e.value,
    reason: e.reason ?? null,
  }));

  try {
    await replaceOutlineFilesThenDb(
      located,
      { jsonText: `${JSON.stringify(nextJson, null, 2)}\n`, mdText },
      () => {
        // 'planned-only'：作者显式重加同键计划（本工具是账本区显式编辑动作），终态历史行不拦。
        const tx = ctx.db.transaction(() => mirrorChapterPlannedState(ctx.db, ctx.novelId, chapter, mirror, "planned-only"));
        tx();
      },
    );
  } catch {
    return singleError("payload", "计划表镜像写入成功", "写入失败（文件已回滚）", "写入失败，请重试；若反复失败请检查磁盘与数据库");
  }
  return { ok: true, chapter, count: entries.length };
}
