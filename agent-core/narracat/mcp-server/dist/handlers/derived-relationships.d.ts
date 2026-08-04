/**
 * 派生关系读时 2 跳共邻推导（写作上下文包专用）。
 * 只对本章 outline 角色中无直接关系边的角色对，经共同邻居推出「推断」关联；
 * 系统只把两条事实串成短句，称谓与语义判断交写手。
 */
import type { ToolContext } from "../types.js";
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
export declare function computeDerivedRelationships(args: {
    edges: RelationshipEdge[];
    chapterCharacters: ChapterCharacter[];
    factCountByUid: Map<string, number>;
    /** uid → 当前档案 canonical 名；角色改名后历史 facts.subject 是旧名，展示名优先取此映射 */
    canonicalNameByUid?: Map<string, string>;
    /** 存在有效直接边的 uid 对全集（含 subject 畸形不可展示的）；抑制判定须用它而非邻接表 */
    directPairKeys?: Set<string>;
}): string[];
/**
 * 全库截至 asOfChapter 仍有效的 relationship 边，每个角色对折叠为最新一条。
 * subject 拆出的名字仅作降级展示值（角色改名不重写历史 facts，可能是旧名）；
 * 当前档案名覆盖在 computeDerivedRelationships 的 canonicalNameByUid 层做。
 *
 * 返回值拆两层：edges 仅含 subject 可正常拆出两名的边（用于共邻搭桥展示）；
 * directPairKeys 是存在有效直接边的 uid 对全集，含 subject 畸形不可展示的对——
 * 直接边的「存在性」只应由双 UID 判定，不受展示名解析成败影响，抑制派生时必须查这张表而非 edges 的邻接关系。
 */
export declare function loadValidRelationshipEdges(ctx: ToolContext, asOfChapter: number): {
    edges: RelationshipEdge[];
    directPairKeys: Set<string>;
};
/** 各角色 uid 名下截至 asOfChapter 的有效事实条数（subject 与 subject_b 两列都算） */
export declare function loadFactCountByUid(ctx: ToolContext, asOfChapter: number): Map<string, number>;
