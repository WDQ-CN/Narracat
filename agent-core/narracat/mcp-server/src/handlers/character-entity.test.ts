import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../migrate.js";
import { novelSubmitStateVocabulary, novelSubmitCharacterEntity } from "./character-entity.js";
import { CHARACTER_IDENTITY_RE } from "./alias-map.js";
import { refreshCharacterCards } from "./writers.js";
import type { ToolContext } from "../types.js";

function makeCtx(): ToolContext {
  const db = new Database(":memory:");
  initSchema(db);
  return { novelId: "n1", db, projectRoot: mkdtempSync(join(tmpdir(), "vocab-tool-")) } as ToolContext;
}

const PAYLOAD = {
  dimensions: [
    {
      key: "cultivation_level",
      predicate: "ability",
      display_name: "境界",
      cardinality: "one",
      value_type: "enum",
      values: ["练气", "筑基", "金丹"],
    },
  ],
};

describe("novel_submit_state_vocabulary", () => {
  it("合法词表落盘 bible/state-vocabulary.json", async () => {
    const ctx = makeCtx();
    const result = (await novelSubmitStateVocabulary({ payload: PAYLOAD }, ctx)) as { ok: boolean };
    expect(result.ok).toBe(true);
    const file = join(ctx.projectRoot, "bible", "state-vocabulary.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf-8")).dimensions).toHaveLength(1);
  });

  it("非法 payload 返回 errors 不落盘", async () => {
    const ctx = makeCtx();
    const result = (await novelSubmitStateVocabulary({ payload: { dimensions: [] } }, ctx)) as {
      ok: boolean;
    };
    expect(result.ok).toBe(false);
    expect(existsSync(join(ctx.projectRoot, "bible", "state-vocabulary.json"))).toBe(false);
  });

  // 机械语义校验（PR#452评审P2-C）：ajv 通过后追加，撞名/歧义类问题结构上都合法但语义非法
  describe("机械语义校验（PR#452评审P2-C）", () => {
    it("两维度共用 key（评审实测场景）：ok:false 不落盘", async () => {
      const ctx = makeCtx();
      const result = (await novelSubmitStateVocabulary(
        {
          payload: {
            dimensions: [
              { key: "state", predicate: "ability", display_name: "境界", cardinality: "one", value_type: "enum", values: ["练气", "筑基"] },
              { key: "state", predicate: "status", display_name: "生死", cardinality: "one", value_type: "enum", values: ["存活", "死亡"] },
            ],
          },
        },
        ctx,
      )) as { ok: boolean; errors: Array<{ field: string; hint: string }> };

      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.field === "dimensions[].key")).toBe(true);
      expect(existsSync(join(ctx.projectRoot, "bible", "state-vocabulary.json"))).toBe(false);
    });

    it("display_name 重复：ok:false 不落盘", async () => {
      const ctx = makeCtx();
      const result = (await novelSubmitStateVocabulary(
        {
          payload: {
            dimensions: [
              { key: "cultivation_level", predicate: "ability", display_name: "境界", cardinality: "one", value_type: "enum", values: ["练气", "筑基"] },
              { key: "life_status", predicate: "status", display_name: "境界", cardinality: "one", value_type: "enum", values: ["存活", "死亡"] },
            ],
          },
        },
        ctx,
      )) as { ok: boolean; errors: Array<{ field: string }> };

      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.field === "dimensions[].display_name")).toBe(true);
    });

    it("同谓词两个 free 维度：ok:false 不落盘", async () => {
      const ctx = makeCtx();
      const result = (await novelSubmitStateVocabulary(
        {
          payload: {
            dimensions: [
              { key: "inventory", predicate: "possession", display_name: "持有物", cardinality: "many", value_type: "free" },
              { key: "treasures", predicate: "possession", display_name: "宝物", cardinality: "many", value_type: "free" },
            ],
          },
        },
        ctx,
      )) as { ok: boolean; errors: Array<{ field: string }> };

      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.field === "dimensions[].value_type")).toBe(true);
    });

    it("同谓词 enum 维度值域相交：ok:false 不落盘", async () => {
      const ctx = makeCtx();
      const result = (await novelSubmitStateVocabulary(
        {
          payload: {
            dimensions: [
              { key: "cultivation_level", predicate: "ability", display_name: "境界", cardinality: "one", value_type: "enum", values: ["练气", "筑基", "金丹"] },
              { key: "combat_rank", predicate: "ability", display_name: "战力段位", cardinality: "one", value_type: "enum", values: ["金丹", "元婴"] },
            ],
          },
        },
        ctx,
      )) as { ok: boolean; errors: Array<{ field: string; hint: string }> };

      expect(result.ok).toBe(false);
      const err = result.errors.find((e) => e.field === "dimensions[].values");
      expect(err).toBeDefined();
      expect(err?.hint).toContain("金丹");
    });

    it("合法多维度（不同 key/display_name/predicate 隔离）：通过并落盘", async () => {
      const ctx = makeCtx();
      const result = (await novelSubmitStateVocabulary(
        {
          payload: {
            dimensions: [
              { key: "cultivation_level", predicate: "ability", display_name: "境界", cardinality: "one", value_type: "enum", values: ["练气", "筑基"] },
              { key: "life_status", predicate: "status", display_name: "生死", cardinality: "one", value_type: "enum", values: ["存活", "死亡"] },
              { key: "inventory", predicate: "possession", display_name: "持有物", cardinality: "many", value_type: "free" },
            ],
          },
        },
        ctx,
      )) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(existsSync(join(ctx.projectRoot, "bible", "state-vocabulary.json"))).toBe(true);
    });
  });
});

