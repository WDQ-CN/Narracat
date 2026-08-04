/**
 * 文本中的角色名匹配（最长非重叠）
 *
 * query-router（分类种子）与 entity-graph（建图隐式边）共用：在一段文本里找出
 * 提及的已知角色，按 canonical 去重。名字互为前缀 / 包含时（如「林晚」/「林晚晴」），
 * 优先最长名，且已匹配区间不再被更短名重复命中——避免「林晚晴」误命中「林晚」、
 * 把单点查询误判成多跳、或在 object 上凭空连出错边。
 */
import type { ResolvedCharacter } from "./alias-map.js";
export interface NameEntry {
    name: string;
    resolved: ResolvedCharacter;
}
/** 预备最长优先的角色名索引（≥2 字，按长度降序）；建图时预备一次、循环复用 */
export declare function prepareNameIndex(aliasMap: Map<string, ResolvedCharacter>): NameEntry[];
/**
 * 最长非重叠匹配：返回文本里提及的角色（按 canonical 去重）。
 * nameIndex 须按名长度降序（用 prepareNameIndex 预备），以保证最长名优先占位。
 */
export declare function matchCharactersInText(text: string, nameIndex: NameEntry[]): ResolvedCharacter[];
