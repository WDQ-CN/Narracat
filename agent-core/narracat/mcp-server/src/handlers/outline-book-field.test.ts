import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

vi.mock("../utils/embedding.js", () => ({
  embed: vi.fn(async () => null),
}));

import { initSchema } from "../migrate.js";
import type { ToolContext } from "../types.js";
import type { OutlinePayload } from "./validators.js";
import { novelSubmitOutline, novelUpdateOutlineBookField } from "./writers.js";

function loadFixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf-8"),
  ) as T;
}

const BASE_STATE = [
  "progress:",
  "  last_completed_chapter: 0",
  "  completed_chapters: []",
  "  in_progress_chapter: null",
  "word_count:",
  "  total: 0",
  "  by_chapter: {}",
  "structure:",
  "  total_volumes: 0",
  "  total_chapters_planned: 0",
  "  chapter_to_volume: {}",
  "checkpoint:",
  "  last_command: null",
  "  last_step: null",
  "  timestamp: null",
  "",
].join("\n");

const PREMISE_WITH_VOICE = [
  "# 立项卡",
  "",
  "## 叙述声音",
  "",
  "- archetype: 猛文热血",
  "- tone: 干净利落的爽文笔调",
  "- pacing: 急",
  "- address: 第三人称",
  "",
].join("\n");

let cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  cleanupPaths = [];
});

interface ProjectFixture {
  ctx: ToolContext;
  root: string;
  db: Database.Database;
}

function createProject(): ProjectFixture {
  const root = mkdtempSync(join(tmpdir(), "narracat-outline-book-field-"));
  cleanupPaths.push(root);
  mkdirSync(join(root, ".narracat"), { recursive: true });
  mkdirSync(join(root, "manuscript", "vol-01"), { recursive: true });
  mkdirSync(join(root, "bible", "characters"), { recursive: true });
  writeFileSync(join(root, ".narracat", "state.yaml"), BASE_STATE);
  writeFileSync(join(root, "bible", "premise.md"), PREMISE_WITH_VOICE);

  const db = new Database(":memory:");
  initSchema(db);

  return {
    root,
    db,
    ctx: {
      novelId: "novel-test",
      db,
      projectRoot: root,
      estimatedTotalChapters: 60,
      wordsPerChapter: 3000,
      styleProfile: "web_standard",
    },
  };
}

async function submitValidOutline(ctx: ToolContext): Promise<Record<string, unknown>> {
  return (await novelSubmitOutline(
    { phase: 1, payload: loadFixture("outline-v5-valid-book.json") },
    ctx,
  )) as Record<string, unknown>;
}

function readStructure(root: string): OutlinePayload {
  return JSON.parse(
    readFileSync(join(root, "outline", "outline-structure.json"), "utf-8"),
  ) as OutlinePayload;
}

function engineFacts(db: Database.Database): Record<string, string> {
  const rows = db
    .prepare("SELECT predicate, object FROM facts WHERE novel_id = ? AND subject = '全书'")
    .all("novel-test") as Array<{ predicate: string; object: string }>;
  return Object.fromEntries(rows.map((r) => [r.predicate, r.object]));
}

