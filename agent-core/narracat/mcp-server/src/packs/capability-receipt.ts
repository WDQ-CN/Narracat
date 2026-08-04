// 章级能力回执（spec §4.4）：记录本章实际被选中的 persona/craft 卡溯源，
// 落 .narracat/capability-receipts/ch-NNN.json，供 App 展示「本章用了哪些能力」
// （Task 9b 消费其落盘产物）。写盘失败不得阻断 WCP 构建，调用方须自行 try/catch。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PackPools } from "./pack-resolver.js";
import type { StructureStage } from "./pack-manifest.js";
import type { PersonaCard } from "../persona-loader.js";
import type { CraftPackHint } from "../craft-pack-loader.js";

export interface CapabilityReceiptEntry {
  card_id: string;
  type: "persona" | "craft";
  pack_id: string;
  pack_version: string;
  origin: string;
  consumer: "chapter-writer";
  reason: string;
}

export function buildReceiptEntries(input: {
  personaCard: PersonaCard | null;
  craftPackHints: CraftPackHint[];
  pools: PackPools;
}): CapabilityReceiptEntry[] {
  const entries: CapabilityReceiptEntry[] = [];
  if (input.personaCard) {
    const src = input.pools.personas.find((p) => p.id === input.personaCard?.id);
    if (src) {
      entries.push({
        card_id: src.id,
        type: "persona",
        pack_id: src.source_pack_id,
        pack_version: src.source_pack_version,
        origin: src.origin,
        consumer: "chapter-writer",
        reason: "叙述声音关键词命中",
      });
    }
  }
  for (const hint of input.craftPackHints) {
    const src = input.pools.craft.find((c) => c.pack_id === hint.pack_id);
    if (src) {
      entries.push({
        card_id: src.pack_id,
        type: "craft",
        pack_id: src.source_pack_id,
        pack_version: src.source_pack_version,
        origin: src.origin,
        consumer: "chapter-writer",
        reason: hint.reason,
      });
    }
  }
  return entries;
}

export function writeCapabilityReceipt(
  projectRoot: string,
  chapter: number,
  receipt: { entries: CapabilityReceiptEntry[]; warnings: string[] },
): void {
  const dir = join(projectRoot, ".narracat", "capability-receipts");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `ch-${String(chapter).padStart(3, "0")}.json`);
  writeFileSync(file, JSON.stringify({ chapter, ...receipt }, null, 2) + "\n");
}

// 规划期装载回执（spec §6：structure 回执补账，B2 刀3 P1）：novel_list_structure_cards
// 每次按 stage 返回剧作卡候选池时落盘，让用户造的剧作卡「被规划阶段装载过」可见——
// 与 writeCapabilityReceipt（章级、选中卡）不同，这里记的是「候选池全量」而非「命中」，
// 因为规划阶段（outline-architect 读卡）本身没有确定性选中判定。写盘失败不得阻断工具
// 返回，调用方须自行 try/catch（同 novel_build_writing_context_pack 的 fail-soft 用法）。
export interface PlanningReceiptEntry {
  card_id: string;
  pack_id: string;
  pack_version: string;
  origin: string;
  dimension: string;
  one_line: string;
}

export function writePlanningCapabilityReceipt(
  projectRoot: string,
  stage: StructureStage,
  entries: PlanningReceiptEntry[],
): void {
  const dir = join(projectRoot, ".narracat", "capability-receipts");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `planning-${stage}.json`);
  writeFileSync(
    file,
    JSON.stringify({ stage, generated_at: new Date().toISOString(), entries }, null, 2) + "\n",
  );
}
