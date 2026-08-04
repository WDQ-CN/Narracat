import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildReceiptEntries, writeCapabilityReceipt, writePlanningCapabilityReceipt } from "./capability-receipt.js";
import type { PackPools } from "./pack-resolver.js";

let projectRoot: string;
beforeEach(() => { projectRoot = mkdtempSync(join(tmpdir(), "receipt-")); });
afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

const pools = {
  personas: [{ id: "my-voice", name: "我的声音", path: "/abs/v.md", keywords: [], origin: "user", source_pack_id: "my-pack", source_pack_version: "1.0.0" }],
  craft: [{ pack_id: "crisis-action", path: "x", absolute_path: "/abs/c.md", triggers: [], beat_types: [], technique_tags: [], emotion_tags: [], exclusions: [], priority: 2, origin: "official", source_pack_id: "official-base", source_pack_version: "4.0.132" }],
  structure: [], notes: [],
} as unknown as PackPools;

describe("章级能力回执（spec §4.4）", () => {
  it("选中卡回查池拿溯源，落盘 ch-041.json，重跑覆盖", () => {
    const entries = buildReceiptEntries({
      personaCard: { id: "my-voice", name: "我的声音", body: "…" },
      craftPackHints: [{ pack_id: "crisis-action", reference_path: "/abs/c.md", reason: "触发词命中：危机" }],
      pools,
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: "persona", pack_id: "my-pack", pack_version: "1.0.0", origin: "user", consumer: "chapter-writer" });
    expect(entries[1]).toMatchObject({ type: "craft", pack_id: "official-base", reason: "触发词命中：危机" });

    writeCapabilityReceipt(projectRoot, 41, { entries, warnings: ["某警告"] });
    writeCapabilityReceipt(projectRoot, 41, { entries, warnings: [] }); // 重跑覆盖
    const receipt = JSON.parse(readFileSync(join(projectRoot, ".narracat", "capability-receipts", "ch-041.json"), "utf8"));
    expect(receipt.chapter).toBe(41);
    expect(receipt.entries).toHaveLength(2);
    expect(receipt.warnings).toEqual([]);
  });

  it("未命中池的选卡（如缺省池路径）不产孤儿条目", () => {
    const entries = buildReceiptEntries({ personaCard: { id: "ghost", name: "幽灵", body: "" }, craftPackHints: [], pools });
    expect(entries).toHaveLength(0);
  });
});

describe("规划期装载回执（spec §6：structure 回执补账）", () => {
  it("落盘 planning-<stage>.json，结构逐字段正确，同 stage 重写覆盖", () => {
    writePlanningCapabilityReceipt(projectRoot, "stage-1", [
      { card_id: "c1", pack_id: "p", pack_version: "1.0.0", origin: "user", dimension: "D1", one_line: "x" },
    ]);
    writePlanningCapabilityReceipt(projectRoot, "stage-1", [
      { card_id: "c2", pack_id: "p", pack_version: "1.0.0", origin: "official", dimension: "D2", one_line: "y" },
    ]);
    const receipt = JSON.parse(
      readFileSync(join(projectRoot, ".narracat", "capability-receipts", "planning-stage-1.json"), "utf8"),
    );
    expect(receipt.stage).toBe("stage-1");
    expect(typeof receipt.generated_at).toBe("string");
    expect(receipt.entries).toEqual([
      { card_id: "c2", pack_id: "p", pack_version: "1.0.0", origin: "official", dimension: "D2", one_line: "y" },
    ]);
  });
});
