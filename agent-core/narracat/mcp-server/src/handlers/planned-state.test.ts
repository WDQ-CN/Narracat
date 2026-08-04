import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../migrate.js";
import {
  novelCheckStateDelivery,
  novelResolvePlannedState,
  novelUpdateChapterStateChanges,
  mirrorChapterPlannedState,
} from "./planned-state.js";
import { checkStateChanges } from "./validators.js";
import type { ChapterOutlineItem } from "./validators.js";
import type { ToolContext } from "../types.js";

const UID = "11111111-1111-4111-8111-111111111111";

const VOCAB = {
  dimensions: [
    {
      key: "cultivation_level",
      predicate: "ability",
      display_name: "境界",
      cardinality: "one",
      value_type: "enum",
      values: ["练气", "筑基", "金丹"],
    },
    { key: "inventory", predicate: "possession", display_name: "持有物", cardinality: "many", value_type: "free" },
    // 与 cultivation_level 共用谓词的 free 维度（归属一致性回归用：enum 值域优先认领）
    { key: "skill", predicate: "ability", display_name: "技能", cardinality: "many", value_type: "free" },
  ],
};

let cleanupPaths: string[] = [];
afterEach(() => {
  for (const p of cleanupPaths) rmSync(p, { recursive: true, force: true });
  cleanupPaths = [];
});

function makeCtx(withVocab = true): ToolContext {
  const root = mkdtempSync(join(tmpdir(), "planned-state-"));
  cleanupPaths.push(root);
  mkdirSync(join(root, "bible"), { recursive: true });
  if (withVocab) {
    writeFileSync(join(root, "bible", "state-vocabulary.json"), JSON.stringify(VOCAB));
  }
  const db = new Database(":memory:");
  initSchema(db);
  return { novelId: "n1", db, projectRoot: root } as ToolContext;
}

function insertPlan(
  ctx: ToolContext,
  fields: Partial<{
    chapter: number;
    dimension: string;
    operation: string;
    value: string;
    status: string;
  }> = {},
): string {
  const id = randomUUID();
  ctx.db
    .prepare(
      `INSERT INTO planned_state_changes
         (id, novel_id, chapter, character_uid, character_name, dimension, operation, value, reason, status)
       VALUES (?, 'n1', ?, ?, '林晚', ?, ?, ?, '剧情需要', ?)`,
    )
    .run(
      id,
      fields.chapter ?? 5,
      UID,
      fields.dimension ?? "cultivation_level",
      fields.operation ?? "set",
      fields.value ?? "筑基",
      fields.status ?? "planned",
    );
  return id;
}

