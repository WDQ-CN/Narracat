/**
 * 角色实体与状态词表写入口（world-curator 持有）
 *
 * novel_submit_state_vocabulary：ajv 校验 → 写 bible/state-vocabulary.json（每书一份，覆盖式）。
 * novel_submit_character_entity：ajv + 词表值域校验 → 写 bible/characters/<name>.json（出生证）；
 *   机械同步 md 顶部 character_identity 注释与「别名:」行；initial_states 入 source=authored facts；
 *   候选池 uid 命中回写 promoted；刷新该角色状态卡。
 * novel_submit_authored_state：作者对角色结构化状态的直接修订（App 确定性直调，不进 agent 工具面）。
 *   五 action：set_current 钦定当前值 / backfill 补录历史 / correct 纠错改历史（失效链审计）/
 *   retract 作废记录 / endorse 把抽取记录背书为作者确认。
 * 文件即真相：json 是可导出受控数据；逐章演变仍走 facts。
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, readdir, rename, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { ToolContext, ToolErrorItem } from "../types.js";
import { errorResponse, singleError } from "../types.js";
import {
  validateStateVocabulary,
  validateCharacterEntity,
  validateAuthoredState,
  checkStateVocabularySemantics,
} from "./validators.js";
import { loadStateVocabulary, STATE_VOCABULARY_RELPATH, attributeFact, type StateVocabulary } from "./state-dimensions.js";
import { CHARACTER_IDENTITY_RE, loadAliasMap } from "./alias-map.js";
import { FACT_LATEST_ORDER_SQL, FACT_VALID_AT_SQL, revalidateVictimsOf } from "./fact-temporal.js";
import { refreshCharacterCards } from "./writers.js";

export async function novelSubmitStateVocabulary(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const payload = args["payload"];
  const validation = validateStateVocabulary(payload);
  if (!validation.valid) return errorResponse(validation.errors);

  // ajv 只管结构合法；撞名/歧义类问题结构上都合法，须机械语义校验追加拦截（PR#452评审P2-C）
  const semanticErrors = checkStateVocabularySemantics(
    payload as { dimensions: Array<{ key: string; predicate: string; display_name: string; cardinality: "one" | "many"; value_type: "enum" | "free"; values?: string[] }> },
  );
  if (semanticErrors.length > 0) return errorResponse(semanticErrors);

  const target = join(ctx.projectRoot, STATE_VOCABULARY_RELPATH);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

  const dimensions = (payload as { dimensions: unknown[] }).dimensions.length;
  return { ok: true, dimensions, path: STATE_VOCABULARY_RELPATH };
}

// ============================================================
// novel_submit_character_entity
// ============================================================

interface EntityPayload {
  character_uid?: string;
  name: string;
  aliases?: string[];
  gender?: string;
  age?: string;
  effective_chapter?: number;
  initial_states?: Array<{ dimension: string; value: string; note?: string }>;
}

/** initial_states 逐条按词表校验；错误带值域 hint 供 agent 自修正 */
function checkInitialStates(
  states: EntityPayload["initial_states"],
  vocab: StateVocabulary | null,
): ToolErrorItem[] {
  const errors: ToolErrorItem[] = [];
  for (const [i, s] of (states ?? []).entries()) {
    const dim = vocab?.dimensions.find((d) => d.key === s.dimension);
    if (!dim) {
      errors.push({
        field: `initial_states[${i}].dimension`,
        expected: vocab ? vocab.dimensions.map((d) => d.key).join(" / ") : "先提交 novel_submit_state_vocabulary",
        actual: s.dimension,
        hint: vocab
          ? `维度 ${s.dimension} 不在本书状态词表中，可用维度：${vocab.dimensions.map((d) => d.key).join("、")}`
          : "本书尚无状态词表：先调用 novel_submit_state_vocabulary，再提交带 initial_states 的实体",
      });
      continue;
    }
    if (dim.value_type === "enum" && !dim.values?.includes(s.value)) {
      errors.push({
        field: `initial_states[${i}].value`,
        expected: dim.values?.join(" / ") ?? "",
        actual: s.value,
        hint: `「${dim.display_name}」的值必须取自值域梯子：${dim.values?.join("、")}。若确需新值，先扩充词表`,
      });
    }
  }
  return errors;
}

/**
 * 从旧 md 顶部身份注释 parse 出既有字段，只覆写 character_uid / name 两键，
 * 其余字段（如主会话写入的 profile_stage）原样保留；parse 失败或无旧行按无旧字段处理，不抛。
 */
