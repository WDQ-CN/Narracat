import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";
import { selectCraftPacks, _resetPackIndexCache } from "./craft-pack-loader.js";
import { resetPackResolverCache, type CraftPoolEntry } from "./packs/pack-resolver.js";

const CONTROLLED_TECHNIQUES = new Set([
  "对话设计", "心理刻画", "环境描写", "动作细节",
  "节奏控制", "情感渲染", "视角运用", "悬念设置",
]);
const CONTROLLED_EMOTIONS = new Set([
  "紧张", "悲伤", "愤怒", "暧昧", "幽默", "温暖", "释然", "震撼",
]);

function loadIndexRaw(): { packs: any[] } {
  const p = fileURLToPath(
    new URL(
      "../../skills/novel-web-craft/references/pack-index.json",
      import.meta.url,
    ),
  );
  return JSON.parse(readFileSync(p, "utf-8"));
}

describe("pack-index.json 结构与受控词表", () => {
  it("每个 pack 字段齐全、类型正确", () => {
    const { packs } = loadIndexRaw();
    expect(Array.isArray(packs)).toBe(true);
    expect(packs.length).toBeGreaterThanOrEqual(2);
    for (const p of packs) {
      expect(typeof p.pack_id).toBe("string");
      expect(p.path.startsWith("${CLAUDE_PLUGIN_ROOT}/")).toBe(true);
      for (const k of ["triggers", "beat_types", "technique_tags", "emotion_tags", "exclusions"]) {
        expect(Array.isArray(p[k])).toBe(true);
      }
      expect(typeof p.priority).toBe("number");
    }
  });

  it("technique_tags / emotion_tags 全在受控词表内", () => {
    const { packs } = loadIndexRaw();
    for (const p of packs) {
      for (const t of p.technique_tags) expect(CONTROLLED_TECHNIQUES.has(t)).toBe(true);
      for (const e of p.emotion_tags) expect(CONTROLLED_EMOTIONS.has(e)).toBe(true);
    }
  });

  it("pack_id 唯一", () => {
    const { packs } = loadIndexRaw();
    const ids = packs.map((p: any) => p.pack_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("selectCraftPacks 结构化触发选包（golden fixtures）", () => {
  it("打脸/看透的爽点章 → 命中 payoff-delivery", () => {
    const outline = "本章爽点：打脸。主角当众看透反派的骗局，一句话揭穿伪装。";
    const hints = selectCraftPacks(outline, 3);
    const ids = hints.map((h) => h.pack_id);
    expect(ids).toContain("payoff-delivery");
    expect(isAbsolute(hints[0].reference_path)).toBe(true);
    expect(hints[0].reason.length).toBeGreaterThan(0);
  });

  it("敌人逼近、章末留悬念 → 命中 chapter-end-hook", () => {
    const outline = "章末敌人逼近，留下一个未解的悬念，紧张感拉满。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).toContain("chapter-end-hook");
  });

  it("exclusions 命中则排除：过渡章不选 payoff-delivery", () => {
    const outline = "本章为过渡章，主角看透局势但不出手，蓄势。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).not.toContain("payoff-delivery");
  });

  it("章纲无任何触发信号 → 返回空数组（向后兼容）", () => {
    expect(selectCraftPacks("一个平淡的日常段落，没有特征。", 3)).toEqual([]);
  });

  it("limit 截断：最多返回 limit 个", () => {
    const outline = "打脸看透真相，章末悬念敌人逼近，紧张震撼。";
    expect(selectCraftPacks(outline, 1).length).toBeLessThanOrEqual(1);
  });

  it("命中分相同时按 priority 降序（payoff priority=3 排在 hook priority=1 前）", () => {
    const outline = "打脸，章末。"; // payoff 命中"打脸"，hook 命中"章末"，各 1 分
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids.indexOf("payoff-delivery")).toBeLessThan(ids.indexOf("chapter-end-hook"));
  });

  it("matched_triggers 恰为实际命中的触发词原文，顺序同 pack triggers 声明序；情绪 boost 不进该数组", () => {
    // payoff-delivery triggers 声明序：[打脸, 真相, 反击, 扬名, 碾压, 看透, 揭穿, 爽点, 逆袭, 一鸣惊人]
    // 本句命中「打脸」「看透」两词（声明序 0、5），并含情绪线索「冲击」（→ 震撼，仅 boost 计分/reason，不进 matched_triggers）
    const outline = "主角打脸反派，一举看透了对方的诡计，带来强烈的冲击。";
    const hints = selectCraftPacks(outline, 3);
    const hint = hints.find((h) => h.pack_id === "payoff-delivery");
    expect(hint).toBeDefined();
    expect(hint!.matched_triggers).toEqual(["打脸", "看透"]);
    expect(hint!.matched_triggers).not.toContain("震撼");
  });

  // ── 全维度 golden fixtures（12 个 pack 全覆盖）──────────────────────────────

  it("幽默调侃章 → 命中 humor-dialogue", () => {
    // 专属触发词：插科打诨（不与其他 pack 重叠）
    const outline = "本章主角插科打诨，耍贫嘴吐槽对方的伪装，全程轻松幽默。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).toContain("humor-dialogue");
  });

  it("紧张追逃章 → 命中 crisis-action", () => {
    // 专属触发词：厮杀、逃命（避免与 chapter-end-hook 共用的 逼近）
    const outline = "主角被敌人追击，险境中厮杀逃命，千钧一发之际才脱身。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).toContain("crisis-action");
  });

  it("乌龙闹剧章 → 命中 comic-action", () => {
    // 专属触发词：乌龙、出糗（与 humor-dialogue 在不同 beat_type，不重叠）
    const outline = "主角一顿手忙脚乱，当众出糗，整个乌龙闹剧让围观者爆笑。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).toContain("comic-action");
  });

  it("对峙摊牌章 → 命中 tense-dialogue", () => {
    // 专属触发词：对峙、摊牌、针锋相对（只属于 tense-dialogue）
    const outline = "两人针锋相对，一场摊牌式对峙，质问与逼问来回交锋。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).toContain("tense-dialogue");
  });

  it("暧昧拉扯章 → 命中 romance-tension", () => {
    // 专属触发词：暧昧、欲拒还迎、情愫（只属于 romance-tension）
    const outline = "两人独处，暧昧的试探与欲拒还迎，言语间情愫暗涌，心跳难掩。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).toContain("romance-tension");
  });

  it("温情治愈章 → 命中 warm-scene", () => {
    // 专属触发词：治愈、双向奔赴、相拥（只属于 warm-scene）
    const outline = "两人和解后相拥，温情治愈了彼此，双向奔赴的守护让人动容。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).toContain("warm-scene");
  });

  it("死讯虐点章 → 命中 grief-strike", () => {
    // 专属触发词：死讯、诀别、悲恸（只属于 grief-strike）
    const outline = "主角得知挚友死讯，诀别时悲恸几乎将他击垮，痛失至亲的遗憾难以消散。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).toContain("grief-strike");
  });

  it("内心独白章 → 命中 inner-immersion", () => {
    // 专属触发词：纠结、独白、挣扎（只属于 inner-immersion）
    const outline = "主角陷入深深的纠结与挣扎，一段沉痛的内心独白展露心境。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).toContain("inner-immersion");
  });

  it("奇观壮阔章 → 命中 sensory-spectacle", () => {
    // 专属触发词：奇观、壮阔、异象（只属于 sensory-spectacle；避免含爽点词）
    const outline = "天地间涌现惊人奇观，壮阔的异象震撼人心，气势宏大。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).toContain("sensory-spectacle");
  });

  it("章末悬念钩子章 → 命中 chapter-end-hook", () => {
    // 专属触发词：钩子、伏笔、预告（避免同时含高分爽点词挤出 hook）
    const outline = "结尾留下一个钩子，埋下伏笔，预告下一章的惊天变故。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).toContain("chapter-end-hook");
  });

  it("节奏张弛章 → 命中 pacing-rhythm", () => {
    // 专属触发词：张弛、缓急、收束（只属于 pacing-rhythm；避免蓄势——在 payoff exclusions 里）
    const outline = "本章讲究张弛有度，以缓急节奏铺垫情绪，最终以收束手法结章。";
    const ids = selectCraftPacks(outline, 3).map((h) => h.pack_id);
    expect(ids).toContain("pacing-rhythm");
  });
});

describe("emotion 仅作 boost · 负向回归（纯信号章纲不被共享情绪污染）", () => {
  it("纯动作章纲（无对话/钩子 trigger）→ 不拉进 tense-dialogue / chapter-end-hook", () => {
    const ids = selectCraftPacks("主角被敌人追击，险境中厮杀逃命，千钧一发之际才脱身。", 3).map((h) => h.pack_id);
    expect(ids).toContain("crisis-action");
    expect(ids).not.toContain("tense-dialogue");
    expect(ids).not.toContain("chapter-end-hook");
  });

  it("纯对话博弈章纲（无动作 trigger）→ 不拉进 crisis-action / romance-tension", () => {
    const ids = selectCraftPacks("两人对峙摊牌，针锋相对地质问与试探。", 3).map((h) => h.pack_id);
    expect(ids).toContain("tense-dialogue");
    expect(ids).not.toContain("crisis-action");
    expect(ids).not.toContain("romance-tension");
  });

  it("emotion-only 命中（仅情绪词、无任何 trigger）→ 不入选返回空", () => {
    expect(selectCraftPacks("气氛紧张，所有人都很震撼，情绪压抑。", 3)).toEqual([]);
  });

  it("入选的每个 pack 都至少有一个 trigger 命中（emotion 不单独成选）", () => {
    const hints = selectCraftPacks("打脸看透真相，章末悬念敌人逼近，暧昧心跳。", 3);
    expect(hints.length).toBeGreaterThan(0);
    for (const h of hints) expect(h.reason).toMatch(/触发词/);
  });
});

describe("craft_pack_hints 拼装语义（向后兼容）", () => {
  it("命中时 hints 非空、可作为可选字段拼进 pack", () => {
    _resetPackIndexCache();
    const hints = selectCraftPacks("本章爽点：打脸，主角看透真相。", 3);
    const pack: Record<string, unknown> = {
      target_chapter: 1,
      ...(hints.length > 0 ? { craft_pack_hints: hints } : {}),
    };
    expect("craft_pack_hints" in pack).toBe(true);
    expect((pack.craft_pack_hints as unknown[]).length).toBeGreaterThan(0);
  });

  it("无命中时不写 craft_pack_hints 键（旧包形态不变）", () => {
    const hints = selectCraftPacks("平淡日常，无特征。", 3);
    const pack: Record<string, unknown> = {
      target_chapter: 1,
      ...(hints.length > 0 ? { craft_pack_hints: hints } : {}),
    };
    expect("craft_pack_hints" in pack).toBe(false);
  });
});

describe("reference_path 是写手可 Read 的绝对路径（${CLAUDE_PLUGIN_ROOT} 已展开）", () => {
  it("命中的每个 hint：绝对路径 + 不含字面变量 + 文件实际存在", () => {
    _resetPackIndexCache();
    const hints = selectCraftPacks(
      "打脸看透真相，章末悬念敌人逼近，紧张震撼。",
      3,
    );
    expect(hints.length).toBeGreaterThan(0);
    for (const h of hints) {
      // 写手从 WCP 数据里直接 Read 这条路径——必须是已展开的绝对路径，
      // 字面 ${CLAUDE_PLUGIN_ROOT} 在写手侧不会被解析（PR#385 P1 修复）。
      expect(isAbsolute(h.reference_path)).toBe(true);
      expect(h.reference_path.includes("${CLAUDE_PLUGIN_ROOT}")).toBe(false);
      expect(existsSync(h.reference_path)).toBe(true);
    }
  });
});

function officialPoolEntry(patch: Partial<CraftPoolEntry>): CraftPoolEntry {
  return {
    pack_id: "x", path: "cards/x.md", absolute_path: "/abs/x.md",
    triggers: ["危机"], beat_types: ["action"], technique_tags: ["动作细节"],
    emotion_tags: [], exclusions: [], priority: 2, origin: "official", ...patch,
  } as CraftPoolEntry;
}

describe("selectCraftPacks 候选池与优先级（ADR-0034）", () => {
  it("显式 pool：命中触发词的卡返回，reference_path 取 absolute_path", () => {
    const hints = selectCraftPacks("主角陷入危机", 3, [officialPoolEntry({ pack_id: "a", absolute_path: "/abs/a.md" })]);
    expect(hints.map((h) => h.pack_id)).toEqual(["a"]);
    expect(hints[0].reference_path).toBe("/abs/a.md");
  });

  it("同分同 priority：user 卡排在 official 卡前", () => {
    const hints = selectCraftPacks("主角陷入危机", 3, [
      officialPoolEntry({ pack_id: "official-card", origin: "official" }),
      officialPoolEntry({ pack_id: "user-card", origin: "user" }),
    ]);
    expect(hints[0].pack_id).toBe("user-card");
  });

  it("pool 省略：行为与旧版等价（真实库回归，payoff 触发照常命中）", () => {
    const hints = selectCraftPacks("大仇得报，当众打脸", 3);
    expect(hints.map((h) => h.pack_id)).toContain("payoff-delivery");
  });
});

describe("selectCraftPacks 用户卡命中分层置顶（follow-up⑨：手写一等公民）", () => {
  it("user 卡低分命中 + 3 张 official 高分命中，limit=3 → user 卡置顶，official 取前 2 补位", () => {
    const outline = "主角陷入危机";
    const hints = selectCraftPacks(outline, 3, [
      officialPoolEntry({ pack_id: "official-a", triggers: ["危机"], emotion_tags: ["紧张"], priority: 5 }),
      officialPoolEntry({ pack_id: "official-b", triggers: ["危机"], emotion_tags: ["紧张"], priority: 4 }),
      officialPoolEntry({ pack_id: "official-c", triggers: ["危机"], emotion_tags: ["紧张"], priority: 3 }),
      officialPoolEntry({ pack_id: "user-low", triggers: ["危机"], priority: 1, origin: "user" }),
    ]);
    const ids = hints.map((h) => h.pack_id);
    expect(ids).toEqual(["user-low", "official-a", "official-b"]);
  });

  it("无 user 卡命中 → 纯官方排序不变（等价性）", () => {
    const outline = "主角陷入危机";
    const hints = selectCraftPacks(outline, 3, [
      officialPoolEntry({ pack_id: "official-a", triggers: ["危机"], priority: 5 }),
      officialPoolEntry({ pack_id: "official-b", triggers: ["危机"], priority: 4 }),
    ]);
    expect(hints.map((h) => h.pack_id)).toEqual(["official-a", "official-b"]);
  });
});