function insertFact(
  ctx: ToolContext,
  fields: Partial<{ predicate: string; object: string; chapter: number; invalidatedAt: number | null }> = {},
): void {
  ctx.db
    .prepare(
      `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, sector, from_chapter, event_chapter, invalidated_at_chapter)
       VALUES (?, 'n1', '林晚', ?, ?, ?, 'semantic', ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      UID,
      fields.predicate ?? "ability",
      fields.object ?? "筑基",
      fields.chapter ?? 5,
      fields.chapter ?? 5,
      fields.invalidatedAt ?? null,
    );
}

describe("novel_check_state_delivery", () => {
  it("set 计划命中本章事实 → 落 delivered 并进 delivered 报告", async () => {
    const ctx = makeCtx();
    const planId = insertPlan(ctx);
    insertFact(ctx);
    const result = (await novelCheckStateDelivery({ chapter: 5 }, ctx)) as Record<string, any>;
    expect(result.ok).toBe(true);
    expect(result.delivered).toHaveLength(1);
    expect(result.delivered[0].dimension).toBe("境界");
    expect(result.undelivered).toHaveLength(0);
    const row = ctx.db.prepare("SELECT status FROM planned_state_changes WHERE id = ?").get(planId) as {
      status: string;
    };
    expect(row.status).toBe("delivered");
  });

  it("remove 计划：该值事实在本章被失效 → 命中", async () => {
    const ctx = makeCtx();
    insertPlan(ctx, { dimension: "inventory", operation: "remove", value: "短刀" });
    insertFact(ctx, { predicate: "possession", object: "短刀", chapter: 2, invalidatedAt: 5 });
    const result = (await novelCheckStateDelivery({ chapter: 5 }, ctx)) as Record<string, any>;
    expect(result.delivered).toHaveLength(1);
  });

  it("未命中（事实在别章/值不同）→ 保持 planned 并出 undelivered 报告", async () => {
    const ctx = makeCtx();
    const planId = insertPlan(ctx);
    insertFact(ctx, { chapter: 6 }); // 晚一章才发生 → 本章未兑现
    const result = (await novelCheckStateDelivery({ chapter: 5 }, ctx)) as Record<string, any>;
    expect(result.delivered).toHaveLength(0);
    expect(result.undelivered).toHaveLength(1);
    expect(result.undelivered[0].id).toBe(planId);
    const row = ctx.db.prepare("SELECT status FROM planned_state_changes WHERE id = ?").get(planId) as {
      status: string;
    };
    expect(row.status).toBe("planned");
  });

  it("维度已不在词表 → 按未兑现报告并注明，不静默吞", async () => {
    const ctx = makeCtx();
    insertPlan(ctx, { dimension: "ghost_dimension" });
    const result = (await novelCheckStateDelivery({ chapter: 5 }, ctx)) as Record<string, any>;
    expect(result.undelivered[0].note).toContain("已不在词表");
  });

  it("本章无计划行安静返回；非法章号拒绝", async () => {
    const ctx = makeCtx();
    const empty = (await novelCheckStateDelivery({ chapter: 9 }, ctx)) as Record<string, any>;
    expect(empty.ok).toBe(true);
    expect(empty.planned_total).toBe(0);
    const bad = (await novelCheckStateDelivery({ chapter: 0 }, ctx)) as Record<string, any>;
    expect(bad.ok).toBe(false);
  });

  it("已处置行（cancelled）不参与比对", async () => {
    const ctx = makeCtx();
    insertPlan(ctx, { status: "cancelled" });
    insertFact(ctx);
    const result = (await novelCheckStateDelivery({ chapter: 5 }, ctx)) as Record<string, any>;
    expect(result.planned_total).toBe(0);
  });

  it("「从未生效」行不算兑现：本章事实已被 retract/correct 打掉（invalidated_at<=生效章）→ 未兑现", async () => {
    const ctx = makeCtx();
    const planId = insertPlan(ctx);
    insertFact(ctx, { chapter: 5, invalidatedAt: 5 });
    const result = (await novelCheckStateDelivery({ chapter: 5 }, ctx)) as Record<string, any>;
    expect(result.delivered).toHaveLength(0);
    expect(result.undelivered.map((u: any) => u.id)).toEqual([planId]);
  });

  it("自然顶替行仍算兑现：本章生效、晚些章被更新值顶掉（invalidated_at>生效章）→ 已兑现", async () => {
    const ctx = makeCtx();
    insertPlan(ctx);
    insertFact(ctx, { chapter: 5, invalidatedAt: 8 });
    const result = (await novelCheckStateDelivery({ chapter: 5 }, ctx)) as Record<string, any>;
    expect(result.delivered).toHaveLength(1);
  });

  it("remove 计划：本章「从未生效」行（生效章=失效章）不算失去痕迹 → 未兑现", async () => {
    const ctx = makeCtx();
    insertPlan(ctx, { dimension: "inventory", operation: "remove", value: "短刀" });
    insertFact(ctx, { predicate: "possession", object: "短刀", chapter: 5, invalidatedAt: 5 });
    const result = (await novelCheckStateDelivery({ chapter: 5 }, ctx)) as Record<string, any>;
    expect(result.delivered).toHaveLength(0);
    expect(result.undelivered).toHaveLength(1);
  });

  it("归属一致性：free 维度计划排了 enum 值域内的值 → 不被同谓词 enum 事实销账，报未兑现并注明", async () => {
    const ctx = makeCtx();
    // skill(free) 与 cultivation_level(enum) 共用谓词 ability；筑基 归属 enum 维度
    insertPlan(ctx, { dimension: "skill", operation: "add", value: "筑基" });
    insertFact(ctx, { predicate: "ability", object: "筑基", chapter: 5 });
    const result = (await novelCheckStateDelivery({ chapter: 5 }, ctx)) as Record<string, any>;
    expect(result.delivered).toHaveLength(0);
    expect(result.undelivered[0].note).toContain("归属");
  });
});

describe("novel_resolve_planned_state", () => {
  it("defer：原行标 deferred+目标章、目标章插新 planned 行", async () => {
    const ctx = makeCtx();
    seedChapterOutline(ctx, 8, []);
    const planId = insertPlan(ctx);
    const result = (await novelResolvePlannedState(
      { payload: { id: planId, action: "defer", to_chapter: 8 } },
      ctx,
    )) as Record<string, any>;
    expect(result.ok).toBe(true);
    const original = ctx.db
      .prepare("SELECT status, deferred_to_chapter FROM planned_state_changes WHERE id = ?")
      .get(planId) as { status: string; deferred_to_chapter: number };
    expect(original.status).toBe("deferred");
    expect(original.deferred_to_chapter).toBe(8);
    const moved = ctx.db
      .prepare("SELECT chapter, status FROM planned_state_changes WHERE id = ?")
      .get(result.new_id) as { chapter: number; status: string };
    expect(moved.chapter).toBe(8);
    expect(moved.status).toBe("planned");
  });

  it("defer 目标章已有同键待兑现行 → 不重插，指认既有行", async () => {
    const ctx = makeCtx();
    seedChapterOutline(ctx, 8, []);
    const planId = insertPlan(ctx, { chapter: 5 });
    const existingId = insertPlan(ctx, { chapter: 8 });
    const result = (await novelResolvePlannedState(
      { payload: { id: planId, action: "defer", to_chapter: 8 } },
      ctx,
    )) as Record<string, any>;
    expect(result.new_id).toBe(existingId);
    const count = ctx.db
      .prepare("SELECT COUNT(*) AS c FROM planned_state_changes WHERE novel_id = 'n1' AND chapter = 8")
      .get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("defer 目标章同键行是终态（cancelled）→ 仍新建 planned 行，不假成功", async () => {
    const ctx = makeCtx();
    seedChapterOutline(ctx, 8, []);
    const planId = insertPlan(ctx, { chapter: 5 });
    const cancelledId = insertPlan(ctx, { chapter: 8, status: "cancelled" });
    const result = (await novelResolvePlannedState(
      { payload: { id: planId, action: "defer", to_chapter: 8 } },
      ctx,
    )) as Record<string, any>;
    expect(result.ok).toBe(true);
    expect(result.new_id).not.toBe(cancelledId);
    const planned = ctx.db
      .prepare(
        "SELECT COUNT(*) AS c FROM planned_state_changes WHERE novel_id = 'n1' AND chapter = 8 AND status = 'planned'",
      )
      .get() as { c: number };
    expect(planned.c).toBe(1);
  });

  it("defer 缺 to_chapter / 目标章不大于原章 → 拒绝", async () => {
    const ctx = makeCtx();
    const planId = insertPlan(ctx, { chapter: 5 });
    const missing = (await novelResolvePlannedState({ payload: { id: planId, action: "defer" } }, ctx)) as Record<string, any>;
    expect(missing.ok).toBe(false);
    const backward = (await novelResolvePlannedState(
      { payload: { id: planId, action: "defer", to_chapter: 5 } },
      ctx,
    )) as Record<string, any>;
    expect(backward.ok).toBe(false);
  });

  it("cancel / acknowledge / mark_delivered 三态迁移", async () => {
    const ctx = makeCtx();
    for (const [action, status] of [
      ["cancel", "cancelled"],
      ["acknowledge", "acknowledged"],
      ["mark_delivered", "delivered"],
    ] as const) {
      const planId = insertPlan(ctx);
      const result = (await novelResolvePlannedState({ payload: { id: planId, action } }, ctx)) as Record<string, any>;
      expect(result.ok).toBe(true);
      const row = ctx.db.prepare("SELECT status FROM planned_state_changes WHERE id = ?").get(planId) as {
        status: string;
      };
      expect(row.status).toBe(status);
    }
  });

  it("已处置行再处置 / 不存在的行 / 非法 action → 拒绝并给 hint", async () => {
    const ctx = makeCtx();
    const planId = insertPlan(ctx, { status: "delivered" });
    const resolved = (await novelResolvePlannedState({ payload: { id: planId, action: "cancel" } }, ctx)) as Record<string, any>;
    expect(resolved.ok).toBe(false);
    expect(JSON.stringify(resolved.errors)).toContain("已处置");
    const missing = (await novelResolvePlannedState({ payload: { id: "nope", action: "cancel" } }, ctx)) as Record<string, any>;
    expect(missing.ok).toBe(false);
    const badAction = (await novelResolvePlannedState({ payload: { id: planId, action: "explode" } }, ctx)) as Record<string, any>;
    expect(badAction.ok).toBe(false);
  });
});

describe("checkStateChanges（章纲计划语义门）", () => {
  const ch = (changes: unknown[]): ChapterOutlineItem =>
    ({ chapter: 5, state_changes: changes }) as unknown as ChapterOutlineItem;
  const base = { character: { character_uid: UID, name: "林晚" } };

  it("合法条目通过；空数组/无字段零错误", () => {
    expect(checkStateChanges([ch([{ ...base, dimension: "cultivation_level", value: "筑基" }])], VOCAB as never)).toEqual([]);
    expect(checkStateChanges([ch([])], VOCAB as never)).toEqual([]);
    expect(checkStateChanges([{ chapter: 1 } as never], VOCAB as never)).toEqual([]);
  });

  it("词表缺失但带 state_changes → 拒绝引导", () => {
    const errors = checkStateChanges([ch([{ ...base, dimension: "cultivation_level", value: "筑基" }])], null);
    expect(errors).toHaveLength(1);
    expect(errors[0].hint).toContain("词表");
  });

  it("归属不一致拒绝：free 维度排了 enum 值域内的值（该计划永远兑现不了）", () => {
    const errors = checkStateChanges(
      [ch([{ ...base, dimension: "skill", operation: "add", value: "筑基" }])],
      VOCAB as never,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].actual).toContain("cultivation_level");
    expect(errors[0].hint).toContain("改排到维度");
  });

  it("未知维度 / enum 值域外 / one+add / many+set 各自拒绝", () => {
    const errors = checkStateChanges(
      [
        ch([
          { ...base, dimension: "unknown_dim", value: "x" },
          { ...base, dimension: "cultivation_level", value: "元婴" },
          { ...base, dimension: "cultivation_level", operation: "add", value: "筑基" },
          { ...base, dimension: "inventory", operation: "set", value: "短刀" },
        ]),
      ],
      VOCAB as never,
    );
    expect(errors).toHaveLength(4);
    expect(errors[0].actual).toContain("unknown_dim");
    expect(errors[1].expected).toContain("值域");
    expect(errors[2].expected).toContain("单值维度");
    expect(errors[3].actual).toBe("set");
  });
});

function seedChapterOutline(ctx: ToolContext, chapter: number, stateChanges: unknown[] = []): string {
  const dir = join((ctx as { projectRoot: string }).projectRoot, "outline", "vol-01");
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, `ch-${String(chapter).padStart(3, "0")}.json`);
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        chapter,
        title: "试炼",
        positioning: "推进",
        beats: ["b1"],
        storyline_focus: [],
        characters: [{ character_uid: UID, name: "林晚" }],
        pov_character: { character_uid: UID, name: "林晚" },
        state_changes: stateChanges,
      },
      null,
      2,
    )}\n`,
  );
  return jsonPath;
}