function buildIdentityLine(md: string | null, uid: string, name: string): string {
  let extra: Record<string, unknown> = {};
  const match = md?.match(CHARACTER_IDENTITY_RE);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        const { character_uid: _uid, name: _name, ...rest } = parsed;
        extra = rest;
      }
    } catch {
      // 旧行损坏：按无旧字段处理，不抛
    }
  }
  const merged = { character_uid: uid, name, ...extra };
  return `<!-- character_identity: ${JSON.stringify(merged)} -->`;
}

/** md 身份机械同步：顶部 character_identity 注释 + 「别名:」行；md 不存在则建骨架（文学正文归 world-curator 的 Write） */
function syncIdentityIntoMarkdown(
  md: string | null,
  uid: string,
  name: string,
  aliases: string[],
): string {
  const identityLine = buildIdentityLine(md, uid, name);
  const aliasLine = `别名: ${aliases.length > 0 ? aliases.join("、") : "无"}`;
  if (md === null) {
    return `${identityLine}\n# ${name}\n\n${aliasLine}\n`;
  }
  let next = CHARACTER_IDENTITY_RE.test(md)
    ? md.replace(CHARACTER_IDENTITY_RE, identityLine)
    : `${identityLine}\n${md}`;
  const aliasRe = /^[\s>*-]*(?:\*\*)?别名(?:\*\*)?\s*[:：].*$/m;
  next = aliasRe.test(next)
    ? next.replace(aliasRe, aliasLine)
    : `${next.trimEnd()}\n\n${aliasLine}\n`;
  return next;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 md 顶部 character_identity 注释读 character_uid（撞名门 md-only 分支用）。
 * md 不存在 / 无该注释 / 注释损坏（parse 失败）一律返回 null——不拦、交工具认领，
 * 因为没有可信身份线索时不能假设「已被占用」。
 */
async function readIdentityUidFromMarkdown(mdPath: string): Promise<string | null> {
  let md: string;
  try {
    md = await readFile(mdPath, "utf-8");
  } catch {
    return null;
  }
  const match = md.match(CHARACTER_IDENTITY_RE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as { character_uid?: unknown };
    return typeof parsed.character_uid === "string" && parsed.character_uid.trim() ? parsed.character_uid : null;
  } catch {
    return null;
  }
}

/**
 * 同 character_uid 换 name 重提交（候选转正定名 / 作者改名）：扫描 bible/characters/*.json，
 * 找 uid 相同但文件名 ≠ 新 name 的旧实体文件，把旧 md 随迁到新名下、删除旧 json（新 json 随后全量重写）。
 * 若新旧 md 同时存在（罕见冲突），不动任何旧文件，只出 warning 提示人工合并。
 * 返回 warnings：命中改名/冲突时非空，供 agent 提示用户把旧名补进 aliases 或人工处理。
 */
async function migrateRenamedEntityFiles(
  dir: string,
  uid: string,
  newName: string,
): Promise<string[]> {
  const warnings: string[] = [];
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return warnings;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const oldName = file.replace(/\.json$/, "");
    if (oldName === newName) continue;
    const oldJsonPath = join(dir, file);
    let oldEntity: { character_uid?: unknown };
    try {
      oldEntity = JSON.parse(await readFile(oldJsonPath, "utf-8"));
    } catch {
      continue;
    }
    if (oldEntity.character_uid !== uid) continue;

    const oldMdPath = join(dir, `${oldName}.md`);
    const newMdPath = join(dir, `${newName}.md`);
    const [oldMdExists, newMdExists] = await Promise.all([pathExists(oldMdPath), pathExists(newMdPath)]);

    if (oldMdExists && newMdExists) {
      warnings.push(
        `角色改名冲突：检测到 character_uid ${uid} 从「${oldName}」改名为「${newName}」，但两者的档案 md 文件同时存在，未自动处理，请人工合并（保留一份、把另一名加入 aliases）`,
      );
      continue;
    }
    if (oldMdExists) {
      await rename(oldMdPath, newMdPath);
    }
    await unlink(oldJsonPath).catch(() => {});
    warnings.push(
      `角色改名：${oldName} → ${newName}，档案文件已随迁；若正文仍用旧名称呼，请把旧名加入 aliases`,
    );
  }
  return warnings;
}

