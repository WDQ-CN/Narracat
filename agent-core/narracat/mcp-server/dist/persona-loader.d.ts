import type { PersonaPoolEntry } from "./packs/pack-resolver.js";
export interface PersonaCard {
    id: string;
    name: string;
    body: string;
}
/** 单测用：清空模块级缓存 */
export declare function resetPersonaCache(): void;
/**
 * pool 省略时的默认候选池：从既有 persona index.json 构造，origin 一律标 official。
 * 这是向后兼容的等价路径——equivalence 由 origin 单一（tie-break 恒为 no-op）保证。
 */
export declare function defaultPersonaPool(): PersonaPoolEntry[];
/**
 * 按叙述声音关键词机械选卡。
 * 计分：关键词命中 archetype（叙述声音原型）记 2 分，命中其余自由文本维度记 1 分；
 * 取最高分；零分或并列首名歧义时不选（宁缺勿错——省略 persona 是安全回退）。
 *
 * @param chapterEmotions 本章目标情绪（`detectChapterEmotions` 结果，按命中强度降序，
 *   首位即主导情绪）——builder 已算过一次，此处直接复用，不重复探测。
 * @param buildNotes 可选：命中调制门时向此数组记一条可解释说明（builder 的系统诊断通道）。
 */
export declare function selectPersona(voice: Map<string, string> | null, chapterEmotions?: string[], buildNotes?: string[], pool?: PersonaPoolEntry[]): PersonaCard | null;
