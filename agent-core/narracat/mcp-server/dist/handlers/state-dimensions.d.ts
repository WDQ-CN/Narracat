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
export declare const STATE_VOCABULARY_RELPATH: string;
export declare function loadStateVocabulary(projectRoot: string): StateVocabulary | null;
export declare function attributeFact(vocab: StateVocabulary, predicate: string, object: string): StateDimension | null;