const ENTRY = {
  character: { character_uid: UID, name: "林晚" },
  dimension: "cultivation_level",
  operation: "set",
  value: "筑基",
  reason: "突破",
};

describe("novelUpdateChapterStateChanges", () => {
  it("整段替换：json/md/计划表三处一致，终态行保留", async () => {
    const ctx = makeCtx();
    const jsonPath = seedChapterOutline(ctx, 5, []);
    insertPlan(ctx, { chapter: 5, value: "金丹", status: "cancelled" }); // 终态历史账
    const res = (await novelUpdateChapterStateChanges(
      { payload: { chapter: 5, state_changes: [ENTRY], expected_state_changes: [] } },
      ctx,
    )) as { ok: boolean };
    expect(res.ok).toBe(true);
    const json = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(json.state_changes).toEqual([ENTRY]);
    const md = readFileSync(jsonPath.replace(/\.json$/, ".md"), "utf-8");
    expect(md).toContain("## 本章状态变更");
    expect(md).toContain("筑基");
    const rows = ctx.db
      .prepare(`SELECT status, value FROM planned_state_changes WHERE chapter = 5 ORDER BY rowid`)
      .all() as Array<{ status: string; value: string }>;
    expect(rows).toEqual([
      { status: "cancelled", value: "金丹" },
      { status: "planned", value: "筑基" },
    ]);
  });

  it("同键终态行已存在（如 cancelled）时作者显式重加同键计划 → planned 行照常插入，终态行保留（Fix 3a，dedupe='planned-only'）", async () => {
    const ctx = makeCtx();
    const jsonPath = seedChapterOutline(ctx, 5, []);
    insertPlan(ctx, { chapter: 5, value: "筑基", status: "cancelled" }); // 同键（同 uid/维度/operation/value）终态行
    const res = (await novelUpdateChapterStateChanges(
      { payload: { chapter: 5, state_changes: [ENTRY], expected_state_changes: [] } }, // ENTRY 同为 cultivation_level/set/筑基
      ctx,
    )) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(JSON.parse(readFileSync(jsonPath, "utf-8")).state_changes).toEqual([ENTRY]);
    const rows = ctx.db
      .prepare(`SELECT status, value FROM planned_state_changes WHERE chapter = 5 ORDER BY rowid`)
      .all() as Array<{ status: string; value: string }>;
    // cancelled 历史行保留，新 planned 行照常插入（不因同键被 any-status 式防复活逻辑误拦）
    expect(rows).toEqual([
      { status: "cancelled", value: "筑基" },
      { status: "planned", value: "筑基" },
    ]);
  });

  it("CAS：expected 与磁盘不一致时拒绝且不落盘", async () => {
    const ctx = makeCtx();
    const jsonPath = seedChapterOutline(ctx, 5, [ENTRY]);
    const res = (await novelUpdateChapterStateChanges(
      { payload: { chapter: 5, state_changes: [], expected_state_changes: [] } }, // 磁盘上其实有 1 条
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(res.ok).toBe(false);
    expect(JSON.parse(readFileSync(jsonPath, "utf-8")).state_changes).toEqual([ENTRY]);
  });

  it("enum 值域外拒绝（复用 checkStateChanges 语义门）", async () => {
    const ctx = makeCtx();
    seedChapterOutline(ctx, 5, []);
    const res = (await novelUpdateChapterStateChanges(
      { payload: { chapter: 5, state_changes: [{ ...ENTRY, value: "元婴" }], expected_state_changes: [] } },
      ctx,
    )) as { ok: boolean };
    expect(res.ok).toBe(false);
  });

  it("旧格式（无 beats）章纲拒绝且不落盘：legacy 渲染不含状态变更节，放行会破坏三处一致", async () => {
    const ctx = makeCtx();
    const dir = join((ctx as { projectRoot: string }).projectRoot, "outline", "vol-01");
    mkdirSync(dir, { recursive: true });
    const jsonPath = join(dir, "ch-005.json");
    const legacy = {
      chapter: 5,
      title: "试炼",
      value_shift: "低谷到反击",
      emotional_stakes: "自证清白",
      dramatic_focus: "对峙",
      storyline_focus: [],
      pov_character: { character_uid: UID, name: "林晚" },
      scenes: [{ location: "宗门大殿", characters: [{ name: "林晚" }], pressure_point: "当众质疑" }],
    };
    const oldJson = `${JSON.stringify(legacy, null, 2)}\n`;
    writeFileSync(jsonPath, oldJson);
    const res = (await novelUpdateChapterStateChanges(
      { payload: { chapter: 5, state_changes: [ENTRY], expected_state_changes: [] } },
      ctx,
    )) as { ok: boolean; errors: Array<{ actual: string }> };
    expect(res.ok).toBe(false);
    expect(res.errors[0].actual).toContain("旧格式");
    expect(readFileSync(jsonPath, "utf-8")).toBe(oldJson); // json 未被改动
    const count = ctx.db
      .prepare(`SELECT COUNT(*) AS c FROM planned_state_changes WHERE chapter = 5`)
      .get() as { c: number };
    expect(count.c).toBe(0); // 计划表无新行
  });

  it("超 8 条拒绝；目标章无章纲拒绝", async () => {
    const ctx = makeCtx();
    seedChapterOutline(ctx, 5, []);
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...ENTRY, dimension: "inventory", operation: "add", value: `物${i}` }));
    expect(((await novelUpdateChapterStateChanges({ payload: { chapter: 5, state_changes: nine, expected_state_changes: [] } }, ctx)) as { ok: boolean }).ok).toBe(false);
    expect(((await novelUpdateChapterStateChanges({ payload: { chapter: 9, state_changes: [ENTRY], expected_state_changes: [] } }, ctx)) as { ok: boolean }).ok).toBe(false);
  });

  it("DB 镜像失败时补偿回写旧 json/md（文件先行+补偿，spec §3.4）", async () => {
    const ctx = makeCtx();
    const jsonPath = seedChapterOutline(ctx, 5, []);
    const oldJson = readFileSync(jsonPath, "utf-8");
    const realTransaction = ctx.db.transaction.bind(ctx.db);
    (ctx.db as { transaction: unknown }).transaction = () => {
      throw new Error("boom");
    };
    const res = (await novelUpdateChapterStateChanges(
      { payload: { chapter: 5, state_changes: [ENTRY], expected_state_changes: [] } },
      ctx,
    )) as { ok: boolean };
    (ctx.db as { transaction: unknown }).transaction = realTransaction;
    expect(res.ok).toBe(false);
    expect(readFileSync(jsonPath, "utf-8")).toBe(oldJson); // 已补偿回写
  });

  it("md 写入失败（mdPath 是目录，writeFile 抛 EISDIR）时同样补偿回写旧 json、不留新 planned 行（评审 P1）", async () => {
    const ctx = makeCtx();
    const jsonPath = seedChapterOutline(ctx, 5, []);
    const oldJson = readFileSync(jsonPath, "utf-8");
    const mdPath = jsonPath.replace(/\.json$/, ".md");
    mkdirSync(mdPath, { recursive: true }); // 让 writeFile(mdPath, ...) 必抛 EISDIR
    const res = (await novelUpdateChapterStateChanges(
      { payload: { chapter: 5, state_changes: [ENTRY], expected_state_changes: [] } },
      ctx,
    )) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(readFileSync(jsonPath, "utf-8")).toBe(oldJson); // json 已回滚为旧值
    const count = ctx.db
      .prepare(`SELECT COUNT(*) AS c FROM planned_state_changes WHERE chapter = 5`)
      .get() as { c: number };
    expect(count.c).toBe(0); // 计划表无新行（DB 从未写入或已随失败一并回滚）
  });
});

