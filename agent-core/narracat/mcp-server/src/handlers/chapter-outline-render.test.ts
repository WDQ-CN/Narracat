import { describe, it, expect } from "vitest";
import { renderChapterOutlineMarkdown } from "./chapter-outline-render.js";

const ctx = {
  storylineNames: new Map([["SL-revenge", "复仇线"]]),
  foreshadowingDescriptions: new Map([["F01", "玉佩"]]),
};

describe("renderChapterOutlineMarkdown — new beat skeleton shape", () => {
  it("renders beat skeleton for new shape", () => {
    const md = renderChapterOutlineMarkdown(
      {
        chapter: 4,
        title: "藏经阁对质",
        positioning: "张力峰值章。",
        beats: ["入场压力：进阁。", "升级：拍玉佩。", "翻转：说刻痕。"],
        must_deliver: ["物证呈现"],
        payoff_beat: "reveal",
        storyline_focus: ["SL-revenge"],
        characters: [
          {
            character_uid: "00000000-0000-4000-8000-000000000001",
            name: "沈砚",
          },
        ],
        pov_character: {
          character_uid: "00000000-0000-4000-8000-000000000001",
          name: "沈砚",
        },
        foreshadowing_touch: [{ id: "F01", action: "reveal" }],
      } as never,
      ctx as never,
    );

    // 首行锚点（App 硬契约）
    expect(md.split("\n")[0]).toBe("# 第4章 藏经阁对质");
    expect(md).toContain("## 本章定位");
    expect(md).toContain("张力峰值章。");
    expect(md).toContain("## 场景骨架");
    expect(md).toContain("1. 入场压力：进阁。");
    expect(md).toContain("2. 升级：拍玉佩。");
    expect(md).toContain("3. 翻转：说刻痕。");
    expect(md).toContain("## 必须落地");
    expect(md).toContain("- 物证呈现");
    expect(md).toContain("- 本章爽点: 真相揭示（reveal）");
    expect(md).toContain("- 视角人物: 沈砚");
    expect(md).toContain("- 出场角色: 沈砚"); // 供 parseRenderedOutline
    expect(md).toContain("## 伏笔动作");
    expect(md).toContain("- F01: reveal（玉佩）");
  });

  it("renders storyline name with id for new shape", () => {
    const md = renderChapterOutlineMarkdown(
      {
        chapter: 1,
        title: "开局",
        positioning: "开局定调章。",
        beats: ["beat1"],
        storyline_focus: ["SL-revenge"],
        characters: [],
        pov_character: {
          character_uid: "00000000-0000-4000-8000-000000000001",
          name: "甲",
        },
      } as never,
      ctx as never,
    );
    expect(md).toContain('SL-revenge「复仇线」');
  });

  it("omits must_deliver section when absent in new shape", () => {
    const md = renderChapterOutlineMarkdown(
      {
        chapter: 2,
        title: "无必须落地",
        positioning: "过渡章。",
        beats: ["beat1"],
        storyline_focus: [],
        characters: [],
        pov_character: {
          character_uid: "00000000-0000-4000-8000-000000000001",
          name: "甲",
        },
      } as never,
      ctx as never,
    );
    expect(md).not.toContain("## 必须落地");
  });

  it("payoff_intensity 存在 → 追加强度后缀（issue #429）", () => {
    const md = renderChapterOutlineMarkdown(
      {
        chapter: 4,
        title: "藏经阁对质",
        positioning: "张力峰值章。",
        beats: ["入场压力：进阁。", "升级：拍玉佩。", "翻转：说刻痕。"],
        payoff_beat: "reveal",
        payoff_intensity: "large",
        storyline_focus: ["SL-revenge"],
        characters: [],
        pov_character: {
          character_uid: "00000000-0000-4000-8000-000000000001",
          name: "沈砚",
        },
      } as never,
      ctx as never,
    );
    expect(md).toContain("- 本章爽点: 真相揭示（reveal） · 强度: 大");
  });

  it("payoff_beat 存在但 payoff_intensity 缺失 → 不追加强度后缀", () => {
    const md = renderChapterOutlineMarkdown(
      {
        chapter: 4,
        title: "藏经阁对质",
        positioning: "张力峰值章。",
        beats: ["入场压力：进阁。", "升级：拍玉佩。", "翻转：说刻痕。"],
        payoff_beat: "reveal",
        storyline_focus: ["SL-revenge"],
        characters: [],
        pov_character: {
          character_uid: "00000000-0000-4000-8000-000000000001",
          name: "沈砚",
        },
      } as never,
      ctx as never,
    );
    expect(md).toContain("- 本章爽点: 真相揭示（reveal）");
    expect(md).not.toContain("强度");
  });

  it("omits payoff_beat line when absent in new shape", () => {
    const md = renderChapterOutlineMarkdown(
      {
        chapter: 3,
        title: "无爽点",
        positioning: "铺垫章。",
        beats: ["beat1"],
        storyline_focus: [],
        characters: [],
        pov_character: {
          character_uid: "00000000-0000-4000-8000-000000000001",
          name: "甲",
        },
      } as never,
      ctx as never,
    );
    expect(md).not.toContain("本章爽点");
  });

  it("end_hook 存在 → 渲染「章末钩」行（中文标签+英文枚举）", () => {
    const md = renderChapterOutlineMarkdown(
      {
        chapter: 4,
        title: "藏经阁对质",
        positioning: "张力峰值章。",
        beats: ["入场压力：进阁。", "升级：拍玉佩。", "翻转：说刻痕。"],
        must_deliver: ["物证呈现"],
        payoff_beat: "reveal",
        end_hook: "suspense",
        storyline_focus: ["SL-revenge"],
        characters: [
          {
            character_uid: "00000000-0000-4000-8000-000000000001",
            name: "沈砚",
          },
        ],
        pov_character: {
          character_uid: "00000000-0000-4000-8000-000000000001",
          name: "沈砚",
        },
        foreshadowing_touch: [{ id: "F01", action: "reveal" }],
      } as never,
      ctx as never,
    );
    expect(md).toContain("- 章末钩: 悬念（suspense）");
  });

  it("end_hook 缺省 → 不渲染「章末钩」行（存量数据不变样）", () => {
    const md = renderChapterOutlineMarkdown(
      {
        chapter: 4,
        title: "藏经阁对质",
        positioning: "张力峰值章。",
        beats: ["入场压力：进阁。", "升级：拍玉佩。", "翻转：说刻痕。"],
        must_deliver: ["物证呈现"],
        payoff_beat: "reveal",
        storyline_focus: ["SL-revenge"],
        characters: [
          {
            character_uid: "00000000-0000-4000-8000-000000000001",
            name: "沈砚",
          },
        ],
        pov_character: {
          character_uid: "00000000-0000-4000-8000-000000000001",
          name: "沈砚",
        },
        foreshadowing_touch: [{ id: "F01", action: "reveal" }],
      } as never,
      ctx as never,
    );
    expect(md).not.toContain("章末钩");
  });
});

