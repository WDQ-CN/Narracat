/**
 * facts 实体图构建（HippoRAG 思路，纯算法、无外部图库）
 *
 * 把 facts 重组成「角色实体为节点、facts 为边」的无向图，供 Personalized PageRank
 * 多跳召回。两类边来源：
 *   - relationship fact：subject_character_uid ↔ subject_character_b_uid（结构化双端）
 *   - 其他 fact：subject_character_uid → object 文本里提及的已知角色（debt/oath 等
 *     谓词的「另一端」藏在散文里，靠角色名匹配补出隐式边）
 *
 * 同时记录每个实体关联的 fact id，供 PPR 排名后按实体得分聚合回 facts。
 */
import { prepareNameIndex, matchCharactersInText } from "./entity-match.js";
export function buildEntityGraph(facts, aliasMap) {
    // 最长优先的角色名索引，循环复用（object 文本匹配用最长非重叠，避免子串误连）
    const nameIndex = prepareNameIndex(aliasMap);
    const adjacency = new Map();
    const factsByEntity = new Map();
    const touch = (uid, factId) => {
        let s = factsByEntity.get(uid);
        if (!s) {
            s = new Set();
            factsByEntity.set(uid, s);
        }
        s.add(factId);
        if (!adjacency.has(uid))
            adjacency.set(uid, new Map());
    };
    const addEdge = (a, b, weight) => {
        if (a === b)
            return;
        for (const [x, y] of [
            [a, b],
            [b, a],
        ]) {
            const m = adjacency.get(x) ?? new Map();
            m.set(y, (m.get(y) ?? 0) + weight);
            adjacency.set(x, m);
        }
    };
    for (const f of facts) {
        const a = f.subject_character_uid;
        if (!a)
            continue; // 无 subject uid（非角色 subject）暂不入图
        touch(a, f.id);
        if (f.predicate === "relationship" && f.subject_character_b_uid) {
            touch(f.subject_character_b_uid, f.id);
            addEdge(a, f.subject_character_b_uid, 1);
            continue;
        }
        // 非关系 fact：与 object 文本里提及的其他角色建隐式边（最长非重叠匹配，避免子串误连）
        for (const other of matchCharactersInText(f.object, nameIndex)) {
            const otherUid = other.uid;
            if (!otherUid || otherUid === a)
                continue;
            touch(otherUid, f.id);
            addEdge(a, otherUid, 1);
        }
    }
    return { adjacency, factsByEntity };
}
