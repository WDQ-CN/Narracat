import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../migrate.js";
import {
  foldCharacterCard,
  renderCardHumanMap,
  isEmptyFoldedCard,
  readPredicateFromCard,
  dedupeCardExtras,
  type FoldedCardV2,
} from "./character-card-fold.js";
import type { ToolContext } from "../types.js";
import type { StateVocabulary } from "./state-dimensions.js";

const UID = "11111111-1111-4111-8111-111111111111";

function makeCtx(withVocab: boolean): ToolContext {
  const db = new Database(":memory:");
  initSchema(db);
  const root = mkdtempSync(join(tmpdir(), "fold-"));
  if (withVocab) {
    mkdirSync(join(root, "bible"), { recursive: true });
    writeFileSync(
      join(root, "bible", "state-vocabulary.json"),
      JSON.stringify({
        dimensions: [
          { key: "cultivation_level", predicate: "ability", display_name: "境界", cardinality: "one", value_type: "enum", values: ["练气", "筑基", "金丹"] },
          { key: "inventory", predicate: "possession", display_name: "持有物", cardinality: "many", value_type: "free" },
        ],
      }),
      "utf-8",
    );
  }
  return { novelId: "n1", db, projectRoot: root } as ToolContext;
}

function insertFact(ctx: ToolContext, id: string, predicate: string, object: string, fromChapter: number): void {
  ctx.db
    .prepare(
      `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, from_chapter, event_chapter)
       VALUES (?, 'n1', '苏见', ?, ?, ?, ?, ?)`,
    )
    .run(id, UID, predicate, object, fromChapter, fromChapter);
}

describe("foldCharacterCard 维度折叠", () => {
  let ctx: ToolContext;
  beforeEach(() => {
    ctx = makeCtx(true);
    insertFact(ctx, "f1", "ability", "练气", 1);
    insertFact(ctx, "f2", "ability", "金丹", 13);
    insertFact(ctx, "f3", "possession", "短刀", 5);
    insertFact(ctx, "f4", "possession", "令牌", 9);
    insertFact(ctx, "f5", "goal", "报仇", 2);
  });

  it("one 维度取值域内最新值，many 维度全收，其他区兜底", () => {
    const card = foldCharacterCard(ctx, UID, 20);
    expect(card).toMatchObject({
      _v: 2,
      dimensions: {
        cultivation_level: { display_name: "境界", value: "金丹" },
        inventory: { display_name: "持有物", values: ["令牌", "短刀"] },
      },
      extras: { goal: ["报仇"] },
    });
  });

  it("renderCardHumanMap 输出人读键值（many 用、连接）", () => {
    const flat = renderCardHumanMap(foldCharacterCard(ctx, UID, 20));
    expect(flat["境界"]).toBe("金丹");
    expect(flat["持有物"]).toBe("令牌、短刀");
    expect(flat["goal"]).toBe("报仇");
  });

  it("无词表回退旧扁平折叠（每谓词最新值，零回归）", () => {
    const legacyCtx = makeCtx(false);
    insertFact(legacyCtx, "f1", "ability", "练气", 1);
    insertFact(legacyCtx, "f2", "ability", "金丹", 13);
    const card = foldCharacterCard(legacyCtx, UID, 20);
    expect(card).toEqual({ ability: "金丹" });
  });

  it("one 维度语义：同谓词最新 fact 值域外 → 取次新的值域内值，值域外值落 extras", () => {
    // 词表只有 cultivation_level（predicate=ability，enum 值域 练气/筑基/金丹，无同谓词 free 维度）
    const root = mkdtempSync(join(tmpdir(), "fold-onedim-"));
    mkdirSync(join(root, "bible"), { recursive: true });
    writeFileSync(
      join(root, "bible", "state-vocabulary.json"),
      JSON.stringify({
        dimensions: [
          { key: "cultivation_level", predicate: "ability", display_name: "境界", cardinality: "one", value_type: "enum", values: ["练气", "筑基", "金丹"] },
        ],
      }),
      "utf-8",
    );
    const db = new Database(":memory:");
    initSchema(db);
    const onlyDimCtx = { novelId: "n1", db, projectRoot: root } as ToolContext;
    insertFact(onlyDimCtx, "f1", "ability", "练气", 1);
    insertFact(onlyDimCtx, "f2", "ability", "金丹", 13);
    insertFact(onlyDimCtx, "f3", "ability", "青莲剑法", 15); // 值域外，最新

    const card = foldCharacterCard(onlyDimCtx, UID, 20);
    expect(card).toMatchObject({
      _v: 2,
      dimensions: {
        cultivation_level: { display_name: "境界", value: "金丹" },
      },
      extras: { ability: ["青莲剑法"] },
    });
  });
});

