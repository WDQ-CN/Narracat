import { describe, it, expect } from "vitest";
import { validatePackManifest, PACK_FORMAT_VERSION } from "./pack-manifest.js";

const validManifest = {
  pack_format_version: PACK_FORMAT_VERSION,
  id: "my-pack",
  name: "测试包",
  author: "tester",
  version: "1.0.0",
  cards: [
    { type: "persona", path: "cards/p.md", id: "p1", name: "卡一", keywords: ["冷"] },
    { type: "craft", path: "cards/c.md", id: "c1", triggers: ["危机"], beat_types: ["action"],
      technique_tags: ["动作细节"], emotion_tags: ["紧张"], exclusions: [], priority: 2 },
    { type: "structure", path: "cards/s.md", id: "s1", dimension: "D1", stage: "stage-1", one_line: "一句话" },
  ],
};

describe("validatePackManifest", () => {
  it("合法 manifest → manifest 非空且无 errors", () => {
    const r = validatePackManifest(validManifest);
    expect(r.errors).toEqual([]);
    expect(r.manifest?.cards).toHaveLength(3);
  });

  it("缺署名 → fail-loud", () => {
    const r = validatePackManifest({ ...validManifest, author: "" });
    expect(r.manifest).toBeNull();
    expect(r.errors.join()).toContain("author");
  });

  it("格式号不支持 → fail-loud", () => {
    const r = validatePackManifest({ ...validManifest, pack_format_version: 99 });
    expect(r.manifest).toBeNull();
  });

  it("未知卡类型 → warning 跳过该卡，其余保留（前向兼容）", () => {
    const r = validatePackManifest({
      ...validManifest,
      cards: [...validManifest.cards, { type: "hologram", path: "cards/h.bin", id: "h1" }],
    });
    expect(r.errors).toEqual([]);
    expect(r.manifest?.cards).toHaveLength(3);
    expect(r.warnings.join()).toContain("hologram");
  });

  it("structure 卡 stage 非法 → fail-loud", () => {
    const r = validatePackManifest({
      ...validManifest,
      cards: [{ type: "structure", path: "cards/s.md", id: "s1", dimension: "D1", stage: "stage-9", one_line: "x" }],
    });
    expect(r.manifest).toBeNull();
  });

  it("v1.1 可选字段透传，非法类型忽略", () => {
    const r = validatePackManifest({ ...validManifest, min_engine_version: "4.0.132", changelog: "首版", publisher_id: 42 });
    expect(r.errors).toEqual([]);
    expect(r.manifest?.min_engine_version).toBe("4.0.132");
    expect(r.manifest?.changelog).toBe("首版");
    expect(r.manifest?.publisher_id).toBeUndefined();
  });

  it("id 含路径穿越片段（如「../evil」）→ fail-loud（终审 Critical：id 直接拼进 `<id>@<version>` 磁盘路径）", () => {
    const r = validatePackManifest({ ...validManifest, id: "../evil" });
    expect(r.manifest).toBeNull();
    expect(r.errors.join()).toContain("非法字符");
  });

  it("version 非合法 SemVer（如「banana」）→ fail-loud", () => {
    const r = validatePackManifest({ ...validManifest, version: "banana" });
    expect(r.manifest).toBeNull();
    expect(r.errors.join()).toContain("SemVer");
  });

  it("version 带 build metadata（+）→ fail-loud（目录名不安全，刻意不支持）", () => {
    const r = validatePackManifest({ ...validManifest, version: "1.0.0+build.1" });
    expect(r.manifest).toBeNull();
    expect(r.errors.join()).toContain("SemVer");
  });

  it("version 带合法预发布标识（1.0.0-beta.1）→ 通过", () => {
    const r = validatePackManifest({ ...validManifest, version: "1.0.0-beta.1" });
    expect(r.errors).toEqual([]);
    expect(r.manifest?.version).toBe("1.0.0-beta.1");
  });

  it("同 id 卡在包内重复 → fail-loud（防 top-N 预算被同 id 卡吃掉/回执无法归因）", () => {
    const r = validatePackManifest({
      ...validManifest,
      cards: [
        { type: "persona", path: "cards/p.md", id: "p1", name: "卡一", keywords: ["冷"] },
        { type: "structure", path: "cards/s.md", id: "p1", dimension: "D1", stage: "stage-1", one_line: "一句话" },
      ],
    });
    expect(r.manifest).toBeNull();
    expect(r.errors.join()).toContain("重复");
  });

  it("未知顶层字段与已声明可选字段（license）、未知卡字段均不报错（权利元数据向后兼容，ADR-0034）", () => {
    const r = validatePackManifest({
      ...validManifest,
      content_hash: "abc",
      license: "free-use",
      cards: [{ ...validManifest.cards[2], extra: "x" }],
    });
    expect(r.errors).toEqual([]);
    expect(r.manifest?.cards).toHaveLength(1);
  });

  it("跳过的未知类型卡不参与 id 唯一性判定", () => {
    const r = validatePackManifest({
      ...validManifest,
      cards: [
        { type: "persona", path: "cards/p.md", id: "dup", name: "卡一", keywords: ["冷"] },
        { type: "hologram", path: "cards/h.bin", id: "dup" },
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.manifest?.cards).toHaveLength(1);
  });
});
