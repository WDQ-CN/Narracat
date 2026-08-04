/**
 * 派生关系读时 2 跳共邻推导（写作上下文包专用）。
 * 只对本章 outline 角色中无直接关系边的角色对，经共同邻居推出「推断」关联；
 * 系统只把两条事实串成短句，称谓与语义判断交写手。
 */

import type { ToolContext } from "../types.js";
import { FACT_LATEST_ORDER_SQL, FACT_VALID_AT_SQL } from "./fact-temporal.js";

export interface RelationshipEdge {
  aUid: string;
  aName: string;
  bUid: string;
  bName: string;
  state: string;
  /** 展示章号 = COALESCE(event_chapter, from_chapter)，故事世界生效章 */
  displayChapter: number;
}

export interface ChapterCharacter {
  uid: string;
  name: string;
}

/** 全局条数上限 */
const MAX_DERIVED = 5;
/** 共邻资格门槛：名下有效事实条数下限（不达标的龙套共邻完全不输出） */
const MIN_NEIGHBOR_FACTS = 3;

export function computeDerivedRelationships(args: {
  edges: RelationshipEdge[];
  chapterCharacters: ChapterCharacter[];
  factCountByUid: Map<string, number>;
  /** uid → 当前档案 canonical 名；角色改名后历史 facts.subject 是旧名，展示名优先取此映射 */
  canonicalNameByUid?: Map<string, string>;
  /** 存在有效直接边的 uid 对全集（含 subject 畸形不可展示的）；抑制判定须用它而非邻接表 */
  directPairKeys?: Set<string>;
}): string[] {
  const { edges, chapterCharacters, factCountByUid, canonicalNameByUid, directPairKeys } = args;
  if (chapterCharacters.length < 2) return [];

  // 邻接表：uid → (对端 uid → 边)。loader 已按对折叠最新有效边，首见即最新。
  const adjacency = new Map<string, Map<string, RelationshipEdge>>();
  const link = (from: string, to: string, e: RelationshipEdge) => {
    let peers = adjacency.get(from);
    if (!peers) {
      peers = new Map();
      adjacency.set(from, peers);
    }
    if (!peers.has(to)) peers.set(to, e);
  };
  for (const e of edges) {
    link(e.aUid, e.bUid, e);
    link(e.bUid, e.aUid, e);
  }

  const nameOnEdge = (e: RelationshipEdge, uid: string) =>
    e.aUid === uid ? e.aName : e.bName;

  const sorted = [...chapterCharacters].sort((l, r) => l.uid.localeCompare(r.uid));
  const candidates: Array<{ line: string; viaDegree: number; pairKey: string }> = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[i];
      const c = sorted[j];
      const bPeers = adjacency.get(b.uid);
      const cPeers = adjacency.get(c.uid);
      const pairKey = [b.uid, c.uid].sort().join("|");
      // 有直接边（含被包预算截断未展示的、以及 subject 畸形不可展示的）不推派生
      if (bPeers?.has(c.uid) || directPairKeys?.has(pairKey)) continue;
      if (!bPeers || !cPeers) continue;
      // 共邻：资格门槛 → 度数升序（枢纽降权）→ uid 兜底，每对取 1
      const via = [...bPeers.keys()]
        .filter((uid) => cPeers.has(uid))
        .filter((uid) => (factCountByUid.get(uid) ?? 0) >= MIN_NEIGHBOR_FACTS)
        .sort(
          (l, r) =>
            (adjacency.get(l)?.size ?? 0) - (adjacency.get(r)?.size ?? 0) ||
            l.localeCompare(r),
        )[0];
      if (!via) continue;
      const eb = bPeers.get(via);
      const ec = cPeers.get(via);
      if (!eb || !ec) continue;
      const viaName = canonicalNameByUid?.get(via) ?? nameOnEdge(eb, via);
      const line =
        `${b.name} 与 ${c.name} 或有关联（推断）：` +
        `${b.name}×${viaName} ${eb.state}（ch${eb.displayChapter} 起）、` +
        `${c.name}×${viaName} ${ec.state}（ch${ec.displayChapter} 起）`;
      candidates.push({
        line,
        viaDegree: adjacency.get(via)?.size ?? 0,
        pairKey,
      });
    }
  }

  candidates.sort(
    (l, r) => l.viaDegree - r.viaDegree || l.pairKey.localeCompare(r.pairKey),
  );
  return candidates.slice(0, MAX_DERIVED).map((c) => c.line);
}

/**
 * 全库截至 asOfChapter 仍有效的 relationship 边，每个角色对折叠为最新一条。
 * subject 拆出的名字仅作降级展示值（角色改名不重写历史 facts，可能是旧名）；
 * 当前档案名覆盖在 computeDerivedRelationships 的 canonicalNameByUid 层做。
 *
 * 返回值拆两层：edges 仅含 subject 可正常拆出两名的边（用于共邻搭桥展示）；
 * directPairKeys 是存在有效直接边的 uid 对全集，含 subject 畸形不可展示的对——
 * 直接边的「存在性」只应由双 UID 判定，不受展示名解析成败影响，抑制派生时必须查这张表而非 edges 的邻接关系。
 */
export function loadValidRelationshipEdges(
  ctx: ToolContext,
  asOfChapter: number,
): { edges: RelationshipEdge[]; directPairKeys: Set<string> } {
  const rows = ctx.db
    .prepare(
      `SELECT subject, subject_character_uid AS a_uid, subject_character_b_uid AS b_uid,
              object, COALESCE(event_chapter, from_chapter) AS display_chapter
         FROM facts
        WHERE novel_id = ? AND predicate = 'relationship'
          AND subject_character_uid IS NOT NULL
          AND subject_character_b_uid IS NOT NULL
          AND ${FACT_VALID_AT_SQL}
        ORDER BY ${FACT_LATEST_ORDER_SQL}`,
    )
    .all(ctx.novelId, asOfChapter, asOfChapter) as Array<{
    subject: string;
    a_uid: string;
    b_uid: string;
    object: string;
    display_chapter: number;
  }>;

  const seen = new Set<string>();
  const edges: RelationshipEdge[] = [];
  const directPairKeys = new Set<string>();
  for (const row of rows) {
    const key = [row.a_uid, row.b_uid].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    // 直接边存在性只认双 UID，与 subject 展示名解析成败无关
    directPairKeys.add(key);
    // 畸形 subject：仍占这对的直接边名额（above），但不可展示，跳过 edges.push
    const names = row.subject.split("|");
    if (names.length !== 2) continue;
    edges.push({
      aUid: row.a_uid,
      aName: names[0],
      bUid: row.b_uid,
      bName: names[1],
      state: row.object,
      displayChapter: row.display_chapter,
    });
  }
  return { edges, directPairKeys };
}

/** 各角色 uid 名下截至 asOfChapter 的有效事实条数（subject 与 subject_b 两列都算） */
export function loadFactCountByUid(
  ctx: ToolContext,
  asOfChapter: number,
): Map<string, number> {
  const rows = ctx.db
    .prepare(
      `SELECT subject_character_uid AS a_uid, subject_character_b_uid AS b_uid
         FROM facts
        WHERE novel_id = ? AND ${FACT_VALID_AT_SQL}`,
    )
    .all(ctx.novelId, asOfChapter, asOfChapter) as Array<{
    a_uid: string | null;
    b_uid: string | null;
  }>;
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.a_uid) counts.set(row.a_uid, (counts.get(row.a_uid) ?? 0) + 1);
    if (row.b_uid) counts.set(row.b_uid, (counts.get(row.b_uid) ?? 0) + 1);
  }
  return counts;
}
