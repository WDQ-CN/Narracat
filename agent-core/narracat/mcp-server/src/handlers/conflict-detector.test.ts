/**
 * 生成后冲突检测测试（纯规则 + handler 集成）
 *
 * 收窄后语义（真机校准）：设定漂移 / 关系矛盾只在「同一章 event 轴内 ≥2 互斥（非近重复）值」
 * 才报；跨章演变豁免、同章近重复归并、演变性谓词（status/injury/goal…）不参与设定漂移。
 *
 * 跑：cd mcp-server && npx vitest run src/handlers/conflict-detector.test.ts
 */
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import {
  detectConflicts,
  renderConflictReport,
  novelDetectConflicts,
  type ConflictFactRow,
} from "./conflict-detector.js";
import { initSchema } from "../migrate.js";
import type { ToolContext } from "../types.js";

function mk(
  id: string,
  opts: {
    subject?: string;
    uid?: string | null;
    bUid?: string | null;
    predicate: string;
    object: string;
    chapter: number;
    event?: number;
  },
): ConflictFactRow {
  return {
    id,
    subject: opts.subject ?? "苏铭",
    subject_character_uid: opts.uid ?? null,
    subject_character_b_uid: opts.bUid ?? null,
    predicate: opts.predicate,
    object: opts.object,
    from_chapter: opts.chapter,
    event_chapter: opts.event ?? opts.chapter,
  };
}

describe("detectConflicts — 同章互斥（收窄后）", () => {
  it("设定漂移：同章 location 2 互斥值 → 报", () => {
    const c = detectConflicts([
      mk("f1", { uid: "u1", predicate: "location", object: "在青云宗大殿", chapter: 5 }),
      mk("f2", { uid: "u1", predicate: "location", object: "在魔渊深处幽谷", chapter: 5 }),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0].type).toBe("state_divergence");
    expect(c[0].chapter).toBe(5);
  });

  it("跨章演变豁免：不同章 location → 不报", () => {
    const c = detectConflicts([
      mk("f1", { uid: "u1", predicate: "location", object: "在青云宗大殿", chapter: 3 }),
      mk("f2", { uid: "u1", predicate: "location", object: "在魔渊深处幽谷", chapter: 10 }),
    ]);
    expect(c).toHaveLength(0);
  });

  it("同章近重复归并：措辞略异的同一事实 → 不报", () => {
    const c = detectConflicts([
      mk("f1", { uid: "u1", predicate: "location", object: "前往清河镇的山路上", chapter: 8 }),
      mk("f2", { uid: "u1", predicate: "location", object: "前往清河镇山路上", chapter: 8 }),
    ]);
    expect(c).toHaveLength(0);
  });

  it("演变性谓词（status）同章多值不误报", () => {
    const c = detectConflicts([
      mk("f1", { uid: "u1", predicate: "status", object: "手在发抖", chapter: 8 }),
      mk("f2", { uid: "u1", predicate: "status", object: "力气用尽", chapter: 8 }),
    ]);
    expect(c.filter((x) => x.type === "state_divergence")).toHaveLength(0);
  });

  it("identity 同章互斥 → 报", () => {
    const c = detectConflicts([
      mk("f1", { uid: "u1", predicate: "identity", object: "清河剑派大弟子", chapter: 4 }),
      mk("f2", { uid: "u1", predicate: "identity", object: "红花门卧底杀手", chapter: 4 }),
    ]);
    expect(c.find((x) => x.type === "state_divergence")).toBeDefined();
  });

  it("死而复生：终结状态后更晚章仍有事实（按 event 轴）", () => {
    const c = detectConflicts([
      mk("f1", { uid: "u1", subject: "苏铭", predicate: "status", object: "已死亡", chapter: 5 }),
      mk("f2", { uid: "u1", subject: "苏铭", predicate: "location", object: "现身魔渊", chapter: 6, event: 9 }),
    ]);
    expect(c.find((x) => x.type === "revival")).toBeDefined();
  });

  it("关系矛盾：同对同章 2 互斥 → 报，跨章 → 不报", () => {
    const same = detectConflicts([
      mk("r1", { uid: "u1", bUid: "u2", subject: "甲|乙", predicate: "relationship", object: "结义兄弟情同手足", chapter: 8 }),
      mk("r2", { uid: "u1", bUid: "u2", subject: "甲|乙", predicate: "relationship", object: "反目成仇势不两立", chapter: 8 }),
    ]);
    expect(same.find((x) => x.type === "relationship_divergence")).toBeDefined();
    const cross = detectConflicts([
      mk("r1", { uid: "u1", bUid: "u2", subject: "甲|乙", predicate: "relationship", object: "结义兄弟情同手足", chapter: 2 }),
      mk("r2", { uid: "u1", bUid: "u2", subject: "甲|乙", predicate: "relationship", object: "反目成仇势不两立", chapter: 8 }),
    ]);
    expect(cross.filter((x) => x.type === "relationship_divergence")).toHaveLength(0);
  });

  it("chapter 聚焦（按 ingestion）：保留涉及该写入章的冲突", () => {
    const facts = [
      mk("f1", { uid: "u1", predicate: "location", object: "在青云宗大殿", chapter: 5 }),
      mk("f2", { uid: "u1", predicate: "location", object: "在魔渊深处幽谷", chapter: 5 }),
    ];
    expect(detectConflicts(facts, { chapter: 5 })).toHaveLength(1);
    expect(detectConflicts(facts, { chapter: 3 })).toHaveLength(0);
  });

  it("chapter 聚焦按 ingestion：第9章现身让 ch5 死亡 revival 在 detect(chapter=9) 仍检出（P1 回归防护）", () => {
    const facts = [
      mk("f1", { uid: "u1", subject: "苏铭", predicate: "status", object: "已死亡", chapter: 5 }),
      mk("f2", { uid: "u1", subject: "苏铭", predicate: "location", object: "现身魔渊街头", chapter: 9 }),
    ];
    // revival 的 chapter=死亡章 5，但第 9 章写入的现身 fact 才是触发者；
    // detect(chapter=9) 按 ingestion 过滤必须仍检出（否则最强信号被写入章漏掉）
    expect(detectConflicts(facts, { chapter: 9 }).find((x) => x.type === "revival")).toBeDefined();
    expect(detectConflicts(facts).find((x) => x.type === "revival")).toBeDefined();
  });

  it("renderConflictReport：无冲突 / 有冲突文案", () => {
    expect(renderConflictReport([])).toContain("未检出");
    const rep = renderConflictReport(
      detectConflicts([
        mk("f1", { uid: "u1", predicate: "location", object: "在青云宗大殿", chapter: 5 }),
        mk("f2", { uid: "u1", predicate: "location", object: "在魔渊深处幽谷", chapter: 5 }),
      ]),
    );
    expect(rep).toContain("设定漂移");
  });
});

