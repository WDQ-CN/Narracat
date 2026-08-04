import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "../migrate.js";
import type { ToolContext } from "../types.js";
import {
  novelRegisterCandidateCharacter,
  novelListCandidateCharacters,
} from "./candidates.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXISTING_UID = "11111111-1111-4111-8111-111111111111";

function createCtx(): ToolContext {
  const db = new Database(":memory:");
  initSchema(db);
  return {
    novelId: "novel-test",
    db,
    projectRoot: "",
    estimatedTotalChapters: 60,
    wordsPerChapter: 3000,
    styleProfile: "web_standard",
  };
}

describe("novel_register_candidate_character", () => {
  let ctx: ToolContext;
  beforeEach(() => {
    ctx = createCtx();
  });

  it("缺 name 报错、不入库", async () => {
    const res = (await novelRegisterCandidateCharacter({}, ctx)) as {
      ok: boolean;
      errors?: unknown[];
    };
    expect(res.ok).toBe(false);
    expect(res.errors).toBeDefined();
    const list = (await novelListCandidateCharacters({}, ctx)) as { count: number };
    expect(list.count).toBe(0);
  });

  it("省略 character_uid 时自动铸造 lowercase UUID v4", async () => {
    const res = (await novelRegisterCandidateCharacter(
      { name: "神秘老者", note: "后续是主角师父", proposed_chapter: 18, source: "write" },
      ctx,
    )) as { ok: boolean; character_uid: string; status: string };
    expect(res.ok).toBe(true);
    expect(res.character_uid).toMatch(UUID_V4);
    expect(res.status).toBe("candidate");
  });

  it("传入既有 character_uid 时复用同一身份（CharacterReference 契约）", async () => {
    const res = (await novelRegisterCandidateCharacter(
      { name: "暗探", character_uid: EXISTING_UID },
      ctx,
    )) as { ok: boolean; character_uid: string };
    expect(res.ok).toBe(true);
    expect(res.character_uid).toBe(EXISTING_UID);
  });

  it("非法 character_uid（非 UUID v4）被拒", async () => {
    const res = (await novelRegisterCandidateCharacter(
      { name: "暗探", character_uid: "not-a-uuid" },
      ctx,
    )) as { ok: boolean };
    expect(res.ok).toBe(false);
  });

  it("proposed_chapter 非正整数被拒", async () => {
    const res = (await novelRegisterCandidateCharacter(
      { name: "暗探", proposed_chapter: 0 },
      ctx,
    )) as { ok: boolean };
    expect(res.ok).toBe(false);
  });

  it("同 UID 重复登记 upsert：更新 name/note，不重复成行", async () => {
    const first = (await novelRegisterCandidateCharacter(
      { name: "旧名", character_uid: EXISTING_UID, note: "初记" },
      ctx,
    )) as { character_uid: string };
    await novelRegisterCandidateCharacter(
      { name: "新名", character_uid: first.character_uid },
      ctx,
    );
    const list = (await novelListCandidateCharacters({}, ctx)) as {
      count: number;
      candidates: { name: string; note?: string }[];
    };
    expect(list.count).toBe(1);
    expect(list.candidates[0].name).toBe("新名");
    // note 缺省时保留旧值
    expect(list.candidates[0].note).toBe("初记");
  });

  it("status='promoted' 标记已建档，从候选清单淡出", async () => {
    await novelRegisterCandidateCharacter(
      { name: "暗探", character_uid: EXISTING_UID },
      ctx,
    );
    await novelRegisterCandidateCharacter(
      { name: "暗探", character_uid: EXISTING_UID, status: "promoted" },
      ctx,
    );
    const candidates = (await novelListCandidateCharacters({}, ctx)) as { count: number };
    expect(candidates.count).toBe(0);
    const promoted = (await novelListCandidateCharacters({ status: "promoted" }, ctx)) as {
      count: number;
    };
    expect(promoted.count).toBe(1);
  });

  it("非法 initial_relationships（缺字段）被拒", async () => {
    const res = (await novelRegisterCandidateCharacter(
      { name: "暗探", initial_relationships: [{ other_character_uid: EXISTING_UID }] },
      ctx,
    )) as { ok: boolean };
    expect(res.ok).toBe(false);
  });

  it("promote 时省略 initial_relationships 保留既有草稿（不被清空）", async () => {
    await novelRegisterCandidateCharacter(
      {
        name: "暗探",
        character_uid: EXISTING_UID,
        initial_relationships: [{ other_character_uid: "22222222-2222-4222-8222-222222222222", state: "暗中监视" }],
      },
      ctx,
    );
    await novelRegisterCandidateCharacter(
      { name: "暗探", character_uid: EXISTING_UID, status: "promoted" },
      ctx,
    );
    const promoted = (await novelListCandidateCharacters({ status: "promoted" }, ctx)) as {
      candidates: { initial_relationships: Array<{ other_character_uid: string; state: string }> }[];
    };
    expect(promoted.candidates[0]?.initial_relationships).toEqual([
      { other_character_uid: "22222222-2222-4222-8222-222222222222", state: "暗中监视" },
    ]);
  });

  it("省略 importance 默认 minor（次要·静默）", async () => {
    await novelRegisterCandidateCharacter({ name: "路人甲" }, ctx);
    const list = (await novelListCandidateCharacters({}, ctx)) as {
      candidates: { importance: string }[];
    };
    expect(list.candidates[0].importance).toBe("minor");
  });

  it("importance='major' 登记重要候选", async () => {
    await novelRegisterCandidateCharacter({ name: "宿敌", importance: "major" }, ctx);
    const list = (await novelListCandidateCharacters({}, ctx)) as {
      candidates: { name: string; importance: string }[];
    };
    expect(list.candidates[0].importance).toBe("major");
  });

  it("非法 importance 被拒、不入库", async () => {
    const res = (await novelRegisterCandidateCharacter(
      { name: "暗探", importance: "critical" },
      ctx,
    )) as { ok: boolean };
    expect(res.ok).toBe(false);
    const list = (await novelListCandidateCharacters({}, ctx)) as { count: number };
    expect(list.count).toBe(0);
  });

  it("promote 时省略 importance 保留既有重要度（major 不被默认成 minor）", async () => {
    await novelRegisterCandidateCharacter(
      { name: "宿敌", character_uid: EXISTING_UID, importance: "major" },
      ctx,
    );
    await novelRegisterCandidateCharacter(
      { name: "宿敌", character_uid: EXISTING_UID, status: "promoted" },
      ctx,
    );
    const promoted = (await novelListCandidateCharacters({ status: "promoted" }, ctx)) as {
      candidates: { importance: string }[];
    };
    expect(promoted.candidates[0]?.importance).toBe("major");
  });
});

