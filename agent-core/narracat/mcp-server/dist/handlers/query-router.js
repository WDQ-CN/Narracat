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
import { prepareNameIndex, matchCharactersInText } from "./entity-match.js";
/** 全局弧线意图词：出现即倾向「梳理整条线 / 全局走向」，应给摘要而非零碎事实 */
const ARC_INTENT_WORDS = [
    "进展", "走向", "发展历程", "脉络", "来龙去脉", "始末", "演变", "历程",
    "弧线", "主线", "整体", "全局", "纵观", "通篇", "总体", "梳理", "回顾",
];
/** 关系意图词：与角色种子配合判定多跳 / 关系查询 */
const RELATION_INTENT_WORDS = [
    "关系", "之间", "渊源", "牵连", "关联", "通过", "经由", "纠葛", "恩怨",
];
function containsAny(query, words) {
    return words.some((w) => query.includes(w));
}
/**
 * 分类查询并给出多跳种子。优先级：多角色 / 关系 → 多跳；全局意图 → 弧线；否则单点。
 *
 * @param aliasMap 角色 name→{canonical,uid} 表（loadAliasMap 产出；无角色档案时为空）
 */
export function classifyQuery(query, aliasMap) {
    const seedEntities = matchCharactersInText(query, prepareNameIndex(aliasMap));
    const hasArc = containsAny(query, ARC_INTENT_WORDS);
    const hasRelation = containsAny(query, RELATION_INTENT_WORDS);
    // 多跳：≥2 角色（关系 / 路径 / 交集），或单角色 + 显式关系意图（以该角色为种子扩展）
    if (seedEntities.length >= 2 || (seedEntities.length === 1 && hasRelation)) {
        return { route: "multi_hop", seedEntities };
    }
    // 弧线：全局走向意图，或无角色种子的关系类查询（势力间关系等，无法以角色做种子）
    if (hasArc || (hasRelation && seedEntities.length === 0)) {
        return { route: "arc", seedEntities };
    }
    return { route: "point", seedEntities };
}
