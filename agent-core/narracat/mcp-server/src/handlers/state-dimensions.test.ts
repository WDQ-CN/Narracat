import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStateVocabulary, attributeFact, type StateVocabulary } from "./state-dimensions.js";

const VOCAB: StateVocabulary = {
  dimensions: [
    { key: "cultivation_level", predicate: "ability", display_name: "境界", cardinality: "one", value_type: "enum", values: ["练气", "筑基", "金丹"] },
    { key: "skills", predicate: "ability", display_name: "功法", cardinality: "many", value_type: "free" },
    { key: "inventory", predicate: "possession", display_name: "持有物", cardinality: "many", value_type: "free" },
  ],
};

describe("attributeFact", () => {
  it("enum 维度按值域认领", () => {
    expect(attributeFact(VOCAB, "ability", "金丹")?.key).toBe("cultivation_level");
  });
  it("同谓词值域外由 many 维度兜底认领", () => {
    expect(attributeFact(VOCAB, "ability", "青莲剑法")?.key).toBe("skills");
  });
  it("无维度认领返回 null（落其他区）", () => {
    expect(attributeFact(VOCAB, "goal", "报仇")).toBeNull();
  });
});

describe("loadStateVocabulary", () => {
  it("读合法词表；缺文件/坏 JSON 返回 null 不抛", () => {
    const root = mkdtempSync(join(tmpdir(), "vocab-"));
    expect(loadStateVocabulary(root)).toBeNull();
    mkdirSync(join(root, "bible"), { recursive: true });
    writeFileSync(join(root, "bible", "state-vocabulary.json"), JSON.stringify(VOCAB.dimensions ? { dimensions: VOCAB.dimensions } : {}), "utf-8");
    expect(loadStateVocabulary(root)?.dimensions).toHaveLength(3);
    writeFileSync(join(root, "bible", "state-vocabulary.json"), "{broken", "utf-8");
    expect(loadStateVocabulary(root)).toBeNull();
  });
});
