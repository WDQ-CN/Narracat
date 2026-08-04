/**
 * sqlite-vec 向量索引辅助函数
 *
 * 提供向量的插入、删除和 KNN 搜索操作，
 * 在写工具的事务中与 ftsInsert 同步调用。
 */

import type Database from "better-sqlite3";
import { embed, getEmbeddingDim } from "./embedding.js";

export interface VecSearchResult {
  sourceTable: string;
  sourceId: string;
  novelId: string;
  sector: string;
  distance: number;
}

/**
 * 向量表是否已初始化
 */
let vecAvailable = false;

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
export function initVecTable(db: Database.Database, dim: number = getEmbeddingDim()): boolean {
  try {
    const existing = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_vec'")
      .get() as { sql: string } | undefined;
    if (existing?.sql) {
      const match = existing.sql.match(/embedding\s+float\[(\d+)\]/i);
      const existingDim = match ? parseInt(match[1], 10) : null;
      if (existingDim !== null && existingDim !== dim) {
        console.error(
          `[NovelMemory] memory_vec 维度变更 ${existingDim}→${dim}，重建向量表（存量行将由 backfill 重算）`,
        );
        db.exec("DROP TABLE memory_vec");
      }
    }

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
        source_table TEXT,
        source_id TEXT,
        novel_id TEXT,
        sector TEXT,
        embedding float[${dim}]
      )
    `);
    vecAvailable = true;
    return true;
  } catch (error) {
    console.error(
      `[NovelMemory] 向量表初始化失败，语义检索不可用: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    vecAvailable = false;
    return false;
  }
}

/**
 * 向量表是否可用
 */
export function isVecAvailable(): boolean {
  return vecAvailable;
}

/**
 * 插入一条向量记录
 */
export function vecInsert(
  db: Database.Database,
  sourceTable: string,
  sourceId: string,
  novelId: string,
  sector: string,
  embedding: Float32Array,
): void {
  if (!vecAvailable) return;

  db.prepare(
    `INSERT INTO memory_vec (source_table, source_id, novel_id, sector, embedding)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sourceTable, sourceId, novelId, sector, Buffer.from(embedding.buffer));
}

/**
 * 删除指定 source_id 的向量记录
 */
export function vecDelete(
  db: Database.Database,
  sourceTable: string,
  sourceId: string,
): void {
  if (!vecAvailable) return;

  db.prepare(
    `DELETE FROM memory_vec WHERE source_table = ? AND source_id = ?`,
  ).run(sourceTable, sourceId);
}

/**
 * 根据 source_id 列表批量删除向量记录
 */
export function vecDeleteBySourceIds(
  db: Database.Database,
  sourceTable: string,
  sourceIds: string[],
): void {
  if (!vecAvailable || sourceIds.length === 0) return;

  const deleteStmt = db.prepare(
    `DELETE FROM memory_vec WHERE source_table = ? AND source_id = ?`,
  );

  for (const id of sourceIds) {
    deleteStmt.run(sourceTable, id);
  }
}

/**
 * KNN 向量搜索
 *
 * 使用 vec0 的 MATCH + k= 语法执行近邻搜索。
 * metadata 列（novel_id, sector）直接在 WHERE 子句中过滤。
 * 结果按 distance 升序返回（vec0 隐式排序）。
 *
 * @see https://alexgarcia.xyz/sqlite-vec/features/knn.html
 */
export function vecSearch(
  db: Database.Database,
  queryEmbedding: Float32Array,
  novelId: string,
  options?: { sector?: string; limit?: number },
): VecSearchResult[] {
  if (!vecAvailable) return [];

  const limit = options?.limit ?? 20;

  // vec0 KNN 语法：embedding MATCH ? AND k = ? 返回 k 个最近邻
  // metadata 列（novel_id, sector）可直接在 WHERE 中过滤
  let sql = `SELECT source_table, source_id, novel_id, sector, distance
             FROM memory_vec
             WHERE embedding MATCH ? AND k = ? AND novel_id = ?`;
  const params: unknown[] = [
    Buffer.from(queryEmbedding.buffer),
    limit,
    novelId,
  ];

  if (options?.sector) {
    sql += ` AND sector = ?`;
    params.push(options.sector);
  }

  const rows = db.prepare(sql).all(...params) as Array<{
    source_table: string;
    source_id: string;
    novel_id: string;
    sector: string;
    distance: number;
  }>;

  return rows.map((r) => ({
    sourceTable: r.source_table,
    sourceId: r.source_id,
    novelId: r.novel_id,
    sector: r.sector,
    distance: r.distance,
  }));
}

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
export async function backfillVectors(
  db: Database.Database,
  novelId: string,
): Promise<{ backfilled: number }> {
  if (!vecAvailable) return { backfilled: 0 };

  // 已建向量的 (source_table, source_id) 全集（vec0 元数据列可直接全扫）
  const existing = new Set(
    (
      db
        .prepare("SELECT source_table, source_id FROM memory_vec WHERE novel_id = ?")
        .all(novelId) as Array<{ source_table: string; source_id: string }>
    ).map((r) => `${r.source_table}:${r.source_id}`),
  );

  type Candidate = { sourceTable: string; sourceId: string; sector: string; content: string };
  const candidates: Candidate[] = [];

  for (const r of db
    .prepare("SELECT id, subject, predicate, object FROM facts WHERE novel_id = ?")
    .all(novelId) as Array<{ id: string; subject: string; predicate: string; object: string }>) {
    if (existing.has(`facts:${r.id}`)) continue;
    candidates.push({
      sourceTable: "facts",
      sourceId: r.id,
      sector: "semantic",
      content: `${r.subject} ${r.predicate} ${r.object}`,
    });
  }

  for (const r of db
    .prepare("SELECT id, summary FROM chapter_summaries WHERE novel_id = ?")
    .all(novelId) as Array<{ id: string; summary: string }>) {
    if (existing.has(`chapter_summaries:${r.id}`)) continue;
    candidates.push({
      sourceTable: "chapter_summaries",
      sourceId: r.id,
      sector: "episodic",
      content: r.summary,
    });
  }

  for (const r of db
    .prepare("SELECT scope, scope_id, summary FROM arc_summaries WHERE novel_id = ?")
    .all(novelId) as Array<{ scope: string; scope_id: string; summary: string }>) {
    const sourceId = `${r.scope}:${r.scope_id}`;
    if (existing.has(`arc_summaries:${sourceId}`)) continue;
    candidates.push({
      sourceTable: "arc_summaries",
      sourceId,
      sector: "episodic",
      content: r.summary,
    });
  }

  if (candidates.length === 0) return { backfilled: 0 };

  console.error(
    `[NovelMemory] 向量 backfill：检测到 ${candidates.length} 条历史记忆缺向量，开始补算…`,
  );

  let backfilled = 0;
  for (const c of candidates) {
    const embedding = await embed(c.content);
    if (!embedding) {
      console.error(
        `[NovelMemory] 向量 backfill 中止：embedding 模型不可用，已补 ${backfilled}/${candidates.length}`,
      );
      break;
    }
    vecInsert(db, c.sourceTable, c.sourceId, novelId, c.sector, embedding);
    backfilled += 1;
    if (backfilled % 50 === 0) {
      console.error(`[NovelMemory] 向量 backfill 进度 ${backfilled}/${candidates.length}`);
    }
  }

  console.error(`[NovelMemory] 向量 backfill 完成：补算 ${backfilled} 条`);
  return { backfilled };
}
