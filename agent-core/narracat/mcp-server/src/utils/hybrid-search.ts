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
import { ftsSearch, type FtsSearchResult } from "./fts.js";
import { vecSearch, isVecAvailable, type VecSearchResult } from "./vec.js";
import { embed } from "./embedding.js";

export interface HybridSearchResult {
  sourceTable: string;
  sourceId: string;
  rrfScore: number;
}

const RRF_K = 60; // 标准 RRF 常数

/**
 * 双路混合检索 + RRF 合并
 *
 * @returns 按 RRF 分数降序排列的去重结果
 */
export async function hybridSearch(
  db: Database.Database,
  query: string,
  novelId: string,
  options?: { sector?: string; limit?: number },
): Promise<HybridSearchResult[]> {
  const limit = options?.limit ?? 10;
  const fetchLimit = limit * 3; // 多取一些用于 RRF 合并后截断

  // 路径 1: FTS5 精确检索
  const ftsResults = ftsSearch(db, query, novelId, {
    sector: options?.sector,
    limit: fetchLimit,
  });

  // 路径 2: 向量语义检索（如果可用）
  let vecResults: VecSearchResult[] = [];
  if (isVecAvailable()) {
    const queryEmbedding = await embed(query);
    if (queryEmbedding) {
      vecResults = vecSearch(db, queryEmbedding, novelId, {
        sector: options?.sector,
        limit: fetchLimit,
      });
    }
  }

  // RRF 合并
  const scores = new Map<string, { sourceTable: string; sourceId: string; score: number }>();

  // 辅助函数：生成去重 key
  const makeKey = (sourceTable: string, sourceId: string) => `${sourceTable}:${sourceId}`;

  // FTS 结果评分
  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i];
    const key = makeKey(r.sourceTable, r.sourceId);
    const existing = scores.get(key);
    const rrfScore = 1 / (RRF_K + i + 1);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(key, { sourceTable: r.sourceTable, sourceId: r.sourceId, score: rrfScore });
    }
  }

  // 向量结果评分
  for (let i = 0; i < vecResults.length; i++) {
    const r = vecResults[i];
    const key = makeKey(r.sourceTable, r.sourceId);
    const existing = scores.get(key);
    const rrfScore = 1 / (RRF_K + i + 1);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(key, { sourceTable: r.sourceTable, sourceId: r.sourceId, score: rrfScore });
    }
  }

  // 按 RRF 分数降序排列，截断到 limit
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ sourceTable, sourceId, score }) => ({
      sourceTable,
      sourceId,
      rrfScore: score,
    }));
}

/**
 * 多短查询混合检索：每个查询各自 hybrid，再按 (sourceTable, sourceId) 求和合并。
 *
 * 用于上下文聚合场景——从章纲机械抽出的压力点短语、角色名、
 * 故事线名、临期伏笔描述各作一个查询，命中多个查询的条目得分更高。
 */
export async function multiQueryHybridSearch(
  db: Database.Database,
  queries: string[],
  novelId: string,
  options?: { sector?: string; limit?: number },
): Promise<HybridSearchResult[]> {
  const limit = options?.limit ?? 10;
  const merged = new Map<string, HybridSearchResult>();

  for (const query of queries) {
    const trimmed = query.trim();
    if (!trimmed) continue;
    const results = await hybridSearch(db, trimmed, novelId, {
      sector: options?.sector,
      limit,
    });
    for (const r of results) {
      const key = `${r.sourceTable}:${r.sourceId}`;
      const existing = merged.get(key);
      if (existing) {
        existing.rrfScore += r.rrfScore;
      } else {
        merged.set(key, { ...r });
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit);
}
