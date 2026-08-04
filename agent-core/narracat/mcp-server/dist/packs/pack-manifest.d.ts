export declare const PACK_FORMAT_VERSION = 1;
export declare const OFFICIAL_PACK_ID_PREFIX = "official-";
export declare const DEFAULT_ENABLED_PACK_IDS: string[];
export type PackOrigin = "official" | "user" | "community";
export declare const STRUCTURE_STAGES: readonly ["stage-1", "stage-2", "stage-opening"];
export type StructureStage = (typeof STRUCTURE_STAGES)[number];
interface PackCardBase {
    type: string;
    path: string;
    id: string;
}
export interface PersonaCardEntry extends PackCardBase {
    type: "persona";
    name: string;
    keywords: string[];
}
export interface CraftCardEntry extends PackCardBase {
    type: "craft";
    triggers: string[];
    beat_types: string[];
    technique_tags: string[];
    emotion_tags: string[];
    exclusions: string[];
    priority: number;
}
export interface StructureCardEntry extends PackCardBase {
    type: "structure";
    dimension: string;
    stage: StructureStage;
    one_line: string;
}
export interface BenchmarkCardEntry extends PackCardBase {
    type: "benchmark";
    genre: string;
}
export type PackCardEntry = PersonaCardEntry | CraftCardEntry | StructureCardEntry | BenchmarkCardEntry;
export interface PackManifest {
    pack_format_version: number;
    id: string;
    name: string;
    author: string;
    version: string;
    description?: string;
    min_engine_version?: string;
    changelog?: string;
    publisher_id?: string;
    license?: string;
    cards: PackCardEntry[];
}
export declare function validatePackManifest(raw: unknown): {
    manifest: PackManifest | null;
    errors: string[];
    warnings: string[];
};
export {};