export async function novelSubmitCharacterEntity(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const check = validateCharacterEntity(args["payload"]);
  if (!check.valid) return errorResponse(check.errors);
  const payload = args["payload"] as EntityPayload;

  const vocab = loadStateVocabulary(ctx.projectRoot);
  const stateErrors = checkInitialStates(payload.initial_states, vocab);
  if (stateErrors.length > 0) return errorResponse(stateErrors);

  const uid = payload.character_uid ?? randomUUID();
  const effective = payload.effective_chapter ?? 0;
  const aliases = payload.aliases ?? [];

  const dir = join(ctx.projectRoot, "bible", "characters");

  // 0. 同名不同 uid 拒绝门：name 已被另一 uid 的既有实体占用则拒绝写入，防止静默覆盖
  //    （读文件失败/坏 JSON 按不存在处理，不拦；同 uid 视为同一角色的合法重提交）
  //    json 不存在但同名 md 存在且带可信身份注释时同样查——json 缺失不等于「名字未被占用」，
  //    可能是仅有文学正文的 md-only 角色（如 world-curator 先写 md 未提交结构化半边）；
  //    md 无注释/注释损坏则视为无可信身份线索，放行（工具认领）。
  const targetJsonPath = join(dir, `${payload.name}.json`);
  let existingUid: string | null = null;
  try {
    const existingEntity = JSON.parse(await readFile(targetJsonPath, "utf-8")) as { character_uid?: unknown };
    if (typeof existingEntity.character_uid === "string") existingUid = existingEntity.character_uid;
  } catch {
    existingUid = null;
  }
  if (existingUid === null) {
    existingUid = await readIdentityUidFromMarkdown(join(dir, `${payload.name}.md`));
  }
  if (existingUid !== null && existingUid !== uid) {
    return errorResponse([
      {
        field: "name",
        expected: "名字未被其他角色占用，或传该角色的既有 character_uid",
        actual: `${payload.name} 已属于 uid ${existingUid}`,
        hint: "该名字已是另一角色的档案：若是同一角色请传其既有 character_uid；若是改名撞名请换名；角色合并本期不支持",
      },
    ]);
  }

  // 1. 实体 json 落盘（文件即真相，覆盖式幂等）
  await mkdir(dir, { recursive: true });

  // 1a. 同 uid 换 name（候选转正定名 / 作者改名）：旧档案文件随迁，防孤儿双档
  const warnings = await migrateRenamedEntityFiles(dir, uid, payload.name);

  const entity = { ...payload, character_uid: uid };
  await writeFile(join(dir, `${payload.name}.json`), `${JSON.stringify(entity, null, 2)}\n`, "utf-8");

  // 2. md 身份机械同步（仅身份注释与别名行两处；文学描述不动）
  const mdPath = join(dir, `${payload.name}.md`);
  let md: string | null = null;
  try {
    md = await readFile(mdPath, "utf-8");
  } catch {
    md = null;
  }
  await writeFile(mdPath, syncIdentityIntoMarkdown(md, uid, payload.name, aliases), "utf-8");

  // 3. initial_states → authored facts（同值跳过；one 维度换值旧行失效指向新值）
  // asOf 取 max(本书最新已总结章, 1)：已写书重提交实体（如候选转正补记）
  // 不能让状态卡的 as_of_chapter 倒退到 1，否则会吞掉已抽取入库的更新状态（extracted 状态丢失）
  const latestSummarizedRow = ctx.db
    .prepare(`SELECT MAX(chapter) AS c FROM chapter_summaries WHERE novel_id=?`)
    .get(ctx.novelId) as { c: number | null };
  const latestSummarized = latestSummarizedRow.c ?? 0;
  // cardAsOf 不取 effective：effective 可能晚于本书已写章节（如候选提前埋伏未来状态），
  // 若折进 max() 会把「尚未发生」的状态提前折叠进当前卡——FACT_VALID_AT_SQL 本会按 asOf 天然
  // 过滤掉 event_chapter > asOf 的 fact，但前提是 asOf 本身不被 effective 拖到未来（PR#452评审P1-B）
  const cardAsOf = Math.max(latestSummarized, 1);

  let written = 0;
  let skipped = 0;
  const tx = ctx.db.transaction(() => {
    const insert = ctx.db.prepare(
      `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, sector, from_chapter, event_chapter, source)
       VALUES (?, ?, ?, ?, ?, ?, 'semantic', ?, ?, 'authored')`,
    );
    for (const s of payload.initial_states ?? []) {
      const dim = vocab!.dimensions.find((d) => d.key === s.dimension)!;
      // 去重：同 uid+predicate+object 且仍生效 → 跳过（老行为）；
      // 或同 uid+predicate+object 且落在同一起点章（COALESCE(event_chapter,from_chapter)=effective）
      // → 无论是否已失效都算「已记录过」，跳过——防止完整重提时把已被后续演变作废的
      // 初始值当成新值重新插一条，那条新行 invalidated_at_chapter 是 NULL，会被读成「永久有效」
      // 把后续演变的更新值一起顶掉（PR#452评审P1-A）。
      // 注：novel_submit_authored_state 的同款 dup 门已收窄为「历史上真实生效过」（终审 I1，见该
      // 函数内注释）——本处（world 整实体重提交，语境是「完整覆盖式重提」而非单条时间线编辑操作）
      // 暂不收窄，是否需要对齐留作 follow-up 评估。
      const dup = ctx.db
        .prepare(
          `SELECT id FROM facts WHERE novel_id=? AND subject_character_uid=? AND predicate=? AND object=?
             AND (invalidated_at_chapter IS NULL OR COALESCE(event_chapter, from_chapter) = ?)`,
        )
        .get(ctx.novelId, uid, dim.predicate, s.value, effective);
      if (dup) {
        skipped += 1;
        continue;
      }
      const newId = randomUUID();
      if (dim.cardinality === "one" && dim.value_type === "enum" && dim.values) {
        // one 维度换值：只作废「生效点上」的旧值——COALESCE(event_chapter,from_chapter) <= effective，
        // 不碰 effective 之后才开始的演变（如已被正文抽取的后续状态），否则会把「未来」倒杀成
        // invalidated_at_chapter < from_chapter 的非法区间（PR#452评审P1-A）
        ctx.db
          .prepare(
            `UPDATE facts SET invalidated_at_chapter=?, invalidated_by=?, updated_at=datetime('now')
             WHERE novel_id=? AND subject_character_uid=? AND predicate=? AND invalidated_at_chapter IS NULL
               AND object IN (${dim.values.map(() => "?").join(",")})
               AND COALESCE(event_chapter, from_chapter) <= ?`,
          )
          .run(effective, newId, ctx.novelId, uid, dim.predicate, ...dim.values, effective);
      }
      insert.run(newId, ctx.novelId, payload.name, uid, dim.predicate, s.value, effective, effective);
      written += 1;
    }
    // 4. 候选池回写 promoted（uid 命中才动）
    ctx.db
      .prepare(
        `UPDATE candidate_characters SET status='promoted', updated_at=datetime('now')
         WHERE novel_id=? AND character_uid=? AND status='candidate'`,
      )
      .run(ctx.novelId, uid);
    // 5. 刷新状态卡（复用 writers.ts SSOT：空卡不写、非空 upsert）
    refreshCharacterCards(ctx, [{ uid, name: payload.name }], cardAsOf);
  });
  tx();

  return {
    ok: true,
    character_uid: uid,
    entity_path: `bible/characters/${payload.name}.json`,
    facts_written: written,
    facts_skipped: skipped,
    warnings,
  };
}