describe("defer 写穿目标章（P1-2）", () => {
  it("defer 后目标章 json 含该条目、md 含状态变更节；按新 json 重跑镜像后顺延行存活", async () => {
    const ctx = makeCtx();
    seedChapterOutline(ctx, 9, []);
    const id = insertPlan(ctx, { chapter: 5, value: "筑基" });
    const res = (await novelResolvePlannedState({ payload: { id, action: "defer", to_chapter: 9 } }, ctx)) as { ok: boolean };
    expect(res.ok).toBe(true);
    const target = JSON.parse(readFileSync(join((ctx as { projectRoot: string }).projectRoot, "outline", "vol-01", "ch-009.json"), "utf-8"));
    expect(target.state_changes).toHaveLength(1);
    expect(target.state_changes[0].value).toBe("筑基");
    const md = readFileSync(join((ctx as { projectRoot: string }).projectRoot, "outline", "vol-01", "ch-009.md"), "utf-8");
    expect(md).toContain("## 本章状态变更");
    // 模拟架构师重提交目标章：按 json 现值重跑镜像纪律——顺延行必须存活（同键跳过）
    const tx = ctx.db.transaction(() =>
      mirrorChapterPlannedState(ctx.db, "n1", 9, target.state_changes.map((sc: { character: { character_uid: string; name: string }; dimension: string; operation?: "set"|"add"|"remove"; value: string; reason?: string }) => ({
        character_uid: sc.character.character_uid,
        character_name: sc.character.name,
        dimension: sc.dimension,
        operation: sc.operation ?? "set",
        value: sc.value,
        reason: sc.reason ?? null,
      })), "any-status"),
    );
    tx();
    const survivors = ctx.db.prepare(`SELECT status FROM planned_state_changes WHERE chapter = 9`).all() as Array<{ status: string }>;
    expect(survivors).toEqual([{ status: "planned" }]);
  });

  it("目标章无章纲 → 拒绝且原行保持 planned", async () => {
    const ctx = makeCtx();
    const id = insertPlan(ctx, { chapter: 5 });
    const res = (await novelResolvePlannedState({ payload: { id, action: "defer", to_chapter: 9 } }, ctx)) as { ok: boolean };
    expect(res.ok).toBe(false);
    const row = ctx.db.prepare(`SELECT status FROM planned_state_changes WHERE id = ?`).get(id) as { status: string };
    expect(row.status).toBe("planned");
  });

  it("目标章计划已满 8 条 → 拒绝", async () => {
    const ctx = makeCtx();
    seedChapterOutline(ctx, 9, Array.from({ length: 8 }, (_, i) => ({ ...ENTRY, dimension: "inventory", operation: "add", value: `物${i}` })));
    const id = insertPlan(ctx, { chapter: 5 });
    const res = (await novelResolvePlannedState({ payload: { id, action: "defer", to_chapter: 9 } }, ctx)) as { ok: boolean };
    expect(res.ok).toBe(false);
  });

  it("同键条目已在目标章 json → 不重复追加，DB 也不重插（沿用既有去重）", async () => {
    const ctx = makeCtx();
    const jsonPath = seedChapterOutline(ctx, 9, [{ character: { character_uid: UID, name: "林晚" }, dimension: "cultivation_level", operation: "set", value: "筑基" }]);
    const id = insertPlan(ctx, { chapter: 5, value: "筑基" });
    const res = (await novelResolvePlannedState({ payload: { id, action: "defer", to_chapter: 9 } }, ctx)) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(JSON.parse(readFileSync(jsonPath, "utf-8")).state_changes).toHaveLength(1);
  });

  it("目标章 json 同维度同值但省略 operation（many 隐含 add）、defer 行是 remove → 非同键，须追加且带显式 operation", async () => {
    const ctx = makeCtx();
    // inventory 是 many/free：省略 operation 的条目按缺省解析规则隐含 add（获得复原丹）
    const jsonPath = seedChapterOutline(ctx, 9, [
      { character: { character_uid: UID, name: "林晚" }, dimension: "inventory", value: "复原丹" },
    ]);
    const id = insertPlan(ctx, { chapter: 5, dimension: "inventory", operation: "remove", value: "复原丹" });
    const res = (await novelResolvePlannedState({ payload: { id, action: "defer", to_chapter: 9 } }, ctx)) as { ok: boolean };
    expect(res.ok).toBe(true);
    // json 追加了 remove 条目（失去复原丹 ≠ 获得复原丹），且带显式 operation
    const changes = JSON.parse(readFileSync(jsonPath, "utf-8")).state_changes as Array<{ operation?: string; value: string }>;
    expect(changes).toHaveLength(2);
    expect(changes[1].operation).toBe("remove");
    expect(changes[1].value).toBe("复原丹");
    // DB 目标章新增 planned 行（json/DB 不分裂，重提交镜像重建不会吃掉顺延行）
    const planned = ctx.db
      .prepare(`SELECT COUNT(*) AS c FROM planned_state_changes WHERE chapter = 9 AND status = 'planned' AND operation = 'remove'`)
      .get() as { c: number };
    expect(planned.c).toBe(1);
  });

  it("defer md 写入失败（目标章 mdPath 是目录，EISDIR）→ 拒绝，目标章 json 回滚、原行仍 planned、目标章无新行（评审 P1）", async () => {
    const ctx = makeCtx();
    const jsonPath = seedChapterOutline(ctx, 9, []);
    const oldJson = readFileSync(jsonPath, "utf-8");
    const mdPath = jsonPath.replace(/\.json$/, ".md");
    mkdirSync(mdPath, { recursive: true }); // 让 writeFile(mdPath, ...) 必抛 EISDIR
    const id = insertPlan(ctx, { chapter: 5, value: "筑基" });
    const res = (await novelResolvePlannedState({ payload: { id, action: "defer", to_chapter: 9 } }, ctx)) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(readFileSync(jsonPath, "utf-8")).toBe(oldJson); // 目标章 json 已回滚
    const original = ctx.db.prepare(`SELECT status FROM planned_state_changes WHERE id = ?`).get(id) as { status: string };
    expect(original.status).toBe("planned"); // 原行未被标 deferred
    const count = ctx.db
      .prepare(`SELECT COUNT(*) AS c FROM planned_state_changes WHERE chapter = 9`)
      .get() as { c: number };
    expect(count.c).toBe(0); // 目标章无新插入行
  });

  it("目标章为旧格式（无 beats）章纲 → 拒绝且原行保持 planned（同款校验的 defer 语境变体）", async () => {
    const ctx = makeCtx();
    const dir = join((ctx as { projectRoot: string }).projectRoot, "outline", "vol-01");
    mkdirSync(dir, { recursive: true });
    const jsonPath = join(dir, "ch-009.json");
    const legacy = {
      chapter: 9,
      title: "试炼",
      value_shift: "低谷到反击",
      emotional_stakes: "自证清白",
      dramatic_focus: "对峙",
      storyline_focus: [],
      pov_character: { character_uid: UID, name: "林晚" },
      scenes: [{ location: "宗门大殿", characters: [{ name: "林晚" }], pressure_point: "当众质疑" }],
    };
    const oldJson = `${JSON.stringify(legacy, null, 2)}\n`;
    writeFileSync(jsonPath, oldJson);
    const id = insertPlan(ctx, { chapter: 5 });
    const res = (await novelResolvePlannedState({ payload: { id, action: "defer", to_chapter: 9 } }, ctx)) as {
      ok: boolean;
      errors: Array<{ actual: string }>;
    };
    expect(res.ok).toBe(false);
    expect(res.errors[0].actual).toContain("旧格式");
    expect(readFileSync(jsonPath, "utf-8")).toBe(oldJson); // json 未被改动
    const row = ctx.db.prepare(`SELECT status FROM planned_state_changes WHERE id = ?`).get(id) as { status: string };
    expect(row.status).toBe("planned");
  });
});
