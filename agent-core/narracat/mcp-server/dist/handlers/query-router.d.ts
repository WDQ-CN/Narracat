/**
 * 查询类型路由器
 *
 * 检索前对自然语言查询做纯代码启发式分类，按形态分流到不同检索机制：
 *   - point     单点事实  → 混合检索（FTS + 向量，现状）
 *   - arc       全局弧线  → 摘要类来源（卷 / 弧 / 章摘要），不返回零碎事实
 *   - multi_hop 跨角色多跳 → 以命中角色为种子的多跳召回（当前降级为多查询混合检索，
 *               种子实体与接口签名为后续图多跳引擎预留）
 *
 * 纪律：分类全部由代码可算特征决定（命中的已知角色数 + 意图词），不调用 LLM。
 * 没有单一检索两头通吃——单点事实纯混合检索更准，全局弧线要摘要不要碎片，
 * 跨角色关系要顺边多跳；轻量路由让每类查询走最合适的一条路。
 */
import type { ResolvedCharacter } from "./alias-map.js";
export type QueryRoute = "point" | "arc" | "multi_hop";
export interface QueryClassification {
    route: QueryRoute;
    /** 查询命中的已知角色（按 canonical 去重），multi_hop 的多跳种子 */
    seedEntities: ResolvedCharacter[];
}
/**
 * 分类查询并给出多跳种子。优先级：多角色 / 关系 → 多跳；全局意图 → 弧线；否则单点。
 *
 * @param aliasMap 角色 name→{canonical,uid} 表（loadAliasMap 产出；无角色档案时为空）
 */
export declare function classifyQuery(query: string, aliasMap: Map<string, ResolvedCharacter>): QueryClassification;