async function submitVocab(ctx: ToolContext): Promise<void> {
  await novelSubmitStateVocabulary(
    {
      payload: {
        dimensions: [
          { key: "cultivation_level", predicate: "ability", display_name: "境界", cardinality: "one", value_type: "enum", values: ["练气", "筑基", "金丹"] },
          { key: "inventory", predicate: "possession", display_name: "持有物", cardinality: "many", value_type: "free" },
        ],
      },
    },
    ctx,
  );
}

describe("novel_submit_character_entity", () => {
  it("实体落 json + md 身份同步 + authored facts 入账 + 角色卡刷新", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const result = (await novelSubmitCharacterEntity(
      {
        payload: {
          name: "苏见",
          aliases: ["剑圣"],
          gender: "男",
          age: "18 岁",
          initial_states: [
            { dimension: "cultivation_level", value: "练气" },
            { dimension: "inventory", value: "短刀" },
          ],
        },
      },
      ctx,
    )) as { ok: boolean; character_uid: string; facts_written: number };
    expect(result.ok).toBe(true);
    expect(result.facts_written).toBe(2);

    const entity = JSON.parse(readFileSync(join(ctx.projectRoot, "bible", "characters", "苏见.json"), "utf-8"));
    expect(entity.character_uid).toBe(result.character_uid);

    const md = readFileSync(join(ctx.projectRoot, "bible", "characters", "苏见.md"), "utf-8");
    expect(md).toContain(`"character_uid":"${result.character_uid}"`);
    expect(md).toMatch(/别名\s*[:：]\s*剑圣/);

    const facts = ctx.db
      .prepare("SELECT predicate, object, source, from_chapter FROM facts WHERE novel_id='n1' AND subject_character_uid=?")
      .all(result.character_uid) as Array<{ predicate: string; object: string; source: string; from_chapter: number }>;
    expect(facts).toHaveLength(2);
    expect(facts.every((f) => f.source === "authored" && f.from_chapter === 0)).toBe(true);

    const card = ctx.db.prepare("SELECT card_json FROM character_cards WHERE novel_id='n1' AND character_uid=?").get(result.character_uid) as { card_json: string };
    expect(JSON.parse(card.card_json).dimensions.cultivation_level.value).toBe("练气");
  });

  it("enum 维度值不在值域 → fail-loud 带 hint 不落任何账", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const result = (await novelSubmitCharacterEntity(
      { payload: { name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "金丹中期" }] } },
      ctx,
    )) as { ok: boolean; errors: Array<{ hint: string }> };
    expect(result.ok).toBe(false);
    expect(result.errors[0].hint).toContain("练气");
    expect(ctx.db.prepare("SELECT COUNT(*) AS c FROM facts").get()).toMatchObject({ c: 0 });
  });

  it("重复提交幂等：同值跳过、one 维度换值旧 fact 失效并指向新值", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const first = (await novelSubmitCharacterEntity(
      { payload: { name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    )) as { character_uid: string };
    const second = (await novelSubmitCharacterEntity(
      { payload: { character_uid: first.character_uid, name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "筑基" }] } },
      ctx,
    )) as { ok: boolean; facts_written: number };
    expect(second.ok).toBe(true);
    const rows = ctx.db
      .prepare("SELECT object, invalidated_by FROM facts WHERE subject_character_uid=? ORDER BY created_at")
      .all(first.character_uid) as Array<{ object: string; invalidated_by: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].object).toBe("练气");
    expect(rows[0].invalidated_by).not.toBeNull();
  });

  it("同 uid 换 name 重提交：旧档案随迁到新名，旧 json/md 不留孤儿", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const first = (await novelSubmitCharacterEntity(
      { payload: { name: "阿九", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    )) as { character_uid: string };

    const charDir = join(ctx.projectRoot, "bible", "characters");
    const oldMdPath = join(charDir, "阿九.md");
    // 模拟旧档案已有文学正文（world-curator 写的角色小传），改名后必须保留
    writeFileSync(
      oldMdPath,
      readFileSync(oldMdPath, "utf-8").replace(/\n$/, "") + "\n\n阿九出身寒门，自幼习剑，性子孤僻却重情义。\n",
    );

    const second = (await novelSubmitCharacterEntity(
      {
        payload: {
          character_uid: first.character_uid,
          name: "苏九歌",
          initial_states: [{ dimension: "cultivation_level", value: "练气" }],
        },
      },
      ctx,
    )) as { ok: boolean; character_uid: string; warnings: string[] };

    expect(second.ok).toBe(true);
    expect(second.character_uid).toBe(first.character_uid);
    expect(existsSync(join(charDir, "阿九.json"))).toBe(false);
    expect(existsSync(oldMdPath)).toBe(false);
    expect(existsSync(join(charDir, "苏九歌.json"))).toBe(true);

    const newMd = readFileSync(join(charDir, "苏九歌.md"), "utf-8");
    expect(newMd).toContain("阿九出身寒门，自幼习剑，性子孤僻却重情义。");
    expect(newMd).toContain(`"character_uid":"${first.character_uid}"`);
    expect(newMd).toContain(`"name":"苏九歌"`);

    expect(second.warnings.length).toBeGreaterThan(0);
    expect(second.warnings.join(" ")).toContain("阿九");
    expect(second.warnings.join(" ")).toContain("苏九歌");
  });

  it("同 uid 换 name 但新旧 md 同时存在（冲突）：不动旧文件，只出 warning", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const first = (await novelSubmitCharacterEntity(
      { payload: { name: "阿九" } },
      ctx,
    )) as { character_uid: string };

    const charDir = join(ctx.projectRoot, "bible", "characters");
    // 冲突场景：新名的 md 恰好已被别的流程建过（如手误重名）
    writeFileSync(join(charDir, "苏九歌.md"), "# 苏九歌\n\n另一份既有档案。\n");

    const second = (await novelSubmitCharacterEntity(
      { payload: { character_uid: first.character_uid, name: "苏九歌" } },
      ctx,
    )) as { ok: boolean; warnings: string[] };

    expect(second.ok).toBe(true);
    // 旧文件不动：json 和 md 都还在
    expect(existsSync(join(charDir, "阿九.json"))).toBe(true);
    expect(existsSync(join(charDir, "阿九.md"))).toBe(true);
    expect(existsSync(join(charDir, "苏九歌.md"))).toBe(true);
    expect(readFileSync(join(charDir, "苏九歌.md"), "utf-8")).toContain("另一份既有档案。");

    expect(second.warnings.length).toBeGreaterThan(0);
    expect(second.warnings.join(" ")).toContain("冲突");
  });

  it("身份注释同步保留旧 JSON 的其余字段（如主会话写入的 profile_stage）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const first = (await novelSubmitCharacterEntity(
      { payload: { name: "苏见" } },
      ctx,
    )) as { character_uid: string };

    const mdPath = join(ctx.projectRoot, "bible", "characters", "苏见.md");
    // 模拟主会话在提交后于身份注释里追加了三字段版（含 profile_stage）
    writeFileSync(
      mdPath,
      readFileSync(mdPath, "utf-8").replace(
        CHARACTER_IDENTITY_RE,
        `<!-- character_identity: {"character_uid":"${first.character_uid}","name":"苏见","profile_stage":"sketch"} -->`,
      ),
    );

    const second = (await novelSubmitCharacterEntity(
      { payload: { character_uid: first.character_uid, name: "苏见", aliases: ["剑圣"] } },
      ctx,
    )) as { ok: boolean; character_uid: string };
    expect(second.ok).toBe(true);

    const md = readFileSync(mdPath, "utf-8");
    expect(md).toContain(`"character_uid":"${first.character_uid}"`);
    expect(md).toContain(`"name":"苏见"`);
    expect(md).toContain(`"profile_stage":"sketch"`);
  });

  it("uid 命中候选池回写 promoted", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const uid = "22222222-2222-4222-8222-222222222222";
    ctx.db
      .prepare("INSERT INTO candidate_characters (novel_id, character_uid, name) VALUES ('n1', ?, '阿九')")
      .run(uid);
    await novelSubmitCharacterEntity({ payload: { character_uid: uid, name: "阿九", effective_chapter: 5 } }, ctx);
    const row = ctx.db.prepare("SELECT status FROM candidate_characters WHERE character_uid=?").get(uid) as { status: string };
    expect(row.status).toBe("promoted");
  });

  it("同名不同 uid 提交被拒绝：ok:false 且 json/md/facts 零改动（I-1 身份门）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const first = (await novelSubmitCharacterEntity(
      { payload: { name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    )) as { character_uid: string };

    const charDir = join(ctx.projectRoot, "bible", "characters");
    const jsonBefore = readFileSync(join(charDir, "苏见.json"), "utf-8");
    const mdBefore = readFileSync(join(charDir, "苏见.md"), "utf-8");
    const factsCountBefore = (ctx.db.prepare("SELECT COUNT(*) AS c FROM facts").get() as { c: number }).c;

    const otherUid = "33333333-3333-4333-8333-333333333333";
    const result = (await novelSubmitCharacterEntity(
      {
        payload: {
          character_uid: otherUid,
          name: "苏见",
          initial_states: [{ dimension: "cultivation_level", value: "筑基" }],
        },
      },
      ctx,
    )) as { ok: boolean; errors: Array<{ field: string; expected: string; actual: string; hint: string }> };

    expect(result.ok).toBe(false);
    expect(result.errors[0].field).toBe("name");
    expect(result.errors[0].actual).toContain(first.character_uid);
    expect(result.errors[0].hint).toContain("既有 character_uid");

    // json/md/facts 零改动
    expect(readFileSync(join(charDir, "苏见.json"), "utf-8")).toBe(jsonBefore);
    expect(readFileSync(join(charDir, "苏见.md"), "utf-8")).toBe(mdBefore);
    expect((ctx.db.prepare("SELECT COUNT(*) AS c FROM facts").get() as { c: number }).c).toBe(factsCountBefore);
    // 另一 uid 也未被写入任何档案文件
    expect(existsSync(join(charDir, `${otherUid}.json`))).toBe(false);
  });

  it("md-only 撞名（json 不存在但同名 md 带异 uid 身份注释）：拒绝写入，md 未被改动", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const charDir = join(ctx.projectRoot, "bible", "characters");
    mkdirSync(charDir, { recursive: true });
    const otherUid = "44444444-4444-4444-8444-444444444444";
    const mdPath = join(charDir, "苏见.md");
    const mdBefore = `<!-- character_identity: {"character_uid":"${otherUid}","name":"苏见"} -->\n# 苏见\n\n别名: 无\n\n她是本书的女主角。\n`;
    writeFileSync(mdPath, mdBefore, "utf-8");

    const uid = "55555555-5555-4555-8555-555555555555";
    const result = (await novelSubmitCharacterEntity(
      {
        payload: {
          character_uid: uid,
          name: "苏见",
          initial_states: [{ dimension: "cultivation_level", value: "练气" }],
        },
      },
      ctx,
    )) as { ok: boolean; errors: Array<{ field: string; expected: string; actual: string; hint: string }> };

    expect(result.ok).toBe(false);
    expect(result.errors[0].field).toBe("name");
    expect(result.errors[0].actual).toContain(otherUid);
    expect(result.errors[0].hint).toContain("既有 character_uid");

    // md 未被改动；未新建 json
    expect(readFileSync(mdPath, "utf-8")).toBe(mdBefore);
    expect(existsSync(join(charDir, "苏见.json"))).toBe(false);
  });

  it("md-only 但身份注释损坏（parse 失败）：视为无可信身份线索，放行认领", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const charDir = join(ctx.projectRoot, "bible", "characters");
    mkdirSync(charDir, { recursive: true });
    const mdPath = join(charDir, "苏见.md");
    writeFileSync(mdPath, `<!-- character_identity: {"character_uid": broken} -->\n# 苏见\n\n她是本书的女主角。\n`, "utf-8");

    const result = (await novelSubmitCharacterEntity(
      { payload: { name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    )) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(existsSync(join(charDir, "苏见.json"))).toBe(true);
  });

  it("已写书重提交实体：卡 as_of_chapter 不回退到 effective，extracted 状态不丢（I-2）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const first = (await novelSubmitCharacterEntity(
      { payload: { name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    )) as { character_uid: string };
    const uid = first.character_uid;

    // 模拟本书已写到第 50 章：插入章节摘要
    ctx.db
      .prepare(`INSERT INTO chapter_summaries (id, novel_id, chapter, summary) VALUES (?, 'n1', 50, '摘要')`)
      .run(randomUUID());
    // 模拟正文抽取在第 30 章把境界升级为「筑基」（source=extracted），并作废第 0 章的旧值「练气」
    ctx.db
      .prepare(
        `UPDATE facts SET invalidated_at_chapter=30, updated_at=datetime('now')
         WHERE subject_character_uid=? AND object='练气' AND invalidated_at_chapter IS NULL`,
      )
      .run(uid);
    ctx.db
      .prepare(
        `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, sector, from_chapter, event_chapter, source)
         VALUES (?, 'n1', '苏见', ?, 'ability', '筑基', 'semantic', 30, 30, 'extracted')`,
      )
      .run(randomUUID(), uid);
    // 模拟既有卡已被 novel_consolidate 正确刷新到 as_of_chapter=50
    refreshCharacterCards(ctx, [{ uid, name: "苏见" }], 50);
    const cardBefore = ctx.db
      .prepare("SELECT as_of_chapter, card_json FROM character_cards WHERE novel_id='n1' AND character_uid=?")
      .get(uid) as { as_of_chapter: number; card_json: string };
    expect(cardBefore.as_of_chapter).toBe(50);
    expect(JSON.parse(cardBefore.card_json).dimensions.cultivation_level.value).toBe("筑基");

    // 重提交实体（如候选转正补记 aliases），effective_chapter 仍是默认 0、不带 initial_states
    const second = (await novelSubmitCharacterEntity(
      { payload: { character_uid: uid, name: "苏见", aliases: ["剑圣"] } },
      ctx,
    )) as { ok: boolean };
    expect(second.ok).toBe(true);

    const cardAfter = ctx.db
      .prepare("SELECT as_of_chapter, card_json FROM character_cards WHERE novel_id='n1' AND character_uid=?")
      .get(uid) as { as_of_chapter: number; card_json: string };
    expect(cardAfter.as_of_chapter).toBeGreaterThanOrEqual(50);
    // extracted 状态（第 30 章升级到筑基）没有因重提交被回退丢失
    expect(JSON.parse(cardAfter.card_json).dimensions.cultivation_level.value).toBe("筑基");
  });

  it("effective_chapter 晚于本书已写章节时，卡不折进未来状态（PR#452评审P1-B）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    // 本书只写到第 1 章
    ctx.db
      .prepare(`INSERT INTO chapter_summaries (id, novel_id, chapter, summary) VALUES (?, 'n1', 1, '摘要')`)
      .run(randomUUID());

    const result = (await novelSubmitCharacterEntity(
      {
        payload: {
          name: "苏见",
          effective_chapter: 10,
          initial_states: [{ dimension: "cultivation_level", value: "金丹" }],
        },
      },
      ctx,
    )) as { character_uid: string };

    const card = ctx.db
      .prepare("SELECT as_of_chapter, card_json FROM character_cards WHERE novel_id='n1' AND character_uid=?")
      .get(result.character_uid) as { as_of_chapter: number; card_json: string } | undefined;
    // cardAsOf 不取 effective(10)，钉在已写章节（latestSummarized=1）——本次唯一一条 fact 的
    // event_chapter(10) 晚于 asOf(1)，FACT_VALID_AT_SQL 天然过滤掉，折叠结果为空卡，
    // refreshCharacterCards 对空卡不落盘（writers.ts SSOT）——未来状态没有折进当前卡，
    // 更没有以 as_of_chapter=10 的形态残留在 character_cards（facts 表仍照实记 event_chapter=10，
    // 只是折叠/展示层不提前泄露）
    expect(card).toBeUndefined();

    const fact = ctx.db
      .prepare(`SELECT event_chapter FROM facts WHERE subject_character_uid=? AND object='金丹'`)
      .get(result.character_uid) as { event_chapter: number };
    expect(fact.event_chapter).toBe(10);
  });

  it("完整重提不倒杀已演变的时间线：初始值@0 → 抽取演变@30 → 第50章完整重提仍带初始值（PR#452评审P1-A）", async () => {
    const ctx = makeCtx();
    await submitVocab(ctx);
    const first = (await novelSubmitCharacterEntity(
      { payload: { name: "苏见", initial_states: [{ dimension: "cultivation_level", value: "练气" }] } },
      ctx,
    )) as { character_uid: string };
    const uid = first.character_uid;

    // 模拟本书已写到第 50 章
    ctx.db
      .prepare(`INSERT INTO chapter_summaries (id, novel_id, chapter, summary) VALUES (?, 'n1', 50, '摘要')`)
      .run(randomUUID());

    // 手插正文抽取在第 30 章把境界升级为「筑基」（source=extracted），并把「练气@0」标为
    // 在第 30 章失效、失效者指向「筑基」这条新 fact——模拟真实的抽取层演变写法
    const upgradeId = randomUUID();
    ctx.db
      .prepare(
        `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, sector, from_chapter, event_chapter, source)
         VALUES (?, 'n1', '苏见', ?, 'ability', '筑基', 'semantic', 30, 30, 'extracted')`,
      )
      .run(upgradeId, uid);
    ctx.db
      .prepare(
        `UPDATE facts SET invalidated_at_chapter=30, invalidated_by=?, updated_at=datetime('now')
         WHERE subject_character_uid=? AND object='练气' AND invalidated_at_chapter IS NULL`,
      )
      .run(upgradeId, uid);

    // 第 50 章：完整重提同一实体，initial_states 仍带最初的「练气」（如 agent 重新整理档案时
    // 原样带回 initial_states，未意识到该值早已被后续演变作废）
    const second = (await novelSubmitCharacterEntity(
      {
        payload: {
          character_uid: uid,
          name: "苏见",
          effective_chapter: 0,
          initial_states: [{ dimension: "cultivation_level", value: "练气" }],
        },
      },
      ctx,
    )) as { ok: boolean; facts_written: number; facts_skipped: number };

    expect(second.ok).toBe(true);
    // 去重放宽命中：同 uid+predicate+object 落在同一起点章(0)，无论是否已失效都算已记录 → 跳过
    expect(second.facts_written).toBe(0);
    expect(second.facts_skipped).toBe(1);

    // 「筑基@30」必须仍然有效，没有被倒杀
    const jinji = ctx.db
      .prepare(`SELECT invalidated_at_chapter FROM facts WHERE subject_character_uid=? AND object='筑基'`)
      .get(uid) as { invalidated_at_chapter: number | null };
    expect(jinji.invalidated_at_chapter).toBeNull();

    // 卡的当前值仍是「筑基」，不是被重提的「练气」顶替
    const card = ctx.db
      .prepare("SELECT card_json FROM character_cards WHERE novel_id='n1' AND character_uid=?")
      .get(uid) as { card_json: string };
    expect(JSON.parse(card.card_json).dimensions.cultivation_level.value).toBe("筑基");

    // 库中不存在非法区间：任何行的 invalidated_at_chapter 都不早于它自己的起点章
    const illegal = ctx.db
      .prepare(
        `SELECT id FROM facts WHERE subject_character_uid=? AND invalidated_at_chapter IS NOT NULL
           AND invalidated_at_chapter < COALESCE(event_chapter, from_chapter)`,
      )
      .all(uid);
    expect(illegal).toHaveLength(0);
  });
});
