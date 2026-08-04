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
export function ftsInsert(
  db: Database.Database,
  content: string,
  sourceTable: string,
  sourceId: string,
  novelId: string,
  sector: string,
): void {
  db.prepare(
    `INSERT INTO memory_fts (content, source_table, source_id, novel_id, sector)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(content, sourceTable, sourceId, novelId, sector);
}

/**
 * 从 FTS5 索引删除指定 source_id 的记录
 *
 * 注意：memory_fts 是普通（非 external-content）FTS5 表，
 * 必须用 DELETE FROM 而非 INSERT ... VALUES('delete', ...) 语法。
 */
export function ftsDelete(
  db: Database.Database,
  sourceTable: string,
  sourceId: string,
): void {
  db.prepare(
    `DELETE FROM memory_fts WHERE source_table = ? AND source_id = ?`,
  ).run(sourceTable, sourceId);
}

/**
 * 从 FTS5 索引批量删除指定 source_table 的多条记录
 */
export function ftsDeleteByTable(
  db: Database.Database,
  sourceTable: string,
  novelId: string,
): void {
  db.prepare(
    `DELETE FROM memory_fts WHERE source_table = ? AND novel_id = ?`,
  ).run(sourceTable, novelId);
}

/**
 * 根据 source_id 列表批量删除 FTS 记录
 */
export function ftsDeleteBySourceIds(
  db: Database.Database,
  sourceTable: string,
  sourceIds: string[],
): void {
  if (sourceIds.length === 0) return;

  const deleteStmt = db.prepare(
    `DELETE FROM memory_fts WHERE source_table = ? AND source_id = ?`,
  );

  for (const id of sourceIds) {
    deleteStmt.run(sourceTable, id);
  }
}

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
export function ftsSearch(
  db: Database.Database,
  query: string,
  novelId: string,
  options?: { sector?: string; limit?: number },
): FtsSearchResult[] {
  const limit = options?.limit ?? 20;
  const parsed = sanitizeFtsQuery(query);

  if (!parsed) return [];

  if (parsed.type === "fts") {
    // 原有 FTS5 MATCH 路径
    let sql = `SELECT content, source_table, source_id, novel_id, sector, rank
               FROM memory_fts
               WHERE memory_fts MATCH ? AND novel_id = ?`;
    const params: unknown[] = [parsed.query, novelId];

    if (options?.sector) {
      sql += ` AND sector = ?`;
      params.push(options.sector);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<{
      content: string;
      source_table: string;
      source_id: string;
      novel_id: string;
      sector: string;
      rank: number;
    }>;

    return rows.map((r) => ({
      content: r.content,
      sourceTable: r.source_table,
      sourceId: r.source_id,
      novelId: r.novel_id,
      sector: r.sector,
      rank: r.rank,
    }));
  }

  // LIKE fallback（短查询，< 3 字符）
  let sql = `SELECT content, source_table, source_id, novel_id, sector, 0 as rank
             FROM memory_fts
             WHERE content LIKE ? AND novel_id = ?`;
  const params: unknown[] = [parsed.pattern, novelId];

  if (options?.sector) {
    sql += ` AND sector = ?`;
    params.push(options.sector);
  }

  sql += ` LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<{
    content: string;
    source_table: string;
    source_id: string;
    novel_id: string;
    sector: string;
    rank: number;
  }>;

  return rows.map((r) => ({
    content: r.content,
    sourceTable: r.source_table,
    sourceId: r.source_id,
    novelId: r.novel_id,
    sector: r.sector,
    rank: r.rank,
  }));
}

interface FtsQueryResult {
  type: "fts";
  query: string;
}

interface LikeQueryResult {
  type: "like";
  pattern: string;
}

/**
 * 将自然语言查询转为安全的 FTS5 trigram 查询，
 * 短查询（< 3 字符）fallback 到 LIKE 模糊匹配。
 *
 * trigram 分词器要求匹配子串至少 3 字符，
 * 但中文人名（如"张三"）常为 2 字符，需要 LIKE 兜底。
 */
function sanitizeFtsQuery(
  query: string,
): FtsQueryResult | LikeQueryResult | null {
  // 移除 FTS5 操作符和特殊字符
  const cleaned = query.replace(/[*"():^{}~<>+\-]/g, " ").trim();
  if (!cleaned) return null;

  // trigram 要求至少 3 个字符
  if (cleaned.length >= 3) {
    return { type: "fts", query: `"${cleaned}"` };
  }

  // 短查询：fallback 到 LIKE
  return { type: "like", pattern: `%${cleaned}%` };
}
