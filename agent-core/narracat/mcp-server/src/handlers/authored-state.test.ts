import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../migrate.js";
import {
  novelSubmitStateVocabulary,
  novelSubmitCharacterEntity,
  novelSubmitAuthoredState,
} from "./character-entity.js";
import { novelRollbackChapter } from "./writers.js";
import { foldCharacterCard, isEmptyFoldedCard } from "./character-card-fold.js";
import type { ToolContext } from "../types.js";

function makeCtx(): ToolContext {
  const db = new Database(":memory:");
  initSchema(db);
  return { novelId: "n1", db, projectRoot: mkdtempSync(join(tmpdir(), "authored-state-tool-")) } as ToolContext;
}

async function submitVocab(ctx: ToolContext): Promise<void> {
  await novelSubmitStateVocabulary(
    {
      payload: {
        dimensions: [
          { key: "cultivation_level", predicate: "ability", display_name: "境界", cardinality: "one", value_type: "enum", values: ["练气", "筑基", "金丹"] },
          { key: "inventory", predicate: "possession", display_name: "持有物", cardinality: "many", value_type: "free" },
        ],
      },
    },
    ctx,
  );
}

function insertSummary(ctx: ToolContext, chapter: number): void {
  ctx.db
    .prepare(`INSERT INTO chapter_summaries (id, novel_id, chapter, summary) VALUES (?, 'n1', ?, '摘要')`)
    .run(randomUUID(), chapter);
}