describe("novel_update_outline_book_field", () => {
  it("stakes_progression：三处齐更（facts + JSON + master-outline.md）", async () => {
    const { ctx, root } = createProject();
    await submitValidOutline(ctx);
    const before = readStructure(root).stakes_progression as string;

    const result = await novelUpdateOutlineBookField(
      { target: "stakes_progression", new_value: "新的赌注曲线", expected_old_value: before },
      ctx,
    );

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(readStructure(root).stakes_progression).toBe("新的赌注曲线");
    expect(readFileSync(join(root, "outline", "master-outline.md"), "utf-8")).toContain(
      "新的赌注曲线",
    );
    expect(engineFacts(ctx.db).stakes_progression).toBe("新的赌注曲线");
  });

  it("storyline_name：DB name 与 JSON/md 同步，id 不存在拒绝", async () => {
    const { ctx, root } = createProject();
    await submitValidOutline(ctx);
    const before = readStructure(root).storylines.find((s) => s.id === "SL-main")?.name as string;

    const result = await novelUpdateOutlineBookField(
      {
        target: "storyline_name",
        id: "SL-main",
        new_value: "内奸与断剑",
        expected_old_value: before,
      },
      ctx,
    );

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(readStructure(root).storylines.find((s) => s.id === "SL-main")?.name).toBe(
      "内奸与断剑",
    );
    expect(readFileSync(join(root, "outline", "master-outline.md"), "utf-8")).toContain(
      "内奸与断剑",
    );
    const dbRow = ctx.db
      .prepare("SELECT name FROM storylines WHERE novel_id = ? AND id = ?")
      .get("novel-test", "SL-main") as { name: string };
    expect(dbRow.name).toBe("内奸与断剑");

    const notFound = await novelUpdateOutlineBookField(
      {
        target: "storyline_name",
        id: "SL-does-not-exist",
        new_value: "随便什么",
        expected_old_value: "随便什么旧值",
      },
      ctx,
    );
    expect((notFound as { ok: boolean }).ok).toBe(false);
  });

  it("foreshadowing_description：DB description 与 JSON/md 同步", async () => {
    const { ctx, root } = createProject();
    await submitValidOutline(ctx);
    const before = readStructure(root).foreshadowing_registry.find((f) => f.id === "F-TRAITOR")
      ?.description as string;

    const result = await novelUpdateOutlineBookField(
      {
        target: "foreshadowing_description",
        id: "F-TRAITOR",
        new_value: "执法堂首座袖口露出的魔宗刺青纹路",
        expected_old_value: before,
      },
      ctx,
    );

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(
      readStructure(root).foreshadowing_registry.find((f) => f.id === "F-TRAITOR")?.description,
    ).toBe("执法堂首座袖口露出的魔宗刺青纹路");
    expect(readFileSync(join(root, "outline", "master-outline.md"), "utf-8")).toContain(
      "执法堂首座袖口露出的魔宗刺青纹路",
    );
    const dbRow = ctx.db
      .prepare("SELECT description FROM foreshadowing_registry WHERE novel_id = ? AND id = ?")
      .get("novel-test", "F-TRAITOR") as { description: string };
    expect(dbRow.description).toBe("执法堂首座袖口露出的魔宗刺青纹路");
  });

  it("CAS：expected_old_value 不匹配时拒绝且三处零写入", async () => {
    const { ctx, root } = createProject();
    await submitValidOutline(ctx);
    const snapshot = readFileSync(join(root, "outline", "outline-structure.json"), "utf-8");
    const masterSnapshot = readFileSync(join(root, "outline", "master-outline.md"), "utf-8");
    const factsSnapshot = engineFacts(ctx.db);

    const result = await novelUpdateOutlineBookField(
      { target: "stakes_progression", new_value: "x", expected_old_value: "早已过期的旧值" },
      ctx,
    );

    expect((result as { ok: boolean }).ok).toBe(false);
    expect(readFileSync(join(root, "outline", "outline-structure.json"), "utf-8")).toBe(snapshot);
    expect(readFileSync(join(root, "outline", "master-outline.md"), "utf-8")).toBe(masterSnapshot);
    expect(engineFacts(ctx.db)).toEqual(factsSnapshot);
  });

  it("白名单外 target / 空 new_value / 缺 id 一律拒绝", async () => {
    const { ctx, root } = createProject();
    await submitValidOutline(ctx);
    const before = readStructure(root).stakes_progression as string;

    const badTarget = await novelUpdateOutlineBookField(
      {
        target: "central_dramatic_question",
        new_value: "新的中心戏剧问题",
        expected_old_value: readStructure(root).central_dramatic_question,
      },
      ctx,
    );
    expect((badTarget as { ok: boolean }).ok).toBe(false);
    const badTargetErrors = (badTarget as { errors: Array<Record<string, unknown>> }).errors;
    expect(badTargetErrors[0].hint).toContain("novel_submit_premise");

    const emptyValue = await novelUpdateOutlineBookField(
      { target: "stakes_progression", new_value: "   ", expected_old_value: before },
      ctx,
    );
    expect((emptyValue as { ok: boolean }).ok).toBe(false);

    const missingId = await novelUpdateOutlineBookField(
      {
        target: "storyline_name",
        new_value: "缺 id 的更名",
        expected_old_value: "内奸与剑脉",
      },
      ctx,
    );
    expect((missingId as { ok: boolean }).ok).toBe(false);
  });

  it("大纲未生成（无 outline-structure.json）时拒绝且不建文件", async () => {
    const { ctx, root } = createProject();

    const result = await novelUpdateOutlineBookField(
      { target: "stakes_progression", new_value: "新赌注曲线", expected_old_value: "" },
      ctx,
    );

    expect((result as { ok: boolean }).ok).toBe(false);
    expect(existsSync(join(root, "outline", "outline-structure.json"))).toBe(false);
  });
});