describe("novelDetectConflicts handler", () => {
  function ctxWithFacts(
    rows: Array<{
      id: string;
      subject: string;
      uid: string;
      predicate: string;
      object: string;
      chapter: number;
      invalidatedAt?: number;
    }>,
  ): ToolContext {
    const db = new Database(":memory:");
    initSchema(db);
    const ins = db.prepare(
      `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, sector, from_chapter, event_chapter, invalidated_at_chapter)
       VALUES (?, 'n1', ?, ?, ?, ?, 'semantic', ?, ?, ?)`,
    );
    for (const r of rows) {
      ins.run(r.id, r.subject, r.uid, r.predicate, r.object, r.chapter, r.chapter, r.invalidatedAt ?? null);
    }
    return { novelId: "n1", db, projectRoot: "/tmp", wordsPerChapter: 3000 } as ToolContext;
  }

  it("扫描有效 facts 产出报告（同章互斥）", async () => {
    const ctx = ctxWithFacts([
      { id: "f1", subject: "苏铭", uid: "u1", predicate: "location", object: "在青云宗大殿", chapter: 5 },
      { id: "f2", subject: "苏铭", uid: "u1", predicate: "location", object: "在魔渊深处幽谷", chapter: 5 },
    ]);
    const r = (await novelDetectConflicts({}, ctx)) as {
      ok: boolean;
      conflict_count: number;
      report: string;
    };
    expect(r.ok).toBe(true);
    expect(r.conflict_count).toBeGreaterThanOrEqual(1);
    expect(r.report).toContain("设定漂移");
  });

  it("已失效的 facts 不参与检测", async () => {
    const ctx = ctxWithFacts([
      { id: "f1", subject: "苏铭", uid: "u1", predicate: "location", object: "在青云宗大殿", chapter: 5, invalidatedAt: 6 },
      { id: "f2", subject: "苏铭", uid: "u1", predicate: "location", object: "在魔渊深处幽谷", chapter: 5 },
    ]);
    const r = (await novelDetectConflicts({}, ctx)) as { conflict_count: number };
    expect(r.conflict_count).toBe(0);
  });
});
