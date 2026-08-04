import type { CraftPoolEntry } from "./packs/pack-resolver.js";
export interface CraftPackIndexEntry {
    pack_id: string;
    path: string;
    triggers: string[];
    beat_types: string[];
    technique_tags: string[];
    emotion_tags: string[];
    exclusions: string[];
    priority: number;
}
export interface CraftPackHint {
    pack_id: string;
    reference_path: string;
    reason: string;
    matched_triggers: string[];
}
export declare function loadPackIndex(): CraftPackIndexEntry[];
/** 测试用：清空模块缓存 */
export declare function _resetPackIndexCache(): void;
/**
 * pool 省略时的默认候选池：从既有 pack-index.json 构造，origin 一律标 official。
 * 这是向后兼容的等价路径——equivalence 由 origin 单一（排序 tie-break 恒为 no-op）保证。
 */
export declare function defaultCraftPool(): CraftPoolEntry[];
export declare function selectCraftPacks(chapterOutline: string, limit?: number, pool?: CraftPoolEntry[]): CraftPackHint[];
