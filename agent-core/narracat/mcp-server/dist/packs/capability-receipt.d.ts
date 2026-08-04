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
export declare function buildReceiptEntries(input: {
    personaCard: PersonaCard | null;
    craftPackHints: CraftPackHint[];
    pools: PackPools;
}): CapabilityReceiptEntry[];
export declare function writeCapabilityReceipt(projectRoot: string, chapter: number, receipt: {
    entries: CapabilityReceiptEntry[];
    warnings: string[];
}): void;
export interface PlanningReceiptEntry {
    card_id: string;
    pack_id: string;
    pack_version: string;
    origin: string;
    dimension: string;
    one_line: string;
}
export declare function writePlanningCapabilityReceipt(projectRoot: string, stage: StructureStage, entries: PlanningReceiptEntry[]): void;