describe("renderChapterOutlineMarkdown — legacy shape back-compat", () => {
  it("renders legacy md for old shape (back-compat)", () => {
    const md = renderChapterOutlineMarkdown(
      {
        chapter: 1,
        title: "旧",
        value_shift: "信任→怀疑",
        emotional_stakes: "x",
        dramatic_focus: "y",
        storyline_focus: ["SL-revenge"],
        pov_character: {
          character_uid: "00000000-0000-4000-8000-000000000001",
          name: "甲",
        },
        scenes: [
          {
            location: "阁",
            characters: [
              {
                character_uid: "00000000-0000-4000-8000-000000000001",
                name: "甲",
              },
            ],
            pressure_point: "z",
          },
        ],
      } as never,
      ctx as never,
    );
    expect(md.split("\n")[0]).toBe("# 第1章 旧");
    expect(md).toContain("- 价值转换: 信任→怀疑");
    expect(md).toContain("- 情感赌注: x");
    expect(md).toContain("- 戏剧焦点: y");
    expect(md).toContain("## 场景");
    expect(md).toContain("- 出场角色: 甲");
    expect(md).toContain("- 压力点: z");
  });

  it("preserves ending_note in legacy shape", () => {
    const md = renderChapterOutlineMarkdown(
      {
        chapter: 2,
        title: "有结尾注",
        value_shift: "a→b",
        emotional_stakes: "e",
        dramatic_focus: "d",
        storyline_focus: [],
        pov_character: {
          character_uid: "00000000-0000-4000-8000-000000000001",
          name: "乙",
        },
        ending_note: "以黄昏收束",
        scenes: [],
      } as never,
      ctx as never,
    );
    expect(md).toContain("- 章末收尾: 以黄昏收束");
  });
});
