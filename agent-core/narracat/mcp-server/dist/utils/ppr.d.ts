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
export declare function personalizedPageRank(adjacency: Map<string, Map<string, number>>, seeds: string[], opts?: PageRankOptions): Map<string, number>;