function insertFact(
  ctx: ToolContext,
  uid: string,
  overrides: {
    id?: string;
    subject?: string;
    predicate?: string;
    object: string;
    from_chapter: number;
    event_chapter?: number;
    source?: "extracted" | "authored";
    invalidated_at_chapter?: number | null;
    invalidated_by?: string | null;
    subject_character_b_uid?: string | null;
    secret_known?: boolean;
  },
): string {
  const id = overrides.id ?? randomUUID();
  ctx.db
    .prepare(
      `INSERT INTO facts (id, novel_id, subject, subject_character_uid, subject_character_b_uid, predicate, object, sector, from_chapter, event_chapter, source, invalidated_at_chapter, invalidated_by, secret_known)
       VALUES (?, 'n1', ?, ?, ?, ?, ?, 'semantic', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      overrides.subject ?? "苏见",
      uid,
      overrides.subject_character_b_uid ?? null,
      overrides.predicate ?? "ability",
      overrides.object,
      overrides.from_chapter,
      overrides.event_chapter ?? overrides.from_chapter,
      overrides.source ?? "extracted",
      overrides.invalidated_at_chapter ?? null,
      overrides.invalidated_by ?? null,
      overrides.secret_known ? 1 : 0,
    );
  return id;
}

describe("novel_submit_authored_state", () => {
  it("1. set_current one+enum：插 authored 行、旧值按归属失效指向新行、卡刷新为新值", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    insertSummary(ctx, 10);

    const oldFact = ctx.db
      .prepare("SELECT id FROM facts WHERE subject_character_uid=? AND object='练气'")
      .get(uid) as { id: string };

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "筑基", effective_chapter: 5 } },
      ctx,
    )) as { ok: boolean; action: string; fact_id: string };

    expect(result.ok).toBe(true);
    expect(result.action).toBe("set_current");
    expect(result.fact_id).toBeTruthy();

    const newFact = ctx.db
      .prepare("SELECT from_chapter, event_chapter, object, source FROM facts WHERE id=?")
      .get(result.fact_id) as { from_chapter: number; event_chapter: number; object: string; source: string };
    expect(newFact.from_chapter).toBe(5);
    expect(newFact.event_chapter).toBe(5);
    expect(newFact.object).toBe("筑基");
    expect(newFact.source).toBe("authored");

    const oldRow = ctx.db
      .prepare("SELECT invalidated_at_chapter, invalidated_by FROM facts WHERE id=?")
      .get(oldFact.id) as { invalidated_at_chapter: number | null; invalidated_by: string | null };
    expect(oldRow.invalidated_at_chapter).toBe(5);
    expect(oldRow.invalidated_by).toBe(result.fact_id);

    const card = ctx.db
      .prepare("SELECT card_json FROM character_cards WHERE novel_id='n1' AND character_uid=?")
      .get(uid) as { card_json: string };
    expect(JSON.parse(card.card_json).dimensions.cultivation_level.value).toBe("筑基");
  });

  it("2. set_current 值域外值 → ok:false，hint 含「词表」", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "元婴", effective_chapter: 3 } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };

    expect(result.ok).toBe(false);
    expect(result.errors[0].hint).toContain("词表");
  });

  it("3. set_current expected_current_value 与当前值不符 → ok:false 且库内零变更", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );

    const before = (ctx.db.prepare("SELECT COUNT(*) AS c FROM facts").get() as { c: number }).c;

    const result = (await novelSubmitAuthoredState(
      {
        payload: {
          character_uid: uid,
          action: "set_current",
          dimension: "cultivation_level",
          value: "筑基",
          effective_chapter: 3,
          expected_current_value: "筑基",
        },
      },
      ctx,
    )) as { ok: boolean };

    expect(result.ok).toBe(false);
    const after = (ctx.db.prepare("SELECT COUNT(*) AS c FROM facts").get() as { c: number }).c;
    expect(after).toBe(before);
  });

  it("4. many+add 幂等跳过；many+remove 失效对应行；remove 不存在的值 → ok:false", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "inventory", value: "短刀" }] } },
      ctx,
    );

    const dup = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "inventory", operation: "add", value: "短刀", effective_chapter: 1 } },
      ctx,
    )) as { ok: boolean; skipped?: boolean };
    expect(dup.ok).toBe(true);
    expect(dup.skipped).toBe(true);
    const countAfterDup = (
      ctx.db.prepare("SELECT COUNT(*) AS c FROM facts WHERE subject_character_uid=?").get(uid) as { c: number }
    ).c;
    expect(countAfterDup).toBe(1);

    const removed = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "inventory", operation: "remove", value: "短刀", effective_chapter: 2 } },
      ctx,
    )) as { ok: boolean; invalidated_fact_id: string };
    expect(removed.ok).toBe(true);
    expect(removed.invalidated_fact_id).toBeTruthy();
    const invalidatedRow = ctx.db
      .prepare("SELECT invalidated_at_chapter FROM facts WHERE id=?")
      .get(removed.invalidated_fact_id) as { invalidated_at_chapter: number };
    expect(invalidatedRow.invalidated_at_chapter).toBe(2);

    const removeMissing = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "inventory", operation: "remove", value: "匕首", effective_chapter: 3 } },
      ctx,
    )) as { ok: boolean };
    expect(removeMissing.ok).toBe(false);
  });

  it("5. backfill：不失效任何旧行；同值同章重复幂等跳过", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "backfill", dimension: "cultivation_level", value: "筑基", effective_chapter: 2 } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(result.ok).toBe(true);

    const oldRow = ctx.db
      .prepare("SELECT invalidated_at_chapter FROM facts WHERE subject_character_uid=? AND object='练气'")
      .get(uid) as { invalidated_at_chapter: number | null };
    expect(oldRow.invalidated_at_chapter).toBeNull();

    const dup = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "backfill", dimension: "cultivation_level", value: "筑基", effective_chapter: 2 } },
      ctx,
    )) as { ok: boolean; skipped?: boolean };
    expect(dup.ok).toBe(true);
    expect(dup.skipped).toBe(true);
  });

  it("6. correct 改值：新行继承 subject/predicate、旧行 invalidated_at=COALESCE(event,from)+invalidated_by=新id；correct 只改发生章亦可", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );

    const original = ctx.db
      .prepare("SELECT id, subject, predicate, from_chapter, event_chapter FROM facts WHERE subject_character_uid=? AND object='练气'")
      .get(uid) as { id: string; subject: string; predicate: string; from_chapter: number; event_chapter: number | null };

    const corrected = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: original.id, new_value: "筑基" } },
      ctx,
    )) as { ok: boolean; fact_id: string; invalidated_fact_id: string };
    expect(corrected.ok).toBe(true);
    expect(corrected.invalidated_fact_id).toBe(original.id);

    const newRow = ctx.db
      .prepare("SELECT subject, predicate, object, source FROM facts WHERE id=?")
      .get(corrected.fact_id) as { subject: string; predicate: string; object: string; source: string };
    expect(newRow.subject).toBe(original.subject);
    expect(newRow.predicate).toBe(original.predicate);
    expect(newRow.object).toBe("筑基");
    expect(newRow.source).toBe("authored");

    const oldRow = ctx.db
      .prepare("SELECT invalidated_at_chapter, invalidated_by FROM facts WHERE id=?")
      .get(original.id) as { invalidated_at_chapter: number; invalidated_by: string };
    const targetEvent = original.event_chapter ?? original.from_chapter;
    expect(oldRow.invalidated_at_chapter).toBe(targetEvent);
    expect(oldRow.invalidated_by).toBe(corrected.fact_id);

    // correct 只改发生章（不传 new_value）
    const chapterOnly = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: corrected.fact_id, new_event_chapter: 7 } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(chapterOnly.ok).toBe(true);
    const chapterOnlyRow = ctx.db
      .prepare("SELECT object, from_chapter, event_chapter FROM facts WHERE id=?")
      .get(chapterOnly.fact_id) as { object: string; from_chapter: number; event_chapter: number };
    expect(chapterOnlyRow.object).toBe("筑基"); // 值未变
    expect(chapterOnlyRow.event_chapter).toBe(7);
    expect(chapterOnlyRow.from_chapter).toBe(7); // 新行 from=event=生效章不变量
  });

  it("7. retract：target 失效（从未生效语义）、invalidated_by IS NULL、不插新行", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );

    const original = ctx.db
      .prepare("SELECT id, event_chapter, from_chapter FROM facts WHERE subject_character_uid=? AND object='练气'")
      .get(uid) as { id: string; event_chapter: number | null; from_chapter: number };
    const before = (ctx.db.prepare("SELECT COUNT(*) AS c FROM facts").get() as { c: number }).c;

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "retract", target_fact_id: original.id } },
      ctx,
    )) as { ok: boolean; invalidated_fact_id: string };
    expect(result.ok).toBe(true);
    expect(result.invalidated_fact_id).toBe(original.id);

    const after = (ctx.db.prepare("SELECT COUNT(*) AS c FROM facts").get() as { c: number }).c;
    expect(after).toBe(before);

    const row = ctx.db
      .prepare("SELECT invalidated_at_chapter, invalidated_by FROM facts WHERE id=?")
      .get(original.id) as { invalidated_at_chapter: number; invalidated_by: string | null };
    const targetEvent = original.event_chapter ?? original.from_chapter;
    expect(row.invalidated_at_chapter).toBe(targetEvent);
    expect(row.invalidated_by).toBeNull();

    // 「从未生效」：以 asOf=target.event 折叠也不再出现（直接调读侧折叠 SSOT，绕开卡写入的空卡不落盘噪声）
    const folded = foldCharacterCard(ctx, uid, targetEvent);
    expect(isEmptyFoldedCard(folded)).toBe(true);
  });

  it("8. endorse：target source 就地变 authored、id/值/章不变；已失效或已 authored 的 target → ok:false", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "苏见" } }, ctx);

    const extractedId = insertFact(ctx, uid, { object: "筑基", from_chapter: 5 });

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "endorse", target_fact_id: extractedId } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(result.ok).toBe(true);
    expect(result.fact_id).toBe(extractedId);

    const row = ctx.db
      .prepare("SELECT source, object, from_chapter, event_chapter FROM facts WHERE id=?")
      .get(extractedId) as { source: string; object: string; from_chapter: number; event_chapter: number };
    expect(row.source).toBe("authored");
    expect(row.object).toBe("筑基");
    expect(row.from_chapter).toBe(5);
    expect(row.event_chapter).toBe(5);

    // 已是 authored 的 target → ok:false
    const reEndorse = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "endorse", target_fact_id: extractedId } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(reEndorse.ok).toBe(false);
    expect(reEndorse.errors[0].hint).toContain("背书");

    // 「从未生效」的 target（invalidated_at_chapter <= 自身 event，如已被 retract/correct 打掉）
    // → ok:false；被后续演变自然顶替（invalidated_at_chapter > event）不在此列，见 F3a/F3b/F3c
    const invalidatedId = insertFact(ctx, uid, { object: "金丹", from_chapter: 8, invalidated_at_chapter: 8 });
    const endorseInvalidated = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "endorse", target_fact_id: invalidatedId } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(endorseInvalidated.ok).toBe(false);
    expect(endorseInvalidated.errors[0].hint).toContain("修正或撤回");
  });

  it("9. 未知维度 key / 词表缺失 → ok:false hint 引导", async () => {
    const ctx = makeCtx();
    const uid = randomUUID();
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "苏见" } }, ctx);

    const noVocab = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "练气", effective_chapter: 1 } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(noVocab.ok).toBe(false);
    expect(noVocab.errors[0].hint).toContain("novel_submit_state_vocabulary");

    await submitVocab(ctx);
    const unknownDim = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "not_a_real_dim", value: "x", effective_chapter: 1 } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(unknownDim.ok).toBe(false);
    expect(unknownDim.errors[0].hint).toContain("扩词表");
  });

  it("10. rollback 对齐：set_current 生效章即 from_chapter，回滚删除新行/恢复被失效旧行；早于回滚点的行保留", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    insertSummary(ctx, 20);

    // 场景 A：effective=8，回滚到第 8 章 → 新行被删、被它失效的旧行（练气@0）恢复
    const setA = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "筑基", effective_chapter: 8 } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(setA.ok).toBe(true);

    await novelRollbackChapter({ chapter: 8 }, ctx);

    const survivingIds = (
      ctx.db.prepare("SELECT id FROM facts WHERE subject_character_uid=?").all(uid) as Array<{ id: string }>
    ).map((r) => r.id);
    expect(survivingIds.includes(setA.fact_id)).toBe(false);
    const oldRestored = ctx.db
      .prepare("SELECT invalidated_at_chapter FROM facts WHERE subject_character_uid=? AND object='练气'")
      .get(uid) as { invalidated_at_chapter: number | null };
    expect(oldRestored.invalidated_at_chapter).toBeNull();

    // 场景 B：effective=5，回滚到第 8 章 → 该 authored 行保留（from=5<8，早期历史钦定不被后续重写撤销）
    const setB = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "金丹", effective_chapter: 5 } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(setB.ok).toBe(true);

    await novelRollbackChapter({ chapter: 8 }, ctx);

    const rowB = ctx.db.prepare("SELECT id FROM facts WHERE id=?").get(setB.fact_id) as { id: string } | undefined;
    expect(rowB).toBeDefined();
  });

  it("a. v2 词表模式下同章 authored 压 extracted：卡当前值取 authored（§3.3 折叠路径隐式覆盖）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    insertSummary(ctx, 5);

    // 正文抽取在第 5 章把境界写成「金丹」（source=extracted），与 authored 记录同 event 章共存
    insertFact(ctx, uid, { object: "金丹", from_chapter: 5, source: "extracted" });

    // 作者对同一章(5)的钦定：backfill 恒不失效旧行，纯叠加一条 authored 记录
    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "backfill", dimension: "cultivation_level", value: "筑基", effective_chapter: 5 } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(result.ok).toBe(true);

    // 两条记录都仍有效（backfill 未失效任何行）
    const validRows = ctx.db
      .prepare(
        "SELECT object, source FROM facts WHERE subject_character_uid=? AND predicate='ability' AND event_chapter=5 AND invalidated_at_chapter IS NULL",
      )
      .all(uid) as Array<{ object: string; source: string }>;
    expect(validRows.length).toBe(2);

    const card = ctx.db
      .prepare("SELECT card_json FROM character_cards WHERE novel_id='n1' AND character_uid=?")
      .get(uid) as { card_json: string };
    expect(JSON.parse(card.card_json).dimensions.cultivation_level.value).toBe("筑基");
  });

  it("b. endorse 夹带无关字段（dimension/value）：handler 按 action 分支天然忽略，结果仍正确", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "苏见" } }, ctx);

    const extractedId = insertFact(ctx, uid, { object: "筑基", from_chapter: 5 });
    const countBefore = (ctx.db.prepare("SELECT COUNT(*) AS c FROM facts").get() as { c: number }).c;

    const result = (await novelSubmitAuthoredState(
      {
        payload: {
          character_uid: uid,
          action: "endorse",
          target_fact_id: extractedId,
          // schema additionalProperties:false 但 dimension/value 本就是已声明属性，ajv 放行；
          // endorse 分支只读 target_fact_id，理应忽略这两个无关字段
          dimension: "cultivation_level",
          value: "金丹",
        },
      },
      ctx,
    )) as { ok: boolean; fact_id: string };

    expect(result.ok).toBe(true);
    const row = ctx.db.prepare("SELECT source, object FROM facts WHERE id=?").get(extractedId) as {
      source: string;
      object: string;
    };
    expect(row.source).toBe("authored");
    expect(row.object).toBe("筑基"); // 未被无关的 value="金丹" 篡改
    const countAfter = (ctx.db.prepare("SELECT COUNT(*) AS c FROM facts").get() as { c: number }).c;
    expect(countAfter).toBe(countBefore); // 无新行插入
  });

  it("C1a. retract 恢复被 target 失效的受害行：练气@0 被抽取筑基@7 顶掉 → retract 筑基 → 练气复活", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    const oldId = (ctx.db.prepare("SELECT id FROM facts WHERE subject_character_uid=? AND object='练气'").get(uid) as { id: string }).id;

    // 模拟抽取管线：筑基@7 顶掉练气（练气被判定失效，invalidated_by 指向筑基行）
    const extractedId = insertFact(ctx, uid, { object: "筑基", from_chapter: 7, source: "extracted" });
    ctx.db.prepare("UPDATE facts SET invalidated_at_chapter=7, invalidated_by=? WHERE id=?").run(extractedId, oldId);

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "retract", target_fact_id: extractedId } },
      ctx,
    )) as { ok: boolean };
    expect(result.ok).toBe(true);

    const revived = ctx.db
      .prepare("SELECT invalidated_at_chapter, invalidated_by FROM facts WHERE id=?")
      .get(oldId) as { invalidated_at_chapter: number | null; invalidated_by: string | null };
    expect(revived.invalidated_at_chapter).toBeNull();
    expect(revived.invalidated_by).toBeNull();
  });

  it("C1b. correct 仅改值（newEvent===targetEvent）：取代关系由新行继承，受害行不复活（复核 N1，取代原「统一复活」预期）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    const oldId = (ctx.db.prepare("SELECT id FROM facts WHERE subject_character_uid=? AND object='练气'").get(uid) as { id: string }).id;
    const extractedId = insertFact(ctx, uid, { object: "筑基", from_chapter: 7, source: "extracted" });
    ctx.db.prepare("UPDATE facts SET invalidated_at_chapter=7, invalidated_by=? WHERE id=?").run(extractedId, oldId);

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: extractedId, new_value: "金丹" } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(result.ok).toBe(true);

    // 仅改值：筑基→金丹 的 event 未变，筑基曾顶掉练气这件事仍成立——练气应保持失效，
    // 且 invalidated_by 须 re-point 到新行（金丹），而非停留在已被吃掉的旧 target（筑基）
    const oldRow = ctx.db
      .prepare("SELECT invalidated_at_chapter, invalidated_by FROM facts WHERE id=?")
      .get(oldId) as { invalidated_at_chapter: number | null; invalidated_by: string | null };
    expect(oldRow.invalidated_at_chapter).toBe(7);
    expect(oldRow.invalidated_by).toBe(result.fact_id);

    // 维度不空洞：折叠仍能取到当前值（金丹）
    const folded = foldCharacterCard(ctx, uid, 100);
    expect(isEmptyFoldedCard(folded)).toBe(false);
  });

  it("I2. rollback 恢复 correct 造成的悬垂失效：新行后移生效章被删，原行须复活而非永久空洞", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    insertSummary(ctx, 20);
    const original = ctx.db
      .prepare("SELECT id FROM facts WHERE subject_character_uid=? AND object='练气'")
      .get(uid) as { id: string };

    // correct 把新行的生效章后移到 9（原发生章仍是 0）——旧行 invalidated_at_chapter 记的是原发生章 0
    const corrected = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: original.id, new_value: "筑基", new_event_chapter: 9 } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(corrected.ok).toBe(true);

    // 回滚到第 8 章：新行 from_chapter=9≥8 被删；旧行 invalidated_at_chapter=0<8，不满足既有步骤 3
    // 的恢复阈值——若无本次修复，旧行会永久失效、新行也已删除，形成事实空洞
    await novelRollbackChapter({ chapter: 8 }, ctx);

    const survivingNew = ctx.db.prepare("SELECT id FROM facts WHERE id=?").get(corrected.fact_id);
    expect(survivingNew).toBeUndefined();

    const restored = ctx.db
      .prepare("SELECT invalidated_at_chapter, invalidated_by FROM facts WHERE id=?")
      .get(original.id) as { invalidated_at_chapter: number | null; invalidated_by: string | null } | undefined;
    expect(restored).toBeDefined();
    expect(restored!.invalidated_at_chapter).toBeNull();
    expect(restored!.invalidated_by).toBeNull();
  });

  it("I3. 关系事实（subject_character_b_uid 非空）不许经本工具改：correct/retract/endorse 均 ok:false", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    const otherUid = randomUUID();
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "苏见" } }, ctx);

    const relId = insertFact(ctx, uid, {
      predicate: "relationship",
      object: "师徒",
      from_chapter: 3,
      subject_character_b_uid: otherUid,
    });

    for (const action of ["correct", "retract", "endorse"] as const) {
      const payload: Record<string, unknown> = { character_uid: uid, action, target_fact_id: relId };
      if (action === "correct") payload.new_value = "仇敌";
      const result = (await novelSubmitAuthoredState({ payload }, ctx)) as {
        ok: boolean;
        errors: Array<{ hint: string }>;
      };
      expect(result.ok).toBe(false);
      expect(result.errors[0].hint).toContain("关系");
    }
  });

  it("I4. correct new_value 越值域拒绝（enum 维度）；free 维度不受限", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      {
        payload: {
          character_uid: uid,
          name: "苏见",
          initial_states: [
            { dimension: "cultivation_level", value: "练气" },
            { dimension: "inventory", value: "短刀" },
          ],
        },
      },
      ctx,
    );
    const enumTarget = ctx.db
      .prepare("SELECT id FROM facts WHERE subject_character_uid=? AND object='练气'")
      .get(uid) as { id: string };

    const bad = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: enumTarget.id, new_value: "元婴" } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(bad.ok).toBe(false);
    expect(bad.errors[0].hint).toContain("词表");

    const freeTarget = ctx.db
      .prepare("SELECT id FROM facts WHERE subject_character_uid=? AND object='短刀'")
      .get(uid) as { id: string };
    const okFree = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: freeTarget.id, new_value: "随便什么新物品" } },
      ctx,
    )) as { ok: boolean };
    expect(okFree.ok).toBe(true);
  });

  it("I5. retract 唯一记录后卡行被删除（不留空卡）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    const target = ctx.db
      .prepare("SELECT id FROM facts WHERE subject_character_uid=? AND object='练气'")
      .get(uid) as { id: string };

    const cardBefore = ctx.db.prepare("SELECT 1 FROM character_cards WHERE novel_id='n1' AND character_uid=?").get(uid);
    expect(cardBefore).toBeTruthy();

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "retract", target_fact_id: target.id } },
      ctx,
    )) as { ok: boolean };
    expect(result.ok).toBe(true);

    const cardAfter = ctx.db.prepare("SELECT 1 FROM character_cards WHERE novel_id='n1' AND character_uid=?").get(uid);
    expect(cardAfter).toBeUndefined();
  });

  it("I6. retract 后同值同生效章 set_current 重做：dup 门放行从未生效行，新行有效、卡面恢复（终审 I1）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    insertSummary(ctx, 10);

    const first = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "筑基", effective_chapter: 5 } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(first.ok).toBe(true);

    // 误操作 retract：筑基被打成「从未生效」（invalidated_at_chapter = 自身 event，见 retract 语义）
    const retracted = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "retract", target_fact_id: first.fact_id } },
      ctx,
    )) as { ok: boolean };
    expect(retracted.ok).toBe(true);

    // 同值同生效章重做：修复前会被 dup 门误判为「已记录过」而 skipped:true，无恢复路径
    const redo = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "筑基", effective_chapter: 5 } },
      ctx,
    )) as { ok: boolean; skipped?: boolean; fact_id: string };
    expect(redo.skipped).not.toBe(true);
    expect(redo.ok).toBe(true);
    expect(redo.fact_id).toBeTruthy();
    expect(redo.fact_id).not.toBe(first.fact_id);

    const newRow = ctx.db
      .prepare("SELECT invalidated_at_chapter, object FROM facts WHERE id=?")
      .get(redo.fact_id) as { invalidated_at_chapter: number | null; object: string };
    expect(newRow.invalidated_at_chapter).toBeNull();
    expect(newRow.object).toBe("筑基");

    const card = ctx.db
      .prepare("SELECT card_json FROM character_cards WHERE novel_id='n1' AND character_uid=?")
      .get(uid) as { card_json: string };
    expect(JSON.parse(card.card_json).dimensions.cultivation_level.value).toBe("筑基");
  });

  it("M6. many 维度拒绝 operation=set（对称门）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "苏见" } }, ctx);

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "inventory", operation: "set", value: "短刀", effective_chapter: 1 } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(result.ok).toBe(false);
    expect(result.errors[0].hint).toContain("add/remove");
  });

  it("M7. expected_current_value 乐观锁按卡面口径（asOf=cardAsOf），未来生效行不误判为当前值", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    insertSummary(ctx, 5); // cardAsOf = 5

    // 未来生效的 authored 钦定（event=10>cardAsOf=5）：仍是「有效行」但不该是卡面当前值
    const future = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "金丹", effective_chapter: 10 } },
      ctx,
    )) as { ok: boolean };
    expect(future.ok).toBe(true);

    // 按卡面当前值（练气，asOf=5）提交乐观锁应通过，不应被 dimRows[0]（未来的金丹）误拒
    const result = (await novelSubmitAuthoredState(
      {
        payload: {
          character_uid: uid,
          action: "set_current",
          dimension: "cultivation_level",
          value: "筑基",
          effective_chapter: 3,
          expected_current_value: "练气",
        },
      },
      ctx,
    )) as { ok: boolean; errors?: Array<{ hint: string }> };
    expect(result.ok).toBe(true);
  });

  it("M8. backfill 拒绝 operation=set/remove（恒 add 语义）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      {
        payload: {
          character_uid: uid,
          name: "苏见",
          initial_states: [
            { dimension: "cultivation_level", value: "练气" },
            { dimension: "inventory", value: "短刀" },
          ],
        },
      },
      ctx,
    );

    const setResult = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "backfill", dimension: "cultivation_level", operation: "set", value: "筑基", effective_chapter: 2 } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(setResult.ok).toBe(false);
    expect(setResult.errors[0].hint).toContain("set/remove");

    const removeResult = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "backfill", dimension: "inventory", operation: "remove", value: "短刀", effective_chapter: 2 } },
      ctx,
    )) as { ok: boolean };
    expect(removeResult.ok).toBe(false);

    // remove 被拒绝，短刀仍应有效未被误删
    const stillValid = ctx.db
      .prepare("SELECT invalidated_at_chapter FROM facts WHERE subject_character_uid=? AND object='短刀'")
      .get(uid) as { invalidated_at_chapter: number | null };
    expect(stillValid.invalidated_at_chapter).toBeNull();
  });

  it("M9. endorse 的 UPDATE+refresh 包进同一事务", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "苏见" } }, ctx);
    const extractedId = insertFact(ctx, uid, { object: "筑基", from_chapter: 5 });
    insertSummary(ctx, 5); // cardAsOf 须 ≥5，否则该 fact 的 event_chapter 折不进卡（不属于本条待验证行为）

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "endorse", target_fact_id: extractedId } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(result.ok).toBe(true);

    // source 落盘与卡刷新在同一次调用内一并完成（事务化的可观察结果：两者同时成立，不存在只有
    // source 翻转而卡未跟着刷新的半提交态）
    const row = ctx.db.prepare("SELECT source FROM facts WHERE id=?").get(extractedId) as { source: string };
    expect(row.source).toBe("authored");
    const card = ctx.db
      .prepare("SELECT card_json FROM character_cards WHERE novel_id='n1' AND character_uid=?")
      .get(uid) as { card_json: string };
    expect(JSON.parse(card.card_json).dimensions.cultivation_level.value).toBe("筑基");
  });

  it("N1a. many 维度 correct 仅改值不误复活受害行：短刀被灵剑顶掉 → correct 仅改灵剑值 → 短刀仍失效、持有物折叠只含新值", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "苏见" } }, ctx);
    insertSummary(ctx, 7);

    const daggerId = insertFact(ctx, uid, { predicate: "possession", object: "短刀", from_chapter: 1, source: "extracted" });
    // 模拟抽取管线：灵剑@7 顶掉短刀（many 维度替换语义，短刀被判定失效、指向灵剑行）
    const swordId = insertFact(ctx, uid, { predicate: "possession", object: "灵剑", from_chapter: 7, source: "extracted" });
    ctx.db.prepare("UPDATE facts SET invalidated_at_chapter=7, invalidated_by=? WHERE id=?").run(swordId, daggerId);

    // 仅纠正灵剑的描述值（未传 new_event_chapter，newEvent===targetEvent），短刀被顶掉这件事本身
    // 并未被推翻——不该跟着复活混进持有物
    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: swordId, new_value: "寒霜灵剑" } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(result.ok).toBe(true);

    const daggerRow = ctx.db
      .prepare("SELECT invalidated_at_chapter, invalidated_by FROM facts WHERE id=?")
      .get(daggerId) as { invalidated_at_chapter: number | null; invalidated_by: string | null };
    expect(daggerRow.invalidated_at_chapter).toBe(7);
    expect(daggerRow.invalidated_by).toBe(result.fact_id);

    const folded = foldCharacterCard(ctx, uid, 100);
    expect(folded.dimensions.inventory?.values).toEqual(["寒霜灵剑"]);
  });

  it("F3a. correct 被自然顶替的行（练气@0 被筑基@8 顶掉）：新行继承 invalidated_at=8/invalidated_by 原链", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    insertSummary(ctx, 20);

    const original = ctx.db
      .prepare("SELECT id FROM facts WHERE subject_character_uid=? AND object='练气'")
      .get(uid) as { id: string };

    // 筑基@8 自然顶替练气@0（一般的 set_current 演变，非 retract/correct）
    const advance = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "筑基", effective_chapter: 8 } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(advance.ok).toBe(true);

    const beforeCorrect = ctx.db
      .prepare("SELECT invalidated_at_chapter, invalidated_by FROM facts WHERE id=?")
      .get(original.id) as { invalidated_at_chapter: number; invalidated_by: string };
    expect(beforeCorrect.invalidated_at_chapter).toBe(8);
    expect(beforeCorrect.invalidated_by).toBe(advance.fact_id);

    // 纠错「练气」这段历史记录本身的值（如原文其实该阶段该叫「练气初期」）
    const corrected = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: original.id, new_value: "练气" } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(corrected.ok).toBe(true);

    const newRow = ctx.db
      .prepare("SELECT invalidated_at_chapter, invalidated_by FROM facts WHERE id=?")
      .get(corrected.fact_id) as { invalidated_at_chapter: number; invalidated_by: string };
    expect(newRow.invalidated_at_chapter).toBe(8);
    expect(newRow.invalidated_by).toBe(advance.fact_id);

    // asOf=5（在纠错行生效点与其继承的顶替点之间）折叠出纠错后的新值
    const foldedMid = foldCharacterCard(ctx, uid, 5);
    expect(foldedMid.dimensions.cultivation_level?.value).toBe("练气");
    // asOf=10（顶替点之后）仍是筑基
    const foldedLate = foldCharacterCard(ctx, uid, 10);
    expect(foldedLate.dimensions.cultivation_level?.value).toBe("筑基");
  });

  it("F3b. many 维度已失去（被 remove）的物品 correct 改值：新行不复活进当前卡", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "inventory", value: "短刀" }] } },
      ctx,
    );
    const daggerId = (
      ctx.db.prepare("SELECT id FROM facts WHERE subject_character_uid=? AND object='短刀'").get(uid) as { id: string }
    ).id;

    // 第 5 章物品被移除（自然顶替：invalidated_by=null，但 invalidated_at_chapter(5) > event(0)）
    const removed = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "inventory", operation: "remove", value: "短刀", effective_chapter: 5 } },
      ctx,
    )) as { ok: boolean };
    expect(removed.ok).toBe(true);

    // 纠正这件已失去物品的描述值（如原文其实叫「铁刀」不叫「短刀」）
    const corrected = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: daggerId, new_value: "铁刀" } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(corrected.ok).toBe(true);

    const newRow = ctx.db
      .prepare("SELECT invalidated_at_chapter, invalidated_by FROM facts WHERE id=?")
      .get(corrected.fact_id) as { invalidated_at_chapter: number | null; invalidated_by: string | null };
    expect(newRow.invalidated_at_chapter).toBe(5);
    expect(newRow.invalidated_by).toBeNull();

    // 不复活进当前卡：asOf=100（远晚于失去点）持有物中不含纠正后的值
    const folded = foldCharacterCard(ctx, uid, 100);
    expect(folded.dimensions.inventory?.values ?? []).not.toContain("铁刀");
    expect(folded.dimensions.inventory?.values ?? []).not.toContain("短刀");
  });

  it("F3c. 「从未生效」行（先 retract 再拿原 id correct）仍被拒", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    const original = ctx.db
      .prepare("SELECT id FROM facts WHERE subject_character_uid=? AND object='练气'")
      .get(uid) as { id: string };

    const retracted = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "retract", target_fact_id: original.id } },
      ctx,
    )) as { ok: boolean };
    expect(retracted.ok).toBe(true);

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: original.id, new_value: "筑基" } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(result.ok).toBe(false);
    expect(result.errors[0].hint).toContain("修正或撤回");
  });

  it("F4. 未来同值 authored 行不吞掉当下的 set_current 钦定（评审 F4）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    insertSummary(ctx, 20);

    // 已有金丹@10（仍生效），顺带把练气@0 顶掉
    const future = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "金丹", effective_chapter: 10 } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(future.ok).toBe(true);

    const practiceRow = ctx.db
      .prepare("SELECT invalidated_at_chapter FROM facts WHERE subject_character_uid=? AND object='练气'")
      .get(uid) as { invalidated_at_chapter: number | null };
    expect(practiceRow.invalidated_at_chapter).toBe(10);

    const before = (ctx.db.prepare("SELECT COUNT(*) AS c FROM facts").get() as { c: number }).c;

    // 作者对第 3 章钦定同值「金丹」：修复前会被未来的金丹@10（invalidated_at_chapter IS NULL）
    // 误判为「已记录过」而 skipped:true，静默吞掉这次钦定
    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "金丹", effective_chapter: 3 } },
      ctx,
    )) as { ok: boolean; skipped?: boolean; fact_id: string };
    expect(result.skipped).not.toBe(true);
    expect(result.ok).toBe(true);
    expect(result.fact_id).toBeTruthy();

    const after = (ctx.db.prepare("SELECT COUNT(*) AS c FROM facts").get() as { c: number }).c;
    expect(after).toBe(before + 1);

    // asOf=5：新插入的金丹@3 已生效，金丹@10 尚未到，折叠出金丹（经新行而非未来行）
    const folded = foldCharacterCard(ctx, uid, 5);
    expect(folded.dimensions.cultivation_level?.value).toBe("金丹");
  });

  it("F6. 同章双 authored backfill 同秒 created_at 平手：rowid 兜底=后插者胜（评审 F6）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "苏见" } }, ctx);

    const first = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "backfill", dimension: "cultivation_level", value: "筑基", effective_chapter: 5 } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(first.ok).toBe(true);

    const second = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "backfill", dimension: "cultivation_level", value: "金丹", effective_chapter: 5 } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(second.ok).toBe(true);

    // 制造同秒 created_at 平手（真实场景下同批次两次写入可能落在同一秒）
    ctx.db
      .prepare("UPDATE facts SET created_at=? WHERE id IN (?, ?)")
      .run("2026-01-01 00:00:00", first.fact_id, second.fact_id);

    const folded = foldCharacterCard(ctx, uid, 5);
    expect(folded.dimensions.cultivation_level?.value).toBe("金丹");
  });

  it("F7a. correct new_value 按 (predicate, new_value) 归属：脏历史值 correct 到词表外新值 → 拒绝（评审 F7）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "苏见" } }, ctx);
    // 脏历史值：不在任何值域内（如迁移遗留 / 抽取脏数据）
    const dirtyId = insertFact(ctx, uid, { predicate: "ability", object: "炼气期", from_chapter: 1 });

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: dirtyId, new_value: "化神" } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(result.ok).toBe(false);
    expect(result.errors[0].hint).toContain("词表");
  });

  it("F7b. 脏历史值 correct 到值域内值 → 过（评审 F7）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "苏见" } }, ctx);
    const dirtyId = insertFact(ctx, uid, { predicate: "ability", object: "炼气期", from_chapter: 1 });

    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: dirtyId, new_value: "筑基" } },
      ctx,
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("F7c. 共谓词双维度场景：从 A 维度值 correct 到 B 维度值不再被 A 值域误拒（评审 F7）", async () => {
    const ctx = makeCtx();
    await novelSubmitStateVocabulary(
      {
        payload: {
          dimensions: [
            { key: "mood", predicate: "status", display_name: "心情", cardinality: "one", value_type: "enum", values: ["开心", "难过"] },
            { key: "health", predicate: "status", display_name: "健康", cardinality: "one", value_type: "enum", values: ["健康", "生病"] },
          ],
        },
      },
      ctx,
    );
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "mood", value: "开心" }] } },
      ctx,
    );
    const target = ctx.db
      .prepare("SELECT id FROM facts WHERE subject_character_uid=? AND object='开心'")
      .get(uid) as { id: string };

    // 修复前：attributeFact 按旧值「开心」归属到 mood 维度，new_value「健康」不在 mood 值域内会被误拒
    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: target.id, new_value: "健康" } },
      ctx,
    )) as { ok: boolean; errors?: Array<{ hint: string }> };
    expect(result.ok).toBe(true);
  });

  it("13. mark_secret_known：secret 事实翻转/撤销/幂等；非 secret 谓词拒；不存在 factId 拒", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "苏见" } }, ctx);
    const secretId = insertFact(ctx, uid, { predicate: "secret", object: "身怀隐藏血脉", from_chapter: 3 });

    const mark = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "mark_secret_known", target_fact_id: secretId, known: true } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(mark.ok).toBe(true);
    expect(mark.fact_id).toBe(secretId);
    const marked = ctx.db.prepare("SELECT secret_known, source FROM facts WHERE id=?").get(secretId) as {
      secret_known: number; source: string;
    };
    expect(marked.secret_known).toBe(1);
    expect(marked.source).toBe("extracted"); // 打标不改来源

    // 撤销
    const unmark = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "mark_secret_known", target_fact_id: secretId, known: false } },
      ctx,
    )) as { ok: boolean };
    expect(unmark.ok).toBe(true);
    expect((ctx.db.prepare("SELECT secret_known FROM facts WHERE id=?").get(secretId) as { secret_known: number }).secret_known).toBe(0);

    // 同值幂等：ok 且不报错
    const again = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "mark_secret_known", target_fact_id: secretId, known: false } },
      ctx,
    )) as { ok: boolean };
    expect(again.ok).toBe(true);

    // 非 secret 谓词拒
    const abilityId = insertFact(ctx, uid, { object: "筑基", from_chapter: 5 });
    const wrongPredicate = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "mark_secret_known", target_fact_id: abilityId, known: true } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(wrongPredicate.ok).toBe(false);
    expect(wrongPredicate.errors[0].hint).toContain("secret");

    // 不存在 factId 拒
    const missing = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "mark_secret_known", target_fact_id: "no-such-id", known: true } },
      ctx,
    )) as { ok: boolean };
    expect(missing.ok).toBe(false);
  });

  it("14. set_current 顺手声明 secret_known；非 secret 维度声明拒；correct 顶替行继承标记", async () => {
    const ctx = makeCtx();
    // 参照 submitVocab 的 payload 结构提交词表，追加一个 secret 维度：
    // { key: "hidden_secret", predicate: "secret", display_name: "秘密", cardinality: "many", value_type: "free" }
    await novelSubmitStateVocabulary(
      {
        payload: {
          dimensions: [
            { key: "cultivation_level", predicate: "ability", display_name: "境界", cardinality: "one", value_type: "enum", values: ["练气", "筑基", "金丹"] },
            { key: "inventory", predicate: "possession", display_name: "持有物", cardinality: "many", value_type: "free" },
            { key: "hidden_secret", predicate: "secret", display_name: "秘密", cardinality: "many", value_type: "free" },
          ],
        },
      },
      ctx,
    );
    const uid = randomUUID();
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "苏见" } }, ctx);
    insertSummary(ctx, 6);

    const submit = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "hidden_secret", operation: "add", value: "皇室血脉", effective_chapter: 6, secret_known: true } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(submit.ok).toBe(true);
    const row = ctx.db.prepare("SELECT secret_known, predicate FROM facts WHERE id=?").get(submit.fact_id) as {
      secret_known: number; predicate: string;
    };
    expect(row.predicate).toBe("secret");
    expect(row.secret_known).toBe(1);

    // 非 secret 维度带 secret_known → 拒（fail-loud）
    const wrongDim = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "筑基", effective_chapter: 6, secret_known: true } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(wrongDim.ok).toBe(false);
    expect(wrongDim.errors[0].hint).toContain("secret");

    // correct 顶替行继承标记
    const corrected = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: submit.fact_id, new_value: "前朝皇室血脉" } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(corrected.ok).toBe(true);
    expect((ctx.db.prepare("SELECT secret_known FROM facts WHERE id=?").get(corrected.fact_id) as { secret_known: number }).secret_known).toBe(1);
  });

  it("15. 条件禁止：known 仅 mark_secret_known 可携带、secret_known 仅 set_current/backfill 可携带，误带即拒并返回 hint", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    insertSummary(ctx, 6);
    const factId = (ctx.db.prepare("SELECT id FROM facts WHERE subject_character_uid=?").get(uid) as { id: string }).id;

    type FailResult = { ok: boolean; errors: Array<{ field: string; hint: string }> };
    const expectForbidden = (result: FailResult, field: string) => {
      expect(result.ok).toBe(false);
      const item = result.errors.find((error) => error.field === field);
      expect(item).toBeTruthy();
      expect(item!.hint).toContain(field);
      expect(item!.hint).toContain("不适用于本次提交的 action");
    };

    // 其余字段全部合法（不带误带字段即可通过），确保被拒的唯一原因是条件禁止
    const forbiddenSecretKnown = [
      { character_uid: uid, action: "endorse", target_fact_id: factId, secret_known: true },
      { character_uid: uid, action: "retract", target_fact_id: factId, secret_known: true },
      { character_uid: uid, action: "correct", target_fact_id: factId, new_value: "筑基", secret_known: true },
      { character_uid: uid, action: "mark_secret_known", target_fact_id: factId, known: true, secret_known: true },
    ];
    for (const payload of forbiddenSecretKnown) {
      expectForbidden((await novelSubmitAuthoredState({ payload }, ctx)) as FailResult, "secret_known");
    }

    const forbiddenKnown = [
      { character_uid: uid, action: "set_current", dimension: "cultivation_level", value: "筑基", effective_chapter: 6, known: true },
      { character_uid: uid, action: "backfill", dimension: "inventory", value: "短刀", effective_chapter: 3, known: true },
      { character_uid: uid, action: "endorse", target_fact_id: factId, known: true },
    ];
    for (const payload of forbiddenKnown) {
      expectForbidden((await novelSubmitAuthoredState({ payload }, ctx)) as FailResult, "known");
    }

    // 对照组：合法组合不受条件禁止影响（mark_secret_known 带 known 走到语义层，
    // 非 secret 谓词被 handler 拒而非 schema 拒——错误锚在 target_fact_id 而非 known）
    const legit = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "mark_secret_known", target_fact_id: factId, known: true } },
      ctx,
    )) as { ok: boolean; errors: Array<{ field: string }> };
    expect(legit.ok).toBe(false);
    expect(legit.errors[0].field).toBe("target_fact_id");
  });

  it("N1b. correct 改发生章路径回归：newEvent!==targetEvent 时受害行仍复活（维持既有 C1 语义）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = randomUUID();
    await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    );
    insertSummary(ctx, 20);
    const oldId = (ctx.db.prepare("SELECT id FROM facts WHERE subject_character_uid=? AND object='练气'").get(uid) as { id: string }).id;
    const extractedId = insertFact(ctx, uid, { object: "筑基", from_chapter: 7, source: "extracted" });
    ctx.db.prepare("UPDATE facts SET invalidated_at_chapter=7, invalidated_by=? WHERE id=?").run(extractedId, oldId);

    // 改发生章：取代点本身在时间线上挪动，target 原先的取代关系不再原样成立 → 维持复活
    const result = (await novelSubmitAuthoredState(
      { payload: { character_uid: uid, action: "correct", target_fact_id: extractedId, new_value: "金丹", new_event_chapter: 9 } },
      ctx,
    )) as { ok: boolean; fact_id: string };
    expect(result.ok).toBe(true);

    const revived = ctx.db
      .prepare("SELECT invalidated_at_chapter, invalidated_by FROM facts WHERE id=?")
      .get(oldId) as { invalidated_at_chapter: number | null; invalidated_by: string | null };
    expect(revived.invalidated_at_chapter).toBeNull();
    expect(revived.invalidated_by).toBeNull();
  });
});
