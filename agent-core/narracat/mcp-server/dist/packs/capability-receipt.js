// 章级能力回执（spec §4.4）：记录本章实际被选中的 persona/craft 卡溯源，
// 落 .narracat/capability-receipts/ch-NNN.json，供 App 展示「本章用了哪些能力」
// （Task 9b 消费其落盘产物）。写盘失败不得阻断 WCP 构建，调用方须自行 try/catch。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export function buildReceiptEntries(input) {
    const entries = [];
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
export function writeCapabilityReceipt(projectRoot, chapter, receipt) {
    const dir = join(projectRoot, ".narracat", "capability-receipts");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `ch-${String(chapter).padStart(3, "0")}.json`);
    writeFileSync(file, JSON.stringify({ chapter, ...receipt }, null, 2) + "\n");
}
export function writePlanningCapabilityReceipt(projectRoot, stage, entries) {
    const dir = join(projectRoot, ".narracat", "capability-receipts");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `planning-${stage}.json`);
    writeFileSync(file, JSON.stringify({ stage, generated_at: new Date().toISOString(), entries }, null, 2) + "\n");
}
