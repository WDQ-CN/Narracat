/**
 * 文本中的角色名匹配（最长非重叠）
 *
 * query-router（分类种子）与 entity-graph（建图隐式边）共用：在一段文本里找出
 * 提及的已知角色，按 canonical 去重。名字互为前缀 / 包含时（如「林晚」/「林晚晴」），
 * 优先最长名，且已匹配区间不再被更短名重复命中——避免「林晚晴」误命中「林晚」、
 * 把单点查询误判成多跳、或在 object 上凭空连出错边。
 */
/** 单字名在长句里太易误匹配，要求实体名 ≥2 字才参与匹配 */
const MIN_NAME_LEN = 2;
/** 预备最长优先的角色名索引（≥2 字，按长度降序）；建图时预备一次、循环复用 */
export function prepareNameIndex(aliasMap) {
    return [...aliasMap.entries()]
        .filter(([name]) => name.length >= MIN_NAME_LEN)
        .map(([name, resolved]) => ({ name, resolved }))
        .sort((a, b) => b.name.length - a.name.length);
}
/**
 * 最长非重叠匹配：返回文本里提及的角色（按 canonical 去重）。
 * nameIndex 须按名长度降序（用 prepareNameIndex 预备），以保证最长名优先占位。
 */
export function matchCharactersInText(text, nameIndex) {
    const occupied = new Array(text.length).fill(false);
    const byCanonical = new Map();
    for (const { name, resolved } of nameIndex) {
        let from = 0;
        for (;;) {
            const idx = text.indexOf(name, from);
            if (idx === -1)
                break;
            let free = true;
            for (let i = idx; i < idx + name.length; i++) {
                if (occupied[i]) {
                    free = false;
                    break;
                }
            }
            if (free) {
                for (let i = idx; i < idx + name.length; i++)
                    occupied[i] = true;
                if (!byCanonical.has(resolved.canonical)) {
                    byCanonical.set(resolved.canonical, resolved);
                }
            }
            from = idx + 1; // 继续找下一处出现（同名多次出现按 canonical 去重）
        }
    }
    return [...byCanonical.values()];
}
