/**
 * 混合检索模块
 *
 * 将 FTS5 精确检索和 sqlite-vec 向量检索的结果
 * 通过 Reciprocal Rank Fusion (RRF) 算法合并排序。
 *
 * multiQueryHybridSearch 支持多个短查询各自 hybrid 后再做一层 RRF 合并
 * （查询间得分求和），调用方在结果上再做章节距离衰减重排。
 */
import type Database from "better-sqlite3";
export interface HybridSearchResult {
    sourceTable: string;
    sourceId: string;
    rrfScore: number;
}
/**
 * 双路混合检索 + RRF 合并
 *
 * @returns 按 RRF 分数降序排列的去重结果
 */
export declare function hybridSearch(db: Database.Database, query: string, novelId: string, options?: {
    sector?: string;
    limit?: number;
}): Promise<HybridSearchResult[]>;
/**
 * 多短查询混合检索：每个查询各自 hybrid，再按 (sourceTable, sourceId) 求和合并。
 *
 * 用于上下文聚合场景——从章纲机械抽出的压力点短语、角色名、
 * 故事线名、临期伏笔描述各作一个查询，命中多个查询的条目得分更高。
 */
export declare function multiQueryHybridSearch(db: Database.Database, queries: string[], novelId: string, options?: {
    sector?: string;
    limit?: number;
}): Promise<HybridSearchResult[]>;
