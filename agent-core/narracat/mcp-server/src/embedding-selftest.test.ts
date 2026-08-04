import { afterEach, describe, expect, it, vi } from "vitest";

// 真模型在测试环境不可用：用确定性 768 维「归一」假向量替身，
// 把自检的 sqlite-vec 写入 + KNN 往返跑真，模型加载/向量生成走替身。
const EMBED_DIM = 768;

function unitVector(): Float32Array {
  // 任意单位向量：仅首位为 1，L2 范数恰为 1（满足归一断言）。
  const v = new Float32Array(EMBED_DIM);
  v[0] = 1;
  return v;
}

const embedMock = vi.fn(async (_text: string) => unitVector());

vi.mock("./utils/embedding.js", () => ({
  embed: (text: string) => embedMock(text),
  getEmbeddingDim: () => EMBED_DIM,
}));

import { runEmbeddingSelfTest } from "./embedding-selftest.js";

afterEach(() => {
  embedMock.mockReset();
  embedMock.mockImplementation(async (_text: string) => unitVector());
});

describe("embedding 自检契约", () => {
  it("全链路通过：模型/向量/sqlite-vec/检索四项 ok，报告 ok=true", async () => {
    const report = await runEmbeddingSelfTest();

    expect(report.modelLoad.ok).toBe(true);
    expect(report.modelLoad.dim).toBe(EMBED_DIM);
    expect(report.embed.ok).toBe(true);
    expect(report.embed.dim).toBe(EMBED_DIM);
    expect(report.embed.normalized).toBe(true);
    expect(typeof report.embed.durationMs).toBe("number");
    expect(report.sqliteVec.ok).toBe(true);
    expect(report.retrieval.ok).toBe(true);
    expect(report.retrieval.hit).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("模型不可用（embed 返回 null）：modelLoad 失败，retrieval 不跑，报告 ok=false", async () => {
    embedMock.mockImplementation(async () => null);

    const report = await runEmbeddingSelfTest();

    expect(report.modelLoad.ok).toBe(false);
    expect(report.modelLoad.error).toContain("null");
    expect(report.embed.ok).toBe(false);
    // sqlite-vec 仍可加载（与模型无关），但检索往返因无向量被跳过
    expect(report.sqliteVec.ok).toBe(true);
    expect(report.retrieval.ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  it("向量维度异常：embed 维度不符 → embed 失败、报告 ok=false", async () => {
    embedMock.mockImplementation(async () => new Float32Array(512));

    const report = await runEmbeddingSelfTest();

    expect(report.modelLoad.ok).toBe(true);
    expect(report.embed.ok).toBe(false);
    expect(report.embed.error).toContain("维度");
    expect(report.retrieval.ok).toBe(false);
    expect(report.ok).toBe(false);
  });
});
