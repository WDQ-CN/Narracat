/**
 * sqlite-vec 向量索引辅助函数
 *
 * 提供向量的插入、删除和 KNN 搜索操作，
 * 在写工具的事务中与 ftsInsert 同步调用。
 */
import type Database from "better-sqlite3";
export interface VecSearchResult {
    sourceTable: string;
    sourceId: string;
    novelId: string;
    sector: string;
    distance: number;
}
/**
 * 初始化向量表（在 openDatabase 后调用）
 *
 * 需要 sqlite-vec 扩展已加载。若扩展未加载或初始化失败，
 * vecAvailable 标记为 false，所有向量操作静默跳过。
 *
 * 维度变更兼容：embedding 模型换代会改变向量维度（如 768→512），与旧表不兼容。
 * 检测到存量 memory_vec 维度与当前模型不符时整表重建（向量空间不可混存），
 * 存量行经 backfillVectors 用新模型重算 —— 旧库零数据丢失，仅向量索引重建。
 */
export declare function initVecTable(db: Database.Database, dim?: number): boolean;
/**
 * 向量表是否可用
 */
export declare function isVecAvailable(): boolean;
/**
 * 插入一条向量记录
 */
export declare function vecInsert(db: Database.Database, sourceTable: string, sourceId: string, novelId: string, sector: string, embedding: Float32Array): void;
/**
 * 删除指定 source_id 的向量记录
 */
export declare function vecDelete(db: Database.Database, sourceTable: string, sourceId: string): void;
/**
 * 根据 source_id 列表批量删除向量记录
 */
export declare function vecDeleteBySourceIds(db: Database.Database, sourceTable: string, sourceIds: string[]): void;
/**
 * KNN 向量搜索
 *
 * 使用 vec0 的 MATCH + k= 语法执行近邻搜索。
 * metadata 列（novel_id, sector）直接在 WHERE 子句中过滤。
 * 结果按 distance 升序返回（vec0 隐式排序）。
 *
 * @see https://alexgarcia.xyz/sqlite-vec/features/knn.html
 */
export declare function vecSearch(db: Database.Database, queryEmbedding: Float32Array, novelId: string, options?: {
    sector?: string;
    limit?: number;
}): VecSearchResult[];
/**
 * 历史记忆向量回填（迁移路径）
 *
 * 适用两种存量场景：① 此前 embedding 模型加载失效，memory_vec 一直为空；
 * ② embedding 模型换代后维度变更、向量表被重建。两者都需要把已有 facts /
 * chapter_summaries / arc_summaries 用当前模型重算向量补回索引。
 *
 * 关键性质：
 * - 幂等：只补「源表有行但 memory_vec 无对应条目」的缺口，已建向量的行跳过；
 *   全部补齐后再次调用为一次廉价 COUNT 扫描即返回。
 * - 缺口门控：无缺口时直接返回、不触发 embed()，故健康库的启动不会加载模型。
 * - 重建文本与写入侧严格一致：facts = `subject predicate object`、摘要 = summary。
 * - 逐条插入、不持有跨 await 的事务，可与正常工具调用安全并行（后台运行）。
 *
 * @returns 本次补算的向量条数
 */
export declare function backfillVectors(db: Database.Database, novelId: string): Promise<{
    backfilled: number;
}>;
