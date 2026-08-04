import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { selectPersona, resetPersonaCache } from "./persona-loader.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PersonaPoolEntry } from "./packs/pack-resolver.js";

function voiceOf(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe("selectPersona（真实卡库：关键词机械选卡）", () => {
  beforeEach(() => resetPersonaCache());

  it("voice 为 null 时不选卡", () => {
    expect(selectPersona(null)).toBeNull();
  });

  it("voice 各维度全空时不选卡", () => {
    expect(selectPersona(voiceOf({}))).toBeNull();
  });

  it("诙谐系关键词命中说书人卡，正文非空且是第二人称身份描述", () => {
    const card = selectPersona(
      voiceOf({
        archetype: "轻幽默说书腔",
        tone: "漫不经心的调侃外衣",
      }),
    );
    expect(card?.id).toBe("storyteller-witty");
    expect(card!.body).toContain("你");
    expect(card!.body.length).toBeGreaterThan(100);
  });

  it("archetype 命中权重高于自由文本：诙谐原型 + 冷峻基调 → 说书人卡", () => {
    const card = selectPersona(
      voiceOf({
        archetype: "韩寒式轻幽默，戏谑调侃",
        tone: "底下是冷峻与孤独",
      }),
    );
    expect(card?.id).toBe("storyteller-witty");
  });

  it("冷峻系关键词命中冷峻卡", () => {
    const card = selectPersona(
      voiceOf({ archetype: "冷峻凌厉", style_keywords: "肃杀、压迫" }),
    );
    expect(card?.id).toBe("cold-blade");
  });

  it("细腻系关键词命中贴肤卡", () => {
    const card = selectPersona(
      voiceOf({ archetype: "细腻贴肤", tone: "温柔、心动、拉扯" }),
    );
    expect(card?.id).toBe("skin-close");
  });

  it("无任何关键词命中时不选卡（省略 persona 是安全回退）", () => {
    const card = selectPersona(
      voiceOf({ archetype: "史诗恢弘", tone: "苍茫大气" }),
    );
    expect(card).toBeNull();
  });

  it("并列首名歧义时不选卡（宁缺勿错）", () => {
    const card = selectPersona(voiceOf({ tone: "幽默而冷峻" }));
    expect(card).toBeNull();
  });
});

describe("selectPersona（章级情绪调制：GATE-1 book2 败因修正）", () => {
  beforeEach(() => resetPersonaCache());

  it("诙谐书 × 悲怆主导章 → 不选卡，buildNotes 记录调制原因", () => {
    const buildNotes: string[] = [];
    const card = selectPersona(
      voiceOf({ archetype: "轻幽默说书腔，戏谑调侃" }),
      ["悲伤", "震撼"],
      buildNotes,
    );
    expect(card).toBeNull();
    expect(buildNotes).toEqual(["persona 调制：诙谐卡因本章情绪(悲伤)回退"]);
  });

  it("诙谐书 × 紧张主导章 → 同样不选卡", () => {
    const buildNotes: string[] = [];
    const card = selectPersona(
      voiceOf({ archetype: "轻幽默说书腔，戏谑调侃" }),
      ["紧张"],
      buildNotes,
    );
    expect(card).toBeNull();
    expect(buildNotes).toEqual(["persona 调制：诙谐卡因本章情绪(紧张)回退"]);
  });

  it("诙谐书 × 无情绪章 → 照常投卡（chapterEmotions 缺省）", () => {
    const card = selectPersona(voiceOf({ archetype: "轻幽默说书腔，戏谑调侃" }));
    expect(card?.id).toBe("storyteller-witty");
  });

  it("诙谐书 × 日常情绪（幽默主导）章 → 照常投卡，不被调制", () => {
    const buildNotes: string[] = [];
    const card = selectPersona(
      voiceOf({ archetype: "轻幽默说书腔，戏谑调侃" }),
      ["幽默", "温暖"],
      buildNotes,
    );
    expect(card?.id).toBe("storyteller-witty");
    expect(buildNotes).toEqual([]);
  });

  it("冷峻书 × 悲怆主导章 → 调制只治诙谐卡，冷峻卡照常投", () => {
    const buildNotes: string[] = [];
    const card = selectPersona(
      voiceOf({ archetype: "冷峻凌厉", style_keywords: "肃杀、压迫" }),
      ["悲伤"],
      buildNotes,
    );
    expect(card?.id).toBe("cold-blade");
    expect(buildNotes).toEqual([]);
  });

  it("贴肤书 × 紧张主导章 → 调制只治诙谐卡，贴肤卡照常投", () => {
    const buildNotes: string[] = [];
    const card = selectPersona(
      voiceOf({ archetype: "细腻贴肤", tone: "温柔、心动、拉扯" }),
      ["紧张"],
      buildNotes,
    );
    expect(card?.id).toBe("skin-close");
    expect(buildNotes).toEqual([]);
  });
});

describe("selectPersona 候选池与优先级（ADR-0034）", () => {
  let tmp: string;
  beforeEach(() => { resetPersonaCache(); tmp = mkdtempSync(join(tmpdir(), "persona-pool-")); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function poolEntry(id: string, origin: PersonaPoolEntry["origin"], keywords: string[]): PersonaPoolEntry {
    const p = join(tmp, `${id}.md`);
    writeFileSync(p, `${id} 的声音正文`);
    return { id, name: id, path: p, keywords, origin, source_pack_id: "test-pack", source_pack_version: "1.0.0" };
  }

  it("同分并列：user 卡胜出而非宁缺勿错", () => {
    const card = selectPersona(voiceOf({ archetype: "冷峻" }), [], undefined, [
      poolEntry("official-cold", "official", ["冷峻"]),
      poolEntry("user-cold", "user", ["冷峻"]),
    ]);
    expect(card?.id).toBe("user-cold");
    expect(card?.body).toBe("user-cold 的声音正文");
  });

  it("同 origin 同分并列 → 仍返回 null（宁缺勿错保留）", () => {
    const card = selectPersona(voiceOf({ archetype: "冷峻" }), [], undefined, [
      poolEntry("a", "user", ["冷峻"]), poolEntry("b", "user", ["冷峻"]),
    ]);
    expect(card).toBeNull();
  });

  it("pool 省略：真实库回归，诙谐书悲怆章仍被情绪门抑制", () => {
    const buildNotes: string[] = [];
    const card = selectPersona(voiceOf({ archetype: "轻幽默说书腔，戏谑调侃" }), ["悲伤"], buildNotes);
    expect(card).toBeNull();
  });

  it("候选 path 为空（造包中心草稿卡）：命中时容错返回空 body 而非因文件缺失判 null", () => {
    const card = selectPersona(voiceOf({ archetype: "冷峻" }), [], undefined, [
      { id: "draft-cold", name: "草稿冷峻卡", path: "", keywords: ["冷峻"], origin: "user", source_pack_id: "__draft__", source_pack_version: "0.0.0" },
    ]);
    expect(card).toEqual({ id: "draft-cold", name: "草稿冷峻卡", body: "" });
  });
});

describe("selectPersona 用户卡命中即优先（follow-up⑨：手写一等公民，等于无穷大权重）", () => {
  let tmp: string;
  beforeEach(() => { resetPersonaCache(); tmp = mkdtempSync(join(tmpdir(), "persona-priority-")); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function poolEntry(id: string, origin: PersonaPoolEntry["origin"], keywords: string[]): PersonaPoolEntry {
    const p = join(tmp, `${id}.md`);
    writeFileSync(p, `${id} 的声音正文`);
    return { id, name: id, path: p, keywords, origin, source_pack_id: "test-pack", source_pack_version: "1.0.0" };
  }

  it("user 卡低分命中 + official 卡高分命中 → 选中 user 卡（不比分，命中即优先）", () => {
    const card = selectPersona(voiceOf({ archetype: "冷峻孤独凌厉紧绷", tone: "冷峻" }), [], undefined, [
      poolEntry("official-cold", "official", ["冷峻", "孤独", "凌厉", "紧绷"]), // score=9（archetype 4 命中×2+tone 1 命中×1）
      poolEntry("user-cold", "user", ["冷峻"]), // score=3（archetype 1 命中×2+tone 1 命中×1），分数明显更低
    ]);
    expect(card?.id).toBe("user-cold");
  });

  it("无 user 卡命中、仅 official 命中 → 回落原逻辑选中 official", () => {
    const card = selectPersona(voiceOf({ archetype: "冷峻" }), [], undefined, [
      poolEntry("official-cold", "official", ["冷峻"]),
      poolEntry("user-other", "user", ["温柔"]), // 未命中
    ]);
    expect(card?.id).toBe("official-cold");
  });

  it("两张 user 卡同分并列命中 → 宁缺勿错（user 子集内仍适用）", () => {
    const card = selectPersona(voiceOf({ archetype: "冷峻" }), [], undefined, [
      poolEntry("user-a", "user", ["冷峻"]),
      poolEntry("user-b", "user", ["冷峻"]),
      poolEntry("official-cold", "official", ["冷峻", "凌厉"]), // 分数更高也不参与竞争
    ]);
    expect(card).toBeNull();
  });

  it("纯官方池（无 user 卡）：行为与改动前逐字节一致（等价性）", () => {
    const card = selectPersona(voiceOf({ archetype: "冷峻凌厉", style_keywords: "肃杀、压迫" }));
    expect(card?.id).toBe("cold-blade");
  });
});
