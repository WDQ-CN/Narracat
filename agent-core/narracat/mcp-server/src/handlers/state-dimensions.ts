/**
 * 状态维度：词表加载与 fact→维度机械归属（读侧共享，纯函数无写操作）
 *
 * 归属规则（顺序即优先级）：
 * 1. 同谓词的 enum 维度按「object ∈ values」认领（值域即身份）；
 * 2. 同谓词的 free 维度按声明顺序兜底认领；
 * 3. 归不进任何维度 → null，调用方落「其他」区按原谓词展示（fail-safe 不丢数据）。
 *
 * 读侧宽容：词表缺失/损坏返回 null（调用方回退旧行为），写侧严格校验在 validators.ts。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface StateDimension {
  key: string;
  predicate: string;
  display_name: string;
  cardinality: "one" | "many";
  value_type: "enum" | "free";
  values?: string[];
}

export interface StateVocabulary {
  dimensions: StateDimension[];
}

export const STATE_VOCABULARY_RELPATH = join("bible", "state-vocabulary.json");

export function loadStateVocabulary(projectRoot: string): StateVocabulary | null {
  try {
    const raw = readFileSync(join(projectRoot, STATE_VOCABULARY_RELPATH), "utf-8");
    const parsed = JSON.parse(raw) as { dimensions?: unknown };
    if (!Array.isArray(parsed.dimensions) || parsed.dimensions.length === 0) return null;
    return parsed as StateVocabulary;
  } catch {
    return null;
  }
}

export function attributeFact(
  vocab: StateVocabulary,
  predicate: string,
  object: string,
): StateDimension | null {
  const samePredicate = vocab.dimensions.filter((d) => d.predicate === predicate);
  for (const dim of samePredicate) {
    if (dim.value_type === "enum" && dim.values?.includes(object)) return dim;
  }
  return samePredicate.find((d) => d.value_type === "free") ?? null;
}
