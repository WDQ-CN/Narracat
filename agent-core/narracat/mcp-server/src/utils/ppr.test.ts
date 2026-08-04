/**
 * Personalized PageRank 纯算法测试 + 规模延迟实测
 *
 * 跑：cd mcp-server && npx vitest run src/utils/ppr.test.ts
 */
import { describe, expect, it } from "vitest";
import { personalizedPageRank } from "./ppr.js";

/** 由无向边列表建邻接（每条边双向 +1） */
function graphOf(edges: Array<[string, string]>): Map<string, Map<string, number>> {
  const adj = new Map<string, Map<string, number>>();
  const add = (a: string, b: string): void => {
    const m = adj.get(a) ?? new Map<string, number>();
    m.set(b, (m.get(b) ?? 0) + 1);
    adj.set(a, m);
  };
  for (const [a, b] of edges) {
    add(a, b);
    add(b, a);
  }
  return adj;
}

describe("personalizedPageRank — 纯算法", () => {
  it("种子全不在图 / 空种子 → 空 Map", () => {
    const adj = graphOf([["A", "B"]]);
    expect(personalizedPageRank(adj, ["Z"]).size).toBe(0);
    expect(personalizedPageRank(adj, []).size).toBe(0);
  });

  it("链 A-B-C-D，种子 A：得分随跳数单调衰减，2 跳的 C 仍非零", () => {
    const adj = graphOf([
      ["A", "B"],
      ["B", "C"],
      ["C", "D"],
    ]);
    const r = personalizedPageRank(adj, ["A"]);
    expect(r.get("A")!).toBeGreaterThan(r.get("B")!);
    expect(r.get("B")!).toBeGreaterThan(r.get("C")!);
    expect(r.get("C")!).toBeGreaterThan(r.get("D")!);
    // baseline 的 relationship 接口给不出 A-C（2 跳），PPR 给出非零得分
    expect(r.get("C")!).toBeGreaterThan(0);
  });

  it("交集：种子 {A,B}，同连两端的 X 得分高于只连一端的 Y/Z", () => {
    const adj = graphOf([
      ["X", "A"],
      ["X", "B"],
      ["Y", "A"],
      ["Z", "B"],
    ]);
    const r = personalizedPageRank(adj, ["A", "B"]);
    expect(r.get("X")!).toBeGreaterThan(r.get("Y")!);
    expect(r.get("X")!).toBeGreaterThan(r.get("Z")!);
  });

  it("确定性：同图同种子两次结果一致", () => {
    const adj = graphOf([
      ["A", "B"],
      ["B", "C"],
    ]);
    expect([...personalizedPageRank(adj, ["A"]).entries()]).toEqual(
      [...personalizedPageRank(adj, ["A"]).entries()],
    );
  });

  it("10 万+ 边规模延迟可接受", () => {
    const N = 50_000;
    const edges: Array<[string, string]> = [];
    for (let i = 0; i < N; i++) {
      edges.push([`n${i}`, `n${(i + 1) % N}`]); // 环边
      edges.push([`n${i}`, `n${(i + 7) % N}`]); // 跨接边 → 共 ~10 万条
    }
    const adj = graphOf(edges);
    const t0 = performance.now();
    const r = personalizedPageRank(adj, ["n0", "n12345"]);
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(
      `\n=== PPR 规模延迟实测 ===\n节点 ${adj.size} / 边 ${edges.length} 条 / 耗时 ${ms.toFixed(1)}ms\n`,
    );
    expect(r.size).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  });
});