describe("foldCharacterCard 槽形冲突防御（同 key 被不同 cardinality 维度占用，PR#452评审P2-C 折叠层兜底）", () => {
  // 入口新加的机械语义校验（checkStateVocabularySemantics）已挡新提交撞 key，
  // 但存量词表文件 / 其他写路径仍可能已经写出这种数据——折叠层须兜底不崩溃，而非入口校验之外
  // 再无第二道防线。这里直接手写词表文件模拟该异常状态。
  it("one 维度先占槽：撞 key 的 many 维度的行被跳过，不抛 TypeError", () => {
    const root = mkdtempSync(join(tmpdir(), "fold-slotclash-"));
    mkdirSync(join(root, "bible"), { recursive: true });
    writeFileSync(
      join(root, "bible", "state-vocabulary.json"),
      JSON.stringify({
        dimensions: [
          { key: "state", predicate: "ability", display_name: "境界", cardinality: "one", value_type: "enum", values: ["练气", "筑基"] },
          { key: "state", predicate: "possession", display_name: "持有物", cardinality: "many", value_type: "free" },
        ],
      }),
      "utf-8",
    );
    const db = new Database(":memory:");
    initSchema(db);
    const ctx = { novelId: "n1", db, projectRoot: root } as ToolContext;
    insertFact(ctx, "f1", "ability", "练气", 1); // predicate ASC：ability 先处理 → 占 "one" 形槽
    insertFact(ctx, "f2", "possession", "短刀", 2); // 后处理的 many 维度撞 key，槽已是 "one" 形

    expect(() => foldCharacterCard(ctx, UID, 20)).not.toThrow();
    const card = foldCharacterCard(ctx, UID, 20) as FoldedCardV2;
    expect(card.dimensions.state).toMatchObject({ display_name: "境界", value: "练气" });
    // possession 的行被跳过（槽形冲突防御）：既没崩溃也没污染 one 形槽
    expect(card.dimensions.state).not.toHaveProperty("values");
  });

  it("many 维度先占槽：撞 key 的 one 维度的行被跳过，不抛 TypeError", () => {
    const root = mkdtempSync(join(tmpdir(), "fold-slotclash-rev-"));
    mkdirSync(join(root, "bible"), { recursive: true });
    writeFileSync(
      join(root, "bible", "state-vocabulary.json"),
      JSON.stringify({
        dimensions: [
          { key: "state", predicate: "identity", display_name: "身份", cardinality: "many", value_type: "free" },
          { key: "state", predicate: "location", display_name: "境界", cardinality: "one", value_type: "enum", values: ["练气", "筑基"] },
        ],
      }),
      "utf-8",
    );
    const db = new Database(":memory:");
    initSchema(db);
    const ctx = { novelId: "n1", db, projectRoot: root } as ToolContext;
    insertFact(ctx, "f1", "identity", "散修", 1); // predicate ASC：identity 先处理 → 占 "many" 形槽
    insertFact(ctx, "f2", "location", "练气", 2); // 后处理的 one 维度撞 key，槽已是 "many" 形

    expect(() => foldCharacterCard(ctx, UID, 20)).not.toThrow();
    const card = foldCharacterCard(ctx, UID, 20) as FoldedCardV2;
    expect(card.dimensions.state).toMatchObject({ display_name: "身份", values: ["散修"] });
    expect(card.dimensions.state).not.toHaveProperty("value");
  });
});

describe("isEmptyFoldedCard", () => {
  it("v1 空扁平卡判空", () => {
    expect(isEmptyFoldedCard({})).toBe(true);
    expect(isEmptyFoldedCard({ ability: "练气" })).toBe(false);
  });

  it("v2 卡即使无事实，_v/dimensions/extras 三键恒在——须按内容判空，不能按顶层 key 数判空", () => {
    const withVocabNoFacts = makeCtx(true);
    const card = foldCharacterCard(withVocabNoFacts, UID, 20);
    expect(isEmptyFoldedCard(card)).toBe(true);
  });

  it("v2 卡有任意维度或 extras 内容即非空", () => {
    const ctx2 = makeCtx(true);
    insertFact(ctx2, "f1", "ability", "练气", 1);
    const card = foldCharacterCard(ctx2, UID, 20);
    expect(isEmptyFoldedCard(card)).toBe(false);
  });
});