// ============================================================
// novel_submit_authored_state
// ============================================================

/** 按 id 失效单条 fact（审计链：invalidated_by 指向取代者，无取代者传 null）。 */
function invalidateFactById(
  ctx: ToolContext,
  factId: string,
  atChapter: number,
  replacedBy: string | null,
): void {
  ctx.db
    .prepare(
      `UPDATE facts SET invalidated_at_chapter=?, invalidated_by=?, updated_at=datetime('now')
       WHERE id=? AND novel_id=?`,
    )
    .run(atChapter, replacedBy, factId, ctx.novelId);
}

interface AuthoredFactRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  from_chapter: number;
  event_chapter: number | null;
  invalidated_at_chapter: number | null;
  invalidated_by: string | null;
  source: string;
  secret_known: number | null;
}

/** 卡刷新 asOf 用（cardAsOf 公式，PR#452 P1-B）；不用于 authored 行的 from_chapter。 */
function latestSummarizedChapter(ctx: ToolContext): number {
  const row = ctx.db
    .prepare(`SELECT MAX(chapter) AS c FROM chapter_summaries WHERE novel_id=?`)
    .get(ctx.novelId) as { c: number | null };
  return row.c ?? 0;
}

export async function novelSubmitAuthoredState(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const check = validateAuthoredState(args["payload"]);
  if (!check.valid) return errorResponse(check.errors);
  const p = args["payload"] as {
    character_uid: string;
    action: "set_current" | "backfill" | "correct" | "retract" | "endorse" | "mark_secret_known";
    dimension?: string;
    operation?: "set" | "add" | "remove";
    value?: string;
    effective_chapter?: number;
    target_fact_id?: string;
    new_value?: string;
    new_event_chapter?: number;
    expected_current_value?: string;
    known?: boolean;
    secret_known?: boolean;
  };

  const uid = p.character_uid;
  // subject 显示名：别名表 canonical 反查；无档角色以最近 fact 的 subject 兜底
  const aliasMap = await loadAliasMap(ctx.projectRoot);
  let subject: string | null = null;
  for (const [, resolved] of aliasMap) {
    if (resolved.uid === uid) { subject = resolved.canonical; break; }
  }
  if (!subject) {
    const row = ctx.db
      .prepare(
        `SELECT subject FROM facts WHERE novel_id=? AND subject_character_uid=? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(ctx.novelId, uid) as { subject: string } | undefined;
    subject = row?.subject ?? null;
  }
  if (!subject) {
    return singleError("character_uid", "已建档或已有事实记录的角色", uid, "先经 world/转正为该角色建档");
  }

  const registeredAt = latestSummarizedChapter(ctx);
  const cardAsOf = Math.max(registeredAt, 1);
  // I5：refresh 后若折叠出的卡是空卡，refreshCharacterCards 会跳过写入（不覆盖非空旧卡以防误判），
  // 但已存在的旧卡行不会被它删除——action 把角色唯一记录 retract/失效后必须清掉那条过期卡行，
  // 否则 App 会继续读到一张早已不成立的状态卡。不改 refreshCharacterCards 本身（SSOT），
  // 用它的返回值（未写入即视为空卡）在这里补一刀删除。
  const refresh = () => {
    const refreshed = refreshCharacterCards(ctx, [{ uid, name: subject! }], cardAsOf);
    if (refreshed.length === 0) {
      ctx.db
        .prepare(`DELETE FROM character_cards WHERE novel_id=? AND character_uid=?`)
        .run(ctx.novelId, uid);
    }
  };

  // 词表提前加载：correct 的值域门（I4）与 set_current/backfill 均需要；词表缺失时
  // correct 对自由谓词放行（下方仅在归属到 enum 维度时才校验），set_current/backfill 单独拦截
  const vocab = loadStateVocabulary(ctx.projectRoot);

  // ── correct / retract / endorse / mark_secret_known：按 target_fact_id 锚定 ──
  if (p.action === "correct" || p.action === "retract" || p.action === "endorse" || p.action === "mark_secret_known") {
    // I3：关系事实（subject_character_b_uid 非空）不许经本工具改——关系修订走后续关系编辑入口
    const target = ctx.db
      .prepare(
        `SELECT id, subject, predicate, object, from_chapter, event_chapter, invalidated_at_chapter, invalidated_by, source, secret_known
         FROM facts WHERE id=? AND novel_id=? AND subject_character_uid=? AND subject_character_b_uid IS NULL`,
      )
      .get(p.target_fact_id, ctx.novelId, uid) as AuthoredFactRow | undefined;
    if (!target) {
      const isRelationship = ctx.db
        .prepare(
          `SELECT 1 FROM facts WHERE id=? AND novel_id=? AND subject_character_uid=? AND subject_character_b_uid IS NOT NULL`,
        )
        .get(p.target_fact_id, ctx.novelId, uid);
      if (isRelationship) {
        return singleError(
          "target_fact_id",
          "非关系类事实记录",
          p.target_fact_id ?? "",
          "关系事实不支持经本工具修订，关系修订走后续关系编辑入口",
        );
      }
      return singleError("target_fact_id", "存在且仍有效的事实记录", p.target_fact_id ?? "", "记录已变化，请刷新后重试");
    }
    const targetEvent = target.event_chapter ?? target.from_chapter;
    // F3：只拒「从未生效」行——已被 correct/retract 打成 invalidated_at_chapter <= 自身 event
    // （即从未真正生效过）的行不许再动；被后续演变「自然顶替」的行（invalidated_at_chapter >
    // targetEvent，如筑基把练气顶掉）历史上真实生效过，理应放行三 action 纠错/撤回/背书——
    // 否则一条历史行一旦被更晚的状态顶替，就再也无法回头修正它当年记录错的值（PR#454 评审 F3）
    if (target.invalidated_at_chapter !== null && target.invalidated_at_chapter <= targetEvent) {
      return singleError("target_fact_id", "未被修正/撤回的事实记录", p.target_fact_id ?? "", "该记录已被修正或撤回，请刷新后重试");
    }

    if (p.action === "endorse") {
      if (target.source !== "extracted") {
        return singleError("target_fact_id", "extracted 来源的记录", target.source, "该记录已是作者背书，无需重复确认");
      }
      // M9：UPDATE + 卡刷新包进同一事务，与其余 action 一致（避免刷新失败时 source 已落盘的半提交态）
      const tx = ctx.db.transaction(() => {
        ctx.db
          .prepare(`UPDATE facts SET source='authored', updated_at=datetime('now') WHERE id=? AND novel_id=?`)
          .run(target.id, ctx.novelId);
        refresh();
      });
      tx();
      return { ok: true, action: p.action, fact_id: target.id };
    }

    if (p.action === "mark_secret_known") {
      if (target.predicate !== "secret") {
        return singleError("target_fact_id", "secret 谓词的事实记录", target.predicate, "「本人已知晓」标记仅适用于 secret（秘密）类事实");
      }
      const next = p.known ? 1 : 0;
      if ((target.secret_known ?? 0) !== next) {
        ctx.db
          .prepare(`UPDATE facts SET secret_known=?, updated_at=datetime('now') WHERE id=? AND novel_id=?`)
          .run(next, target.id, ctx.novelId);
      }
      return { ok: true, action: p.action, fact_id: target.id };
    }

    if (p.action === "retract") {
      const tx = ctx.db.transaction(() => {
        invalidateFactById(ctx, target.id, targetEvent, null);
        // C1：target 本身若曾把某些行判定失效（invalidated_by 指向 target），target 自己被撤回后
        // 那些受害行须复活——「取代者死，受害者活」，语义对齐 §3.3 折叠排序（authored 优先）
        revalidateVictimsOf(ctx.db, ctx.novelId, target.id);
        refresh();
      });
      tx();
      return { ok: true, action: p.action, invalidated_fact_id: target.id };
    }

    // correct：插新行 + 旧行自失效点起从未生效
    const newObject = p.new_value ?? target.object;
    // F7：值域门须按 (target.predicate, new_value) 归属而非旧值——脏历史行的旧值本就可能不在
    // 任何值域内（如撞名共谓词但旧值属于另一维度），继续按旧值归属会把合法纠错误拒；同时修掉
    // 共谓词多维度场景下「从 A 维度值纠正到 B 维度值」被 A 维度值域误拒的问题（评审 F7）。
    // 规则：该谓词下存在 enum 维度且 new_value 命中其一值域 → 过；该谓词有 free 维度 → 过；
    // 该谓词只有 enum 维度且都不命中 → 拒；该谓词在词表无任何维度（自由谓词）→ 放行；词表缺失 → 放行。
    if (p.new_value !== undefined && vocab) {
      const predicateDims = vocab.dimensions.filter((d) => d.predicate === target.predicate);
      const enumDims = predicateDims.filter((d) => d.value_type === "enum");
      const hasFreeDim = predicateDims.some((d) => d.value_type === "free");
      const matchesSomeEnum = enumDims.some((d) => d.values?.includes(p.new_value!));
      if (enumDims.length > 0 && !hasFreeDim && !matchesSomeEnum) {
        const allowedValues = enumDims.flatMap((d) => d.values ?? []).join("/");
        return singleError(
          "new_value",
          `该谓词下词表值域内的值（${allowedValues}）`,
          p.new_value,
          "扩词表加值（重交 novel_submit_state_vocabulary）或纠正为值域内的值",
        );
      }
    }
    // F3 二阶语义：target 若是被后续演变「自然顶替」（而非 retract/correct 打成从未生效），
    // 须在 target 自身的失效字段被本次操作改写前，先记下它原本被谁、在哪一章顶替——新行随后
    // 要原样继承这份顶替信息，否则纠错一件早已失去的持有物（如已被后续状态覆盖的旧值）会让
    // 它复活进当前卡（PR#454 评审 F3）
    const naturallySupersededAt =
      target.invalidated_at_chapter !== null && target.invalidated_at_chapter > targetEvent
        ? target.invalidated_at_chapter
        : null;
    const naturallySupersededBy = naturallySupersededAt !== null ? target.invalidated_by : null;
    const newId = randomUUID();
    const newEvent = p.new_event_chapter ?? targetEvent;
    const tx = ctx.db.transaction(() => {
      ctx.db
        .prepare(
          `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, sector, from_chapter, event_chapter, source, secret_known)
           VALUES (?, ?, ?, ?, ?, ?, 'semantic', ?, ?, 'authored', ?)`,
        )
        .run(newId, ctx.novelId, target.subject, uid, target.predicate, newObject, newEvent, newEvent, target.secret_known ?? 0);
      invalidateFactById(ctx, target.id, targetEvent, newId);
      // 复核 N1：newEvent === targetEvent（仅改值，未改发生章）时 target 的「取代关系」语义
      // 仍然成立——新行只是替换了 target 的值，并未撤销 target 曾经打倒过谁；此时应由新行
      // 直接继承 target 的取代者身份（re-point invalidated_by），而不是 revalidateVictimsOf
      // 把受害行放活。否则 many 维度会把已被 target 顶掉的旧值误复活（如短刀被灵剑顶掉后，
      // 仅纠正灵剑的描述值，短刀不该跟着复活混进持有物）。
      // newEvent !== targetEvent（改了发生章，取代点本身在时间线上挪动）才维持原有的
      // revalidateVictimsOf——C1：target 被自身失效前所压制的受害行须复活（折叠排序会让新行仍压住它们）。
      if (newEvent === targetEvent) {
        ctx.db
          .prepare(
            `UPDATE facts SET invalidated_by=?, updated_at=datetime('now') WHERE novel_id=? AND invalidated_by=?`,
          )
          .run(newId, ctx.novelId, target.id);
      } else {
        revalidateVictimsOf(ctx.db, ctx.novelId, target.id);
      }
      // F3：newId 继承 target 原本「被自然顶替」的失效信息（若有）——target 自身的失效字段
      // 已在上面被 invalidateFactById 改写指向 newId，故此处用的是本次操作前捕获的原值。
      if (naturallySupersededAt !== null) {
        ctx.db
          .prepare(
            `UPDATE facts SET invalidated_at_chapter=?, invalidated_by=?, updated_at=datetime('now') WHERE id=? AND novel_id=?`,
          )
          .run(naturallySupersededAt, naturallySupersededBy, newId, ctx.novelId);
      }
      refresh();
    });
    tx();
    return { ok: true, action: p.action, fact_id: newId, invalidated_fact_id: target.id };
  }

  // ── set_current / backfill：按词表维度写入 ──
  if (!vocab) {
    return singleError("dimension", "本书已提交状态词表", "词表缺失", "先经 world 提交 novel_submit_state_vocabulary");
  }
  const dim = vocab.dimensions.find((d) => d.key === p.dimension);
  if (!dim) {
    return singleError("dimension", `词表内的维度 key（${vocab.dimensions.map((d) => d.key).join("/")}）`, p.dimension ?? "", "扩词表（重交 novel_submit_state_vocabulary）或改用已有维度");
  }
  if (p.secret_known !== undefined && dim.predicate !== "secret") {
    return singleError("secret_known", "secret 谓词维度", dim.predicate, "「本人已知晓」声明仅适用于 secret（秘密）类维度");
  }
  if (dim.value_type === "enum" && dim.values && !dim.values.includes(p.value!)) {
    return singleError("value", `维度「${dim.display_name}」值域内的值（${dim.values.join("/")}）`, p.value!, "扩词表加值（重交 novel_submit_state_vocabulary）或纠正为值域内的值");
  }
  const operation = dim.cardinality === "one" ? (p.operation ?? "set") : (p.operation ?? "add");
  if (dim.cardinality === "one" && operation !== "set") {
    return singleError("operation", "one 维度只支持 set", operation, "单值维度直接 set 新值即可");
  }
  // M6：many 维度不支持 set（对称门）——集合维度的替换语义须显式走 remove 再 add，不接受笼统 set
  if (dim.cardinality === "many" && operation === "set") {
    return singleError("operation", "many 维度只支持 add/remove", operation, "集合维度用 add/remove");
  }
  // M8：backfill 恒 add 语义（只补录历史、不作废任何旧行）；显式传 set/remove 会绕开这条不变量
  // （remove 分支不区分 action 会直接失效当前值，set 对 one 维度的失效循环虽被 action 守卫但仍应
  // 一并拒绝以保持文案与语义一致），故只认「用户未传 operation」时的隐式默认值
  if (p.action === "backfill" && (p.operation === "set" || p.operation === "remove")) {
    return singleError(
      "operation",
      "backfill 不接受显式 operation：单值维度自动 set、集合维度自动 add；历史失效走时间线作废/纠错",
      p.operation,
      "历史失效走时间线作废（retract）或纠错（correct），backfill 不接受 set/remove",
    );
  }

  const event = p.effective_chapter!;
  // 当前有效行（本维度归属，JS 过滤复用归属 SSOT）；SQL 侧按 §3.3 同序排好（event 轴最新、
  // authored 优先），dimRows[0] 即当前值，无需另写一套 JS 排序（FACT_LATEST_ORDER_SQL 是
  // readers.ts / character-card-fold.ts 共用的折叠排序 SSOT）
  const validRows = ctx.db
    .prepare(
      `SELECT id, subject, predicate, object, from_chapter, event_chapter, invalidated_at_chapter, source
       FROM facts WHERE novel_id=? AND subject_character_uid=? AND subject_character_b_uid IS NULL
         AND predicate=? AND invalidated_at_chapter IS NULL
       ORDER BY ${FACT_LATEST_ORDER_SQL}`,
    )
    .all(ctx.novelId, uid, dim.predicate) as AuthoredFactRow[];
  const dimRows = validRows.filter((row) => attributeFact(vocab, row.predicate, row.object)?.key === dim.key);

  if (p.action === "set_current" && p.expected_current_value !== undefined) {
    // M7：乐观锁的「当前值」须按卡面口径（asOf=cardAsOf）折叠，不能拿 dimRows[0]（全部仍有效行，
    // 含尚未生效的未来 authored 行）——两者在存在未来钦定行时会分歧，误把未来值当「当前」比对，
    // 导致合法的按卡面值提交被误拒。复用 FACT_VALID_AT_SQL（与 foldCharacterCard 同一折叠 SSOT）。
    const cardRows = ctx.db
      .prepare(
        `SELECT object FROM facts WHERE novel_id=? AND subject_character_uid=? AND subject_character_b_uid IS NULL
           AND predicate=? AND ${FACT_VALID_AT_SQL}
         ORDER BY ${FACT_LATEST_ORDER_SQL}`,
      )
      .all(ctx.novelId, uid, dim.predicate, cardAsOf, cardAsOf) as Array<{ object: string }>;
    const current = cardRows.find((row) => attributeFact(vocab, dim.predicate, row.object)?.key === dim.key);
    if ((current?.object ?? "") !== p.expected_current_value) {
      return singleError("expected_current_value", p.expected_current_value, current?.object ?? "（无）", "状态已变化，请刷新后重试");
    }
  }

  if (operation === "remove") {
    const hit = dimRows.find((row) => row.object === p.value);
    if (!hit) {
      return singleError("value", `维度「${dim.display_name}」当前持有的值`, p.value!, "该值不在当前状态中，刷新后重试");
    }
    const tx = ctx.db.transaction(() => {
      invalidateFactById(ctx, hit.id, event, null);
      refresh();
    });
    tx();
    return { ok: true, action: p.action, invalidated_fact_id: hit.id };
  }

  // add / set：幂等去重（仍有效且生效点已到或早于当前生效点的同值行 → 跳过；或同生效点上「历史
  // 上真实生效过」的同值行 → 跳过，对齐 initial_states 先例）。第二分支须收窄为「曾经生效」
  // （invalidated_at_chapter > 生效点，即被后续演变作废）——若已被 retract/correct 打成「从未
  // 生效」（invalidated_at_chapter <= 生效点，PR#452 P1-A 的「从未生效」语义）的同值同章行也被
  // 当 dup，会让作者 retract 误删后无法在同值同生效章重做，返回 skipped:true 却没有恢复路径
  // （终审 I1）。第一分支须再加生效点上限（COALESCE(event,from) <= 当前 event）——否则一条「未来」
  // 才生效的同值 authored 行（仍在 invalidated_at_chapter IS NULL 的有效期内）会把作者对更早章节
  // 的钦定误判为「已记录过」而静默跳过，吞掉当下这条钦定（PR#454 评审 F4）
  const dup = ctx.db
    .prepare(
      `SELECT id FROM facts WHERE novel_id=? AND subject_character_uid=? AND predicate=? AND object=?
         AND ((invalidated_at_chapter IS NULL AND COALESCE(event_chapter, from_chapter) <= ?)
           OR (COALESCE(event_chapter, from_chapter) = ? AND invalidated_at_chapter > COALESCE(event_chapter, from_chapter)))`,
    )
    .get(ctx.novelId, uid, dim.predicate, p.value, event, event);
  if (dup) {
    // 注意：撞 dup 时 payload 随行的 secret_known 声明不落库（本分支不触碰既有行，静默丢弃）——
    // 作者要对既有事实打「本人已知晓」标，应走 mark_secret_known（factId 锚定就地 UPDATE）
    return { ok: true, action: p.action, skipped: true };
  }

  const newId = randomUUID();
  const tx = ctx.db.transaction(() => {
    if (p.action === "set_current" && operation === "set") {
      // one 维度换值：只失效「生效点上」的本维度旧值（id 精确 + event 守卫，对齐 PR#452 P1-A）
      for (const row of dimRows) {
        if ((row.event_chapter ?? row.from_chapter) <= event) {
          invalidateFactById(ctx, row.id, event, newId);
        }
      }
    }
    ctx.db
      .prepare(
        `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, sector, from_chapter, event_chapter, source, secret_known)
         VALUES (?, ?, ?, ?, ?, ?, 'semantic', ?, ?, 'authored', ?)`,
      )
      .run(newId, ctx.novelId, subject, uid, dim.predicate, p.value, event, event, p.secret_known ? 1 : 0);
    refresh();
  });
  tx();
  return { ok: true, action: p.action, fact_id: newId };
}
