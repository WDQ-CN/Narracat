import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../migrate.js";
import { novelSubmitStyleAnchor, novelListStyleAnchors } from "./style-anchor.js";
import { novelRollbackChapter } from "./writers.js";
import type { ToolContext } from "../types.js";

const NOVEL_ID = "novel-anchor-test";
// 段落原文：写进 manuscript 文件，同时用作 excerpt（100 字，落在 80-400 区间内）
const PARA = "林跃把便条叠好塞进口袋，抬头看了眼天花板的裂缝。" + "他没说话，只是把杯子往桌角推了推，推到刚好接住漏下来的水的位置。".repeat(2);

let cleanupPaths: string[] = [];
afterEach(() => {
  for (const p of cleanupPaths) rmSync(p, { recursive: true, force: true });
  cleanupPaths = [];
});

/**
 * @param committed 第一章是否已收尾入库（chapter_summaries 有记录）。默认 true，绝大多数用例
 *   走的是「已完成章标样章」的正常路径；只有「未收尾章被拒」这条用例需要传 false。
 */
function makeCtx({ committed = true }: { committed?: boolean } = {}): ToolContext {
  const root = mkdtempSync(join(tmpdir(), "style-anchor-"));
  cleanupPaths.push(root);
  mkdirSync(join(root, "manuscript", "vol-01"), { recursive: true });
  writeFileSync(join(root, "manuscript", "vol-01", "ch-001.md"), `# 第一章 开局\n\n${PARA}\n\n又一段。\n`);
  const db = new Database(join(root, "memory.db"));
  initSchema(db); // 单参数签名
  if (committed) {
    db.prepare(
      `INSERT INTO chapter_summaries (id, novel_id, chapter, summary) VALUES (?, ?, ?, ?)`,
    ).run("s-ch001", NOVEL_ID, 1, "第一章摘要（测试占位）");
  }
  return { db, novelId: NOVEL_ID, projectRoot: root } as unknown as ToolContext;
}

describe("novel_submit_style_anchor", () => {
  it("add 正常落库并可列出", async () => {
    const ctx = makeCtx();
    const res = (await novelSubmitStyleAnchor({ action: "add", chapter: 1, excerpt: PARA }, ctx)) as {
      ok: boolean;
      anchor_id: string;
      total: number;
    };
    expect(res.ok).toBe(true);
    expect(res.total).toBe(1);

    const list = (await novelListStyleAnchors({}, ctx)) as {
      anchors: Array<{ anchor_id: string; chapter: number; excerpt: string }>;
    };
    expect(list.anchors).toHaveLength(1);
    expect(list.anchors[0].chapter).toBe(1);
    expect(list.anchors[0].excerpt).toBe(PARA);
  });

  it("excerpt 过短拒绝", async () => {
    const ctx = makeCtx();
    const res = (await novelSubmitStyleAnchor({ action: "add", chapter: 1, excerpt: "太短了。" }, ctx)) as {
      ok: boolean;
      errors: Array<{ field: string; hint: string }>;
    };
    expect(res.ok).toBe(false);
    expect(res.errors[0].field).toBe("excerpt");
  });

  it("未收尾章（chapter_summaries 无记录，如写作中断留下的残稿）拒绝标记", async () => {
    const ctx = makeCtx({ committed: false });
    const res = (await novelSubmitStyleAnchor({ action: "add", chapter: 1, excerpt: PARA }, ctx)) as {
      ok: boolean;
      errors: Array<{ field: string; hint: string }>;
    };
    expect(res.ok).toBe(false);
    expect(res.errors[0].field).toBe("chapter");
    expect(res.errors[0].hint).toContain("还没写完");
  });

  it("excerpt 不在该章正文里拒绝", async () => {
    const ctx = makeCtx();
    const res = (await novelSubmitStyleAnchor(
      { action: "add", chapter: 1, excerpt: "这段话在正文里根本不存在".repeat(8) },
      ctx,
    )) as { ok: boolean; errors: Array<{ field: string }> };
    expect(res.ok).toBe(false);
    expect(res.errors[0].field).toBe("excerpt");
  });

  it("换行形态不同也算逐字存在（跨段划选）", async () => {
    const ctx = makeCtx();
    const res = (await novelSubmitStyleAnchor(
      { action: "add", chapter: 1, excerpt: `${PARA}\n又一段。` },
      ctx,
    )) as { ok: boolean };
    expect(res.ok).toBe(true);
  });

  it("满 3 段后 add 拒绝并给出先删的 hint", async () => {
    const ctx = makeCtx();
    for (let i = 0; i < 3; i += 1) {
      await novelSubmitStyleAnchor({ action: "add", chapter: 1, excerpt: PARA }, ctx);
    }
    const res = (await novelSubmitStyleAnchor({ action: "add", chapter: 1, excerpt: PARA }, ctx)) as {
      ok: boolean;
      errors: Array<{ hint: string }>;
    };
    expect(res.ok).toBe(false);
    expect(res.errors[0].hint).toContain("先删");
  });

  it("remove 生效", async () => {
    const ctx = makeCtx();
    const added = (await novelSubmitStyleAnchor({ action: "add", chapter: 1, excerpt: PARA }, ctx)) as {
      anchor_id: string;
    };
    const res = (await novelSubmitStyleAnchor({ action: "remove", anchor_id: added.anchor_id }, ctx)) as {
      ok: boolean;
      total: number;
    };
    expect(res.ok).toBe(true);
    expect(res.total).toBe(0);
  });

  it("回滚章节后该章的样章锚被清理", async () => {
    const ctx = makeCtx();
    await novelSubmitStyleAnchor({ action: "add", chapter: 1, excerpt: PARA }, ctx);
    await novelRollbackChapter({ chapter: 1 }, ctx);
    const list = (await novelListStyleAnchors({}, ctx)) as { anchors: unknown[] };
    expect(list.anchors).toHaveLength(0);
  });

  it("add → add → remove 第一个 → 再 add：anchor_id 不撞主键（回归：计数拼接会在此序列复用已删编号）", async () => {
    const ctx = makeCtx();
    const first = (await novelSubmitStyleAnchor({ action: "add", chapter: 1, excerpt: PARA }, ctx)) as {
      ok: boolean;
      anchor_id: string;
    };
    const second = (await novelSubmitStyleAnchor({ action: "add", chapter: 1, excerpt: PARA }, ctx)) as {
      ok: boolean;
      anchor_id: string;
    };
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    await novelSubmitStyleAnchor({ action: "remove", anchor_id: first.anchor_id }, ctx);

    const third = (await novelSubmitStyleAnchor({ action: "add", chapter: 1, excerpt: PARA }, ctx)) as {
      ok: boolean;
      anchor_id: string;
    };
    expect(third.ok).toBe(true);

    const list = (await novelListStyleAnchors({}, ctx)) as {
      anchors: Array<{ anchor_id: string }>;
    };
    expect(list.anchors).toHaveLength(2);
    const ids = list.anchors.map((a) => a.anchor_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
