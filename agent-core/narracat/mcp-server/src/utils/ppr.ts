/**
 * Personalized PageRank（重启随机游走）
 *
 * 纯内存、纯算法，无外部图库（不引入 graphology / FalkorDB 等）。
 * 在 facts 实体图上以查询命中的种子角色为重启点扩散，得到「与种子多跳相关」
 * 的实体稳态得分——单点检索一次走不到的 ≥2 跳关系 / 交集，由扩散一次答出。
 *
 * r_{t+1}(v) = (1-α)·p(v) + α·Σ_{u~v} r_t(u)·w(u,v)/Σw(u,·)
 *   p = 种子上的均匀重启分布；α = 沿边继续游走的概率（越大走得越远）。
 */

export interface PageRankOptions {
  /** 沿边继续游走的概率（1-α = 重启回种子）。默认 0.5：偏向种子近邻的连接者 */
  alpha?: number;
  /** 最大迭代轮数。默认 30 */
  iterations?: number;
  /** L1 收敛阈值，相邻两轮变化小于它即停。默认 1e-6 */
  tolerance?: number;
}

/**
 * @param adjacency 无向图邻接：node → (neighbor → weight)
 * @param seeds 重启种子节点（不在图中的种子被忽略）
 * @returns node → 稳态得分；种子全不在图或图为空时返回空 Map
 */
export function personalizedPageRank(
  adjacency: Map<string, Map<string, number>>,
  seeds: string[],
  opts: PageRankOptions = {},
): Map<string, number> {
  const alpha = opts.alpha ?? 0.5;
  const maxIter = opts.iterations ?? 30;
  const tolerance = opts.tolerance ?? 1e-6;

  const validSeeds = [...new Set(seeds)].filter((s) => adjacency.has(s));
  if (validSeeds.length === 0) return new Map();

  // 重启分布 p：种子上均匀
  const restart = new Map<string, number>();
  const seedMass = 1 / validSeeds.length;
  for (const s of validSeeds) restart.set(s, seedMass);

  // 每个节点的邻边权和（无向图的「出度」），用于转移归一
  const weightSum = new Map<string, number>();
  for (const [node, nbrs] of adjacency) {
    let sum = 0;
    for (const w of nbrs.values()) sum += w;
    weightSum.set(node, sum);
  }

  let rank = new Map<string, number>(restart);
  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Map<string, number>();
    // 重启项 (1-α)·p
    for (const [s, val] of restart) next.set(s, (1 - alpha) * val);
    // 传播项 α·Σ 入邻贡献
    for (const [u, ru] of rank) {
      if (ru === 0) continue;
      const nbrs = adjacency.get(u);
      const total = weightSum.get(u) ?? 0;
      if (!nbrs || total === 0) continue;
      const flow = (alpha * ru) / total;
      for (const [v, w] of nbrs) {
        next.set(v, (next.get(v) ?? 0) + flow * w);
      }
    }
    // 收敛判定
    let diff = 0;
    for (const k of new Set([...rank.keys(), ...next.keys()])) {
      diff += Math.abs((next.get(k) ?? 0) - (rank.get(k) ?? 0));
    }
    rank = next;
    if (diff < tolerance) break;
  }
  return rank;
}
