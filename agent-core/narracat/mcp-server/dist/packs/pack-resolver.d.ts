import { type PackOrigin, type StructureStage } from "./pack-manifest.js";
export interface NovelPacksEntry {
    id: string;
    version?: string;
}
interface PackProvenance {
    origin: PackOrigin;
    source_pack_id: string;
    source_pack_version: string;
}
export interface PersonaPoolEntry extends PackProvenance {
    id: string;
    name: string;
    path: string;
    keywords: string[];
}
export interface CraftPoolEntry extends PackProvenance {
    pack_id: string;
    path: string;
    absolute_path: string;
    triggers: string[];
    beat_types: string[];
    technique_tags: string[];
    emotion_tags: string[];
    exclusions: string[];
    priority: number;
}
export interface StructurePoolEntry extends PackProvenance {
    id: string;
    path: string;
    dimension: string;
    stage: StructureStage;
    one_line: string;
}
export interface PackPools {
    personas: PersonaPoolEntry[];
    craft: CraftPoolEntry[];
    structure: StructurePoolEntry[];
    notes: string[];
}
export declare function resetPackResolverCache(): void;
export declare function resolvePackPools(projectRoot: string, opts?: {
    userPacksDir?: string;
    builtinPacksDir?: string;
}): PackPools;
export {};