describe("readPredicateFromCard 谓词直查（词表改名回归防护）", () => {
  it("新折叠卡的维度槽内含 predicate 字段", () => {
    const ctx = makeCtx(true);
    insertFact(ctx, "f1", "ability", "练气", 1);
    const card = foldCharacterCard(ctx, UID, 20) as FoldedCardV2;
    expect(card.dimensions.cultivation_level.predicate).toBe("ability");
  });

  it("旧 v2 历史卡（槽无 predicate）+ 词表已改显示名 → 回退路径查不到，优雅返回 null", () => {
    const legacyCard: FoldedCardV2 = {
      _v: 2,
      dimensions: {
        cultivation_level: { display_name: "境界", value: "金丹" }, // 无 predicate，模拟旧卡
      },
      extras: {},
    };
    const renamedVocab: StateVocabulary = {
      dimensions: [
        {
          key: "cultivation_level",
          predicate: "ability",
          display_name: "修为层级", // 显示名已改，与旧卡存的「境界」对不上
          cardinality: "one",
          value_type: "enum",
          values: ["练气", "筑基", "金丹"],
        },
      ],
    };
    expect(readPredicateFromCard(legacyCard, "ability", renamedVocab)).toBeNull();
  });

  it("新卡（槽内含 predicate）在词表改名后仍能按谓词直查到值", () => {
    const newCard: FoldedCardV2 = {
      _v: 2,
      dimensions: {
        cultivation_level: { display_name: "境界", predicate: "ability", value: "金丹" },
      },
      extras: {},
    };
    const renamedVocab: StateVocabulary = {
      dimensions: [
        {
          key: "cultivation_level",
          predicate: "ability",
          display_name: "修为层级", // 显示名已改，但槽内 predicate 不受影响
          cardinality: "one",
          value_type: "enum",
          values: ["练气", "筑基", "金丹"],
        },
      ],
    };
    expect(readPredicateFromCard(newCard, "ability", renamedVocab)).toBe("金丹");
  });
});

describe("dedupeCardExtras — 同卡扩展字段去重（spec §4.1 P3）", () => {
  it("值互为子串的谓词只保留信息量大的一条", () => {
    const out = dedupeCardExtras({
      "x-habit": ["面朝东偏北"],
      "x-observation": ["发现自己在两次摆摊中最终都面朝东偏北方向，身体比脑子先认准了坐标"],
      "x-superstition": ["面朝东偏北——两次摆摊最后都会转到这个方向"],
      "goal": ["让顾清寒帮忙招人"],
    });
    expect(Object.keys(out).sort()).toEqual(["goal", "x-observation", "x-superstition"]);
    // x-habit 的值是 x-observation 值的子串 → 丢；x-superstition 与二者互不为子串 → 留
  });
  it("norm 相等时保留谓词名字典序小的", () => {
    const out = dedupeCardExtras({ "x-b": ["同一句话。"], "x-a": ["同一句话"] });
    expect(Object.keys(out)).toEqual(["x-a"]);
  });
  it("去重后超过 8 条按插入顺序保留最后 8 条（无 recency，向后兼容旧行为）", () => {
    const extras = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`x-k${i}`, [`独立值${i}甲乙丙丁`]]),
    );
    expect(Object.keys(dedupeCardExtras(extras))).toEqual(
      Array.from({ length: 8 }, (_, i) => `x-k${i + 2}`),
    );
  });

  it("有 recency 时按章号降序保留最新 8 个，不按字典序插入序丢最新事实（PR#502 人审 R1）", () => {
    // 字典序与章号刻意反向：x-a 章 10（最新）… x-j 章 1（最旧）。
    // 旧行为（按插入序=字典序取最后 8 个）会丢 x-a/x-b（章号最大、最新）；
    // 修复后应丢 x-i/x-j（章号最小、最旧）。
    const letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const extras: Record<string, string[]> = {};
    const recency: Record<string, number> = {};
    letters.forEach((letter, idx) => {
      const predicate = `x-${letter}`;
      extras[predicate] = [`独有事实内容${letter}标记`];
      recency[predicate] = 10 - idx; // x-a→10, x-b→9, ..., x-j→1
    });

    const out = dedupeCardExtras(extras, recency);
    expect(Object.keys(out)).toEqual(["x-a", "x-b", "x-c", "x-d", "x-e", "x-f", "x-g", "x-h"]);
    expect(Object.keys(out)).not.toContain("x-i");
    expect(Object.keys(out)).not.toContain("x-j");
  });
});

describe("foldCharacterCard + renderCardHumanMap — extras 新者优先端到端（PR#502 人审 R1）", () => {
  it("v2 折叠为每个 extras 谓词记录最新事实章号，渲染时新鲜事实不被字典序旧谓词挤掉", () => {
    const ctx = makeCtx(true);
    // 10 个词表外谓词（进 extras），字典序与写入章号刻意反向：
    // x-extra-a 是最新事实（章 20），x-extra-j 是最旧（章 2）——内容彼此不为子串。
    const letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    letters.forEach((letter, idx) => {
      insertFact(ctx, `extra-${letter}`, `x-extra-${letter}`, `独有观察内容${letter}标记`, 20 - idx * 2);
    });

    const card = foldCharacterCard(ctx, UID, 30) as FoldedCardV2;
    expect(card.extrasChapter?.["x-extra-a"]).toBe(20);
    expect(card.extrasChapter?.["x-extra-j"]).toBe(2);

    const flat = renderCardHumanMap(card);
    // 最新的 8 个（extra-a..extra-h）应保留，最旧的两个（extra-i/extra-j）该被截断丢弃
    for (const letter of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      expect(flat).toHaveProperty(`x-extra-${letter}`);
    }
    expect(flat).not.toHaveProperty("x-extra-i");
    expect(flat).not.toHaveProperty("x-extra-j");
  });
});