describe("novel_list_candidate_characters", () => {
  let ctx: ToolContext;
  beforeEach(() => {
    ctx = createCtx();
  });

  it("默认只列 candidate，按 proposed_chapter 排序", async () => {
    await novelRegisterCandidateCharacter({ name: "丙", proposed_chapter: 30 }, ctx);
    await novelRegisterCandidateCharacter({ name: "甲", proposed_chapter: 10 }, ctx);
    await novelRegisterCandidateCharacter({ name: "乙" }, ctx); // 无 proposed_chapter 排末尾
    const list = (await novelListCandidateCharacters({}, ctx)) as {
      candidates: { name: string }[];
    };
    expect(list.candidates.map((c) => c.name)).toEqual(["甲", "丙", "乙"]);
  });

  it("status='all' 同时列 candidate 与 promoted", async () => {
    await novelRegisterCandidateCharacter({ name: "甲" }, ctx);
    await novelRegisterCandidateCharacter(
      { name: "乙", character_uid: EXISTING_UID, status: "promoted" },
      ctx,
    );
    const all = (await novelListCandidateCharacters({ status: "all" }, ctx)) as {
      count: number;
    };
    expect(all.count).toBe(2);
  });

  it("非法 status 被拒", async () => {
    const res = (await novelListCandidateCharacters({ status: "bogus" }, ctx)) as {
      ok: boolean;
    };
    expect(res.ok).toBe(false);
  });

  it("importance='major' 只列重要候选（写完正文提醒用）", async () => {
    await novelRegisterCandidateCharacter({ name: "次要路人" }, ctx); // 默认 minor
    await novelRegisterCandidateCharacter({ name: "关键反派", importance: "major" }, ctx);
    const major = (await novelListCandidateCharacters({ importance: "major" }, ctx)) as {
      count: number;
      candidates: { name: string }[];
    };
    expect(major.count).toBe(1);
    expect(major.candidates[0].name).toBe("关键反派");
  });

  it("非法 importance 过滤被拒", async () => {
    const res = (await novelListCandidateCharacters({ importance: "bogus" }, ctx)) as {
      ok: boolean;
    };
    expect(res.ok).toBe(false);
  });

  it("返回候选的 initial_relationships（无草稿时为空数组）", async () => {
    await novelRegisterCandidateCharacter(
      {
        name: "甲",
        initial_relationships: [{ other_character_uid: EXISTING_UID, state: "旧识" }],
      },
      ctx,
    );
    await novelRegisterCandidateCharacter({ name: "乙" }, ctx);
    const list = (await novelListCandidateCharacters({}, ctx)) as {
      candidates: { name: string; initial_relationships: Array<{ other_character_uid: string; state: string }> }[];
    };
    const jia = list.candidates.find((c) => c.name === "甲");
    const yi = list.candidates.find((c) => c.name === "乙");
    expect(jia?.initial_relationships).toEqual([{ other_character_uid: EXISTING_UID, state: "旧识" }]);
    expect(yi?.initial_relationships).toEqual([]);
  });
});
