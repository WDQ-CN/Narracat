/**
 * facts 实体图构建（HippoRAG 思路，纯算法、无外部图库）
 *
 * 把 facts 重组成「角色实体为节点、facts 为边」的无向图，供 Personalized PageRank
 * 多跳召回。两类边来源：
 *   - relationship fact：subject_character_uid ↔ subject_character_b_uid（结构化双端）
 *   - 其他 fact：subject_character_uid → object 文本里提及的已知角色（debt/oath 等
 *     谓词的「另一端」藏在散文里，靠角色名匹配补出隐式边）
 *
 * 同时记录每个实体关联的 fact id，供 PPR 排名后按实体得分聚合回 facts。
 */
import type { ResolvedCharacter } from "./alias-map.js";
/** 建图所需的 facts 字段（multiHopRecall 从 facts 表投影出来传入） */
export interface GraphFactRow {
    id: string;
    subject_character_uid: string | null;
    subject_character_b_uid: string | null;
    predicate: string;
    object: string;
}
export interface EntityGraph {
    /** 无向邻接：node uid → (neighbor uid → 累计边权) */
    adjacency: Map<string, Map<string, number>>;
    /** 实体 uid → 关联的 fact id 集合（回表聚合用） */
    factsByEntity: Map<string, Set<string>>;
}
export declare function buildEntityGraph(facts: GraphFactRow[], aliasMap: Map<string, ResolvedCharacter>): EntityGraph;
