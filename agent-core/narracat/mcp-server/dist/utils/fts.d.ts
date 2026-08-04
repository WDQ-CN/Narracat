/**
 * FTS5 全文索引辅助函数
 *
 * 提供 FTS 索引的插入、删除和搜索操作，
 * 在写工具的事务中同步调用以保持索引一致。
 */
import type Database from "better-sqlite3";
/**
 * 向 FTS5 索引插入一条记录
 */
export declare function ftsInsert(db: Database.Database, content: string, sourceTable: string, sourceId: string, novelId: string, sector: string): void;
/**
 * 从 FTS5 索引删除指定 source_id 的记录
 *
 * 注意：memory_fts 是普通（非 external-content）FTS5 表，
 * 必须用 DELETE FROM 而非 INSERT ... VALUES('delete', ...) 语法。
 */
export declare function ftsDelete(db: Database.Database, sourceTable: string, sourceId: string): void;
/**
 * 从 FTS5 索引批量删除指定 source_table 的多条记录
 */
export declare function ftsDeleteByTable(db: Database.Database, sourceTable: string, novelId: string): void;
/**
 * 根据 source_id 列表批量删除 FTS 记录
 */
export declare function ftsDeleteBySourceIds(db: Database.Database, sourceTable: string, sourceIds: string[]): void;
export interface FtsSearchResult {
    content: string;
    sourceTable: string;
    sourceId: string;
    novelId: string;
    sector: string;
    rank: number;
}
/**
 * FTS5 全文搜索（短查询自动 fallback 到 LIKE 模糊匹配）
 */
export declare function ftsSearch(db: Database.Database, query: string, novelId: string, options?: {
    sector?: string;
    limit?: number;
}): FtsSearchResult[];
