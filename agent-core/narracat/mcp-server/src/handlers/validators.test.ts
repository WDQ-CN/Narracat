import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validateOutlinePayload,
  validateChapterOutlineBatch,
  validateExtraction,
  validateReview,
  validateCommitChapter,
  validateConsolidate,
  validateCascadeImpactReport,
  validateForeshadowingItem,
  checkOutlineSemantics,
  checkOutlineBudget,
  checkDilemmaMilestones,
  checkForeshadowingPayoffTiming,
  FORESHADOWING_PAYOFF_THRESHOLDS,
  checkStructureRhythm,
  STRUCTURE_RHYTHM_THRESHOLDS,
  checkChapterBatch,
  checkChapterProseHygiene,
  checkChapterWordCount,
  scanManuscriptProseHygiene,
  checkPayoffIntensityConsistency,
  checkOpeningRetention,
  checkOpeningArcPayoff,
  checkHookCadence,
  HOOK_CADENCE_THRESHOLDS,
  computeStructureBudget,
  checkNarratorAddress,
  validateDialogueSamples,
  validateStateVocabulary,
  validateCharacterEntity,
  validateAuthoredState,
} from "./validators.js";
import type { OutlinePayload, ChapterOutlineItem, PremiseCardsPayload, PayoffBeat } from "./validators.js";
import { renderChapterOutlineMarkdown } from "./chapter-outline-render.js";

function loadFixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf-8"),
  ) as T;
}

describe("ajv 入口校验（fixture 驱动）", () => {
  it("接受合法的书级大纲 payload", () => {
    const result = validateOutlinePayload(loadFixture("outline-v5-valid-book.json"));
    expect(result.valid).toBe(true);
  });

  it("拒绝缺 arc 必填字段的大纲，并给出 hint", () => {
    const result = validateOutlinePayload(
      loadFixture("outline-v5-invalid-missing-arc-fields.json"),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.every((e) => typeof e.hint === "string" && e.hint.length > 0)).toBe(
        true,
      );
      expect(
        result.errors.some((e) => e.field.includes("irreversible_change")),
      ).toBe(true);
    }
  });

  it("接受合法的章级细纲批量", () => {
    const result = validateChapterOutlineBatch(
      loadFixture("chapter-outline-v5-valid-batch.json"),
    );
    expect(result.valid).toBe(true);
  });

  it("拒绝缺 positioning 的章级细纲", () => {
    const result = validateChapterOutlineBatch(
      loadFixture("chapter-outline-v5-invalid-missing-positioning.json"),
    );
    expect(result.valid).toBe(false);
  });

  it("拒绝角色引用缺 character_uid 的章级细纲", () => {
    const result = validateChapterOutlineBatch(
      loadFixture("chapter-outline-v5-invalid-missing-character-uid.json"),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field.includes("character_uid"))).toBe(true);
    }
  });

  describe("章级细纲 beat 骨架 schema（positioning/beats/must_deliver/characters）", () => {
    const baseChapter = {
      chapter: 4,
      title: "藏经阁对质",
      positioning: "第一卷张力峰值章，玉佩伏笔本章揭示。",
      beats: [
        "入场压力：沈砚借还经书进阁，陆昭已在。",
        "升级：拍出玉佩追问那夜下落。",
        "翻转：说出内圈刻痕，陆昭神色裂开。",
      ],
      must_deliver: ["玉佩来历靠物证呈现不靠旁白"],
      payoff_beat: "reveal",
      storyline_focus: ["SL-revenge"],
      characters: [{ character_uid: "00000000-0000-4000-8000-000000000001", name: "沈砚" }],
      pov_character: { character_uid: "00000000-0000-4000-8000-000000000001", name: "沈砚" },
      foreshadowing_touch: [{ id: "F01", action: "reveal" }],
    };

    it("新 beat 形态章级细纲通过 ajv", () => {
      expect(validateChapterOutlineBatch([baseChapter]).valid).toBe(true);
    });

    it("缺 positioning 时校验失败", () => {
      const rest: Record<string, unknown> = { ...baseChapter };
      delete rest.positioning;
      expect(validateChapterOutlineBatch([rest]).valid).toBe(false);
    });

    it("beats 少于 3 条时校验失败", () => {
      expect(validateChapterOutlineBatch([{ ...baseChapter, beats: ["only", "two"] }]).valid).toBe(
        false,
      );
    });

    it("遗留字段 value_shift 被拒（additionalProperties: false）", () => {
      expect(
        validateChapterOutlineBatch([{ ...baseChapter, value_shift: "信任→怀疑" }]).valid,
      ).toBe(false);
    });

    it("新形态批次走通 validate + checkChapterBatch + render 全链契约，渲染出场景骨架（架构师改产 beat 骨架的下游契约固化）", () => {
      expect(validateChapterOutlineBatch([baseChapter]).valid).toBe(true);

      const chapterArcIndex = new Map<number, { arcId: string; volumeNo: number }>();
      chapterArcIndex.set(4, { arcId: "V01-A01", volumeNo: 1 });
      const refs = {
        chapterArcIndex,
        storylineIds: new Set(["SL-revenge"]),
        foreshadowingIds: new Set(["F01"]),
      };
      const checkResult = checkChapterBatch([baseChapter as unknown as ChapterOutlineItem], refs);
      expect(checkResult.errors).toEqual([]);

      const md = renderChapterOutlineMarkdown(baseChapter as never, {
        storylineNames: new Map(),
        foreshadowingDescriptions: new Map(),
      } as never);
      expect(md).toContain("## 场景骨架");
    });
  });

  describe("chapter_outline end_hook 字段", () => {
    const base = {
      chapter: 5,
      title: "第5章",
      positioning: "arc 中段升级章",
      beats: ["入场压力", "升级", "收尾"],
      storyline_focus: ["SL-main"],
      characters: [{ character_uid: "00000000-0000-4000-8000-000000000001", name: "主角" }],
      pov_character: { character_uid: "00000000-0000-4000-8000-000000000001", name: "主角" },
    };

    it("合法枚举 suspense → valid", () => {
      const r = validateChapterOutlineBatch([{ ...base, end_hook: "suspense" }]);
      expect(r.valid).toBe(true);
    });

    it("不带 end_hook（存量兼容）→ valid", () => {
      const r = validateChapterOutlineBatch([base]);
      expect(r.valid).toBe(true);
    });

    it("非法值 cliffhanger → invalid", () => {
      const r = validateChapterOutlineBatch([{ ...base, end_hook: "cliffhanger" }]);
      expect(r.valid).toBe(false);
    });
  });

  describe("chapter_outline payoff_intensity 字段（issue #429）", () => {
    const base = {
      chapter: 5,
      title: "第5章",
      positioning: "arc 中段升级章",
      beats: ["入场压力", "升级", "收尾"],
      storyline_focus: ["SL-main"],
      characters: [{ character_uid: "00000000-0000-4000-8000-000000000001", name: "主角" }],
      pov_character: { character_uid: "00000000-0000-4000-8000-000000000001", name: "主角" },
    };

    it("合法枚举 medium → valid", () => {
      const r = validateChapterOutlineBatch([
        { ...base, payoff_beat: "reveal", payoff_intensity: "medium" },
      ]);
      expect(r.valid).toBe(true);
    });

    it("不带 payoff_intensity（存量兼容 / 蓄压章）→ valid", () => {
      const r = validateChapterOutlineBatch([base]);
      expect(r.valid).toBe(true);
    });

    it("非法值 huge → invalid", () => {
      const r = validateChapterOutlineBatch([
        { ...base, payoff_beat: "reveal", payoff_intensity: "huge" },
      ]);
      expect(r.valid).toBe(false);
    });

    it("仅 payoff_intensity 无 payoff_beat（语义矛盾）→ dependentRequired 拒绝，hint 指向补 beat 或删 intensity", () => {
      const r = validateChapterOutlineBatch([{ ...base, payoff_intensity: "medium" }]);
      expect(r.valid).toBe(false);
      if (!r.valid) {
        const err = r.errors.find((e) => e.field.includes("payoff_beat"));
        expect(err).toBeDefined();
        expect(err?.hint).toContain("payoff_intensity 依附于 payoff_beat 存在");
        expect(err?.hint).toContain("补上 payoff_beat");
        expect(err?.hint).toContain("删去 payoff_intensity");
      }
    });

    it("payoff_beat 与 payoff_intensity 都有 → valid", () => {
      const r = validateChapterOutlineBatch([
        { ...base, payoff_beat: "face_slap", payoff_intensity: "small" },
      ]);
      expect(r.valid).toBe(true);
    });

    it("payoff_beat 与 payoff_intensity 都无（蓄压章）→ valid", () => {
      const r = validateChapterOutlineBatch([base]);
      expect(r.valid).toBe(true);
    });
  });

  describe("arc antagonist_agent 字段（issue #429）", () => {
    it("合法非空字符串 → valid", () => {
      const payload = loadFixture<Record<string, unknown>>("outline-v5-valid-book.json");
      expect(validateOutlinePayload(payload).valid).toBe(true);
    });

    it("不带 antagonist_agent（日常流 arc 留空）→ valid", () => {
      const payload = loadFixture<{
        volumes: Array<{ arc_list: Array<Record<string, unknown>> }>;
      }>("outline-v5-valid-book.json");
      delete payload.volumes[0].arc_list[0].antagonist_agent;
      expect(validateOutlinePayload(payload).valid).toBe(true);
    });

    it("空字符串（minLength: 1）→ invalid", () => {
      const payload = loadFixture<{
        volumes: Array<{ arc_list: Array<Record<string, unknown>> }>;
      }>("outline-v5-valid-book.json");
      payload.volumes[0].arc_list[0].antagonist_agent = "";
      expect(validateOutlinePayload(payload).valid).toBe(false);
    });
  });

  it("接受合法的章节收尾参数", () => {
    const result = validateCommitChapter(loadFixture("commit-chapter-v5-valid.json"));
    expect(result.valid).toBe(true);
  });

  it("拒绝缺 anchor 的章节收尾参数", () => {
    const result = validateCommitChapter(
      loadFixture("commit-chapter-v5-invalid-missing-anchor.json"),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field.includes("anchor"))).toBe(true);
    }
  });

  it("接受受控谓词与 x- 扩展谓词的事实清单", () => {
    const result = validateExtraction(loadFixture("memory-extraction-v5-valid.json"));
    expect(result.valid).toBe(true);
  });

  it("拒绝词表外且无 x- 前缀的谓词", () => {
    const result = validateExtraction(
      loadFixture("memory-extraction-v5-invalid-predicate.json"),
    );
    expect(result.valid).toBe(false);
  });

  it("接受中文后缀的 x- 自拟谓词（英文后缀兼容存量）", () => {
    const base = loadFixture("memory-extraction-v5-valid.json") as {
      facts: Array<Record<string, unknown>>;
    };
    const result = validateExtraction({
      ...base,
      facts: [
        { subject: "林晚", predicate: "x-恐惧", object: "怕黑，源自幼年矿洞坍塌", change_type: "new" },
        { subject: "林晚", predicate: "x-习惯2", object: "睡前擦拭断剑", change_type: "new" },
        ...base.facts,
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("拒绝空后缀或非法起始字符的 x- 谓词", () => {
    const base = loadFixture("memory-extraction-v5-valid.json") as {
      facts: Array<Record<string, unknown>>;
    };
    for (const predicate of ["x-", "x-_foo", "x-1foo"]) {
      const result = validateExtraction({
        ...base,
        facts: [{ subject: "林晚", predicate, object: "任意值", change_type: "new" }],
      });
      expect(result.valid).toBe(false);
    }
  });

  it("接受空 issues 与含 blocker 的审校提交", () => {
    expect(validateReview(loadFixture("review-report-v5-valid-pass.json")).valid).toBe(true);
    expect(
      validateReview(loadFixture("review-report-v5-valid-fail-blocker.json")).valid,
    ).toBe(true);
  });

  it("拒绝缺 fix_hint 的审校问题", () => {
    const result = validateReview(
      loadFixture("review-report-v5-invalid-missing-fix-hint.json"),
    );
    expect(result.valid).toBe(false);
  });

  it("校验 CascadeImpactReport 四种形态", () => {
    expect(
      validateCascadeImpactReport(loadFixture("cascade-impact-report-valid-with-impact.json"))
        .valid,
    ).toBe(true);
    expect(
      validateCascadeImpactReport(loadFixture("cascade-impact-report-valid-no-impact.json"))
        .valid,
    ).toBe(true);
    expect(
      validateCascadeImpactReport(
        loadFixture("cascade-impact-report-invalid-missing-required.json"),
      ).valid,
    ).toBe(false);
    expect(
      validateCascadeImpactReport(
        loadFixture("cascade-impact-report-invalid-impact-level-typo.json"),
      ).valid,
    ).toBe(false);
  });

  it("has_impact=true 与空 affected_chapters 矛盾时报错", () => {
    const report = loadFixture<Record<string, unknown>>(
      "cascade-impact-report-valid-with-impact.json",
    );
    const result = validateCascadeImpactReport({
      ...report,
      affected_chapters: [],
    });
    expect(result.valid).toBe(false);
  });

  it("缺 change_kind 默认按 chapter_rewrite 校验（向后兼容）", () => {
    // 现有 fixture 无 change_kind 字段，仍应通过
    expect(
      validateCascadeImpactReport(loadFixture("cascade-impact-report-valid-no-impact.json"))
        .valid,
    ).toBe(true);
  });

  it("chapter_rewrite 缺 rewritten_chapter 报错", () => {
    const result = validateCascadeImpactReport({
      change_kind: "chapter_rewrite",
      has_impact: false,
      affected_chapters: [],
    });
    expect(result.valid).toBe(false);
  });

  it("character_added forward：仅建档、无级联，合法", () => {
    expect(
      validateCascadeImpactReport(
        loadFixture("cascade-impact-report-character-added-forward.json"),
      ).valid,
    ).toBe(true);
  });

  it("character_added retroactive：追溯回填已写章（含早于 proposed 的章），合法", () => {
    expect(
      validateCascadeImpactReport(
        loadFixture("cascade-impact-report-character-added-retroactive.json"),
      ).valid,
    ).toBe(true);
  });

  it("character_added 缺 insertion_point 报错", () => {
    const result = validateCascadeImpactReport({
      change_kind: "character_added",
      added_character: "云裳",
      has_impact: false,
      affected_chapters: [],
    });
    expect(result.valid).toBe(false);
  });

  it("character_added 缺 added_character 报错", () => {
    const result = validateCascadeImpactReport({
      change_kind: "character_added",
      insertion_point: "forward",
      has_impact: false,
      affected_chapters: [],
    });
    expect(result.valid).toBe(false);
  });

  it("character_added forward 与 has_impact=true 矛盾时报错", () => {
    const result = validateCascadeImpactReport({
      change_kind: "character_added",
      added_character: "云裳",
      insertion_point: "forward",
      has_impact: true,
      affected_chapters: [
        { chapter: 3, impact_level: "minor", issues: ["x"] },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it("character_added 接受 key_changes.category=character_added", () => {
    const result = validateCascadeImpactReport({
      change_kind: "character_added",
      added_character: "云裳",
      insertion_point: "backward",
      proposed_chapter: 42,
      has_impact: false,
      key_changes: [{ category: "character_added", description: "新增配角云裳" }],
      affected_chapters: [],
    });
    expect(result.valid).toBe(true);
  });

  it("伏笔补登 fragment：target_reveal 接受章号与卷级粗锚点", () => {
    const base = {
      id: "F-TEST",
      type: "medium",
      description: "测试伏笔",
      planted_chapter: 3,
    };
    expect(validateForeshadowingItem({ ...base, target_reveal: "55" }).valid).toBe(true);
    expect(validateForeshadowingItem({ ...base, target_reveal: "vol-08" }).valid).toBe(true);
    expect(validateForeshadowingItem({ ...base, target_reveal: "第55章" }).valid).toBe(false);
  });

  it("consolidate 摘要过短被拒", () => {
    const result = validateConsolidate({
      scope: "arc",
      scope_id: "V01-A01",
      summary: "太短",
    });
    expect(result.valid).toBe(false);
  });
});

describe("computeStructureBudget — 结构预算公式", () => {
  it("按总字数分档", () => {
    expect(computeStructureBudget(60, 3000).tier).toBe("S"); // 18 万
    expect(computeStructureBudget(400, 3000).tier).toBe("M"); // 120 万
    expect(computeStructureBudget(1000, 3000).tier).toBe("L"); // 300 万
    expect(computeStructureBudget(1500, 3000).tier).toBe("XL"); // 450 万
  });

  it("卷数按约 60 章/卷推荐，带宽 40-80", () => {
    const budget = computeStructureBudget(240, 3000);
    expect(budget.volumes.recommended).toBe(4);
    expect(budget.volumes.min).toBe(3);
    expect(budget.volumes.max).toBe(6);
  });

  it("storyline 预算 clamp 在 2..8", () => {
    expect(computeStructureBudget(60, 3000).storyline_budget).toBe(2);
    expect(computeStructureBudget(1500, 3000).storyline_budget).toBe(8);
  });

  it("S 档 payoff_beats 下限为 0，其余档 ≥1", () => {
    expect(computeStructureBudget(60, 3000).payoff_beats_min_per_arc).toBe(0);
    expect(computeStructureBudget(400, 3000).payoff_beats_min_per_arc).toBe(1);
  });
});

describe("结构语义与预算核验", () => {
  const validPayload = () =>
    loadFixture<OutlinePayload>("outline-v5-valid-book.json");

  it("合法大纲通过语义核验", () => {
    const result = checkOutlineSemantics(validPayload());
    expect(result.errors).toEqual([]);
  });

  it("arc 区间不连续时报错", () => {
    const payload = validPayload();
    payload.volumes[0].arc_list[1].chapter_start = 15; // 上一 arc 结束于 12
    const result = checkOutlineSemantics(payload);
    expect(result.errors.some((e) => e.field.includes("V01-A02"))).toBe(true);
  });

  it("arc_id 重复时报错", () => {
    const payload = validPayload();
    payload.volumes[0].arc_list[1].arc_id = "V01-A01";
    const result = checkOutlineSemantics(payload);
    expect(result.errors.some((e) => e.expected === "arc_id 唯一")).toBe(true);
  });

  it("伏笔兑现章早于埋设章时报错（先兑后埋，数值章号）", () => {
    const payload = validPayload();
    payload.foreshadowing_registry[2].planted_chapter = 10; // S-HERB
    payload.foreshadowing_registry[2].target_reveal = "8"; // 兑现早于埋设
    const result = checkOutlineSemantics(payload);
    expect(result.errors.some((e) => e.field.includes("S-HERB"))).toBe(true);
  });

  it("伏笔兑现章等于埋设章时报错（同章先兑后埋）", () => {
    const payload = validPayload();
    payload.foreshadowing_registry[2].planted_chapter = 8;
    payload.foreshadowing_registry[2].target_reveal = "8";
    const result = checkOutlineSemantics(payload);
    expect(result.errors.some((e) => e.field.includes("S-HERB"))).toBe(true);
  });

  it("vol-NN 兑现锚点解析后早于埋设章时报错", () => {
    const payload = validPayload();
    // 卷一末章=24；把 major 埋到第 50 章、却指向卷一兑现 → 24 ≤ 50 先兑后埋
    payload.foreshadowing_registry[0].planted_chapter = 50; // F-TRAITOR
    payload.foreshadowing_registry[0].target_reveal = "vol-01";
    const result = checkOutlineSemantics(payload);
    expect(result.errors.some((e) => e.field.includes("F-TRAITOR"))).toBe(true);
  });

  it("合法伏笔时序（兑现晚于埋设）不报先兑后埋", () => {
    const result = checkOutlineSemantics(validPayload());
    expect(result.errors).toEqual([]);
  });

  it("合法大纲通过预算核验（S 档）", () => {
    const result = checkOutlineBudget(validPayload(), computeStructureBudget(60, 3000));
    expect(result.errors).toEqual([]);
  });

  it("arc 跨度超档位上限时报错", () => {
    const payload = validPayload();
    payload.volumes[0].arc_list[0].chapter_end = 40;
    payload.volumes[0].arc_list[1].chapter_start = 41;
    payload.volumes[0].arc_list[1].chapter_end = 52;
    const result = checkOutlineBudget(payload, computeStructureBudget(60, 3000));
    expect(result.errors.some((e) => e.field === "arc V01-A01")).toBe(true);
  });

  it("困境里程碑随卷序下降时报错", () => {
    const payload = validPayload();
    payload.volumes.push({
      volume_no: 2,
      title: "外门",
      dilemma_milestone: "ability",
      arc_list: [
        {
          arc_id: "V02-A01",
          title: "外门大比",
          chapter_start: 25,
          chapter_end: 36,
          core_question: "林晚能否赢下外门大比?",
          irreversible_change: "林晚进入内门视野",
          next_arc_seed: "内门长老注意到断剑",
          payoff_beats: ["level_up"],
        },
      ],
    });
    const result = checkDilemmaMilestones(payload, null);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("checkForeshadowingPayoffTiming — 伏笔兑现节奏（确定性、非阻断）", () => {
  // 双卷结构（每卷两 arc，各 12 章）：
  //   卷1 V01-A01[1-12] V01-A02[13-24]，卷2 V02-A01[25-36] V02-A02[37-48]
  function twoVolumePayload(): OutlinePayload {
    return {
      central_dramatic_question: "q",
      protagonist_core_desire: "d",
      protagonist_core_lack: "l",
      antagonistic_force: "a",
      stakes_progression: "s",
      storylines: [],
      foreshadowing_registry: [],
      volumes: [
        {
          volume_no: 1,
          title: "卷一",
          arc_list: [
            arc("V01-A01", 1, 12),
            arc("V01-A02", 13, 24),
          ],
        },
        {
          volume_no: 2,
          title: "卷二",
          arc_list: [
            arc("V02-A01", 25, 36),
            arc("V02-A02", 37, 48),
          ],
        },
      ],
    };
  }

  function arc(id: string, start: number, end: number): OutlinePayload["volumes"][number]["arc_list"][number] {
    return {
      arc_id: id,
      title: id,
      chapter_start: start,
      chapter_end: end,
      core_question: "q",
      irreversible_change: "c",
      next_arc_seed: "seed",
      payoff_beats: ["level_up"],
    };
  }

  type FsType = "small" | "medium" | "major";
  function fs(id: string, type: FsType, planted: number, reveal: string): OutlinePayload["foreshadowing_registry"][number] {
    return { id, type, description: id, planted_chapter: planted, target_reveal: reveal };
  }

  // 默认阈值锁定为 2（产品收紧/放宽时此断言会提醒同步测试）
  it("阈值默认每卷至少兑现 2 条 major", () => {
    expect(FORESHADOWING_PAYOFF_THRESHOLDS.major_min_payoffs_per_volume).toBe(2);
  });

  it("small 不跨 arc 时不告警", () => {
    const p = twoVolumePayload();
    p.foreshadowing_registry = [
      fs("S-OK", "small", 1, "8"), // 埋 A01、兑 A01
      // 补足两卷 major 密度，隔离 small 告警
      fs("M1", "major", 1, "10"),
      fs("M2", "major", 2, "11"),
      fs("M3", "major", 25, "30"),
      fs("M4", "major", 26, "31"),
    ];
    const result = checkForeshadowingPayoffTiming(p);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("S-OK"))).toBe(false);
  });

  it("small 跨 arc 时告警，且不阻断（无 errors）", () => {
    const p = twoVolumePayload();
    p.foreshadowing_registry = [fs("S-LATE", "small", 1, "13")]; // 埋 A01、兑 A02
    const result = checkForeshadowingPayoffTiming(p);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("S-LATE") && w.includes("small"))).toBe(true);
  });

  it("medium 不跨卷时不告警", () => {
    const p = twoVolumePayload();
    p.foreshadowing_registry = [
      fs("MED-OK", "medium", 2, "24"), // 埋卷1、兑卷1
      fs("M1", "major", 1, "10"),
      fs("M2", "major", 2, "11"),
      fs("M3", "major", 25, "30"),
      fs("M4", "major", 26, "31"),
    ];
    const result = checkForeshadowingPayoffTiming(p);
    expect(result.warnings.some((w) => w.includes("MED-OK"))).toBe(false);
  });

  it("medium 跨卷时告警", () => {
    const p = twoVolumePayload();
    p.foreshadowing_registry = [fs("MED-LATE", "medium", 2, "25")]; // 埋卷1、兑卷2
    const result = checkForeshadowingPayoffTiming(p);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("MED-LATE") && w.includes("medium"))).toBe(true);
  });

  it("major 扎堆末卷兑现：中段卷密度不足触发告警；跨 1 卷在阈值内不触发跨度告警", () => {
    const p = twoVolumePayload();
    // 4 条 major 全部兑现在卷2，卷1 一条都没有
    p.foreshadowing_registry = [
      fs("F-MAJ-01", "major", 8, "48"), // 埋卷1、兑卷2末（跨 1 卷，≤ 阈值）
      fs("F-MAJ-02", "major", 9, "47"),
      fs("F-MAJ-03", "major", 25, "40"),
      fs("F-MAJ-04", "major", 26, "41"),
    ];
    const result = checkForeshadowingPayoffTiming(p);
    expect(result.errors).toEqual([]);
    // 卷1 密度 0 → 告警
    expect(result.warnings.some((w) => w.includes("第 1 卷 major"))).toBe(true);
    // 跨 1 卷 ≤ major_max_span_volumes（2），不产出单条跨度告警
    expect(result.warnings.some((w) => w.includes("F-MAJ-01") && w.includes("跨度过长"))).toBe(false);
  });

  it("阈值默认单条 major 兑现最多跨 2 卷", () => {
    expect(FORESHADOWING_PAYOFF_THRESHOLDS.major_max_span_volumes).toBe(2);
  });

  it("单条 major 兑现跨度过长：每卷密度都达标也告警（埋卷1兑卷4，跨 3 卷）", () => {
    // 四卷结构（每卷两 arc、各 12 章）：卷1[1-24] 卷2[25-48] 卷3[49-72] 卷4[73-96]
    const p = twoVolumePayload();
    p.volumes = [
      { volume_no: 1, title: "卷一", arc_list: [arc("V01-A01", 1, 12), arc("V01-A02", 13, 24)] },
      { volume_no: 2, title: "卷二", arc_list: [arc("V02-A01", 25, 36), arc("V02-A02", 37, 48)] },
      { volume_no: 3, title: "卷三", arc_list: [arc("V03-A01", 49, 60), arc("V03-A02", 61, 72)] },
      { volume_no: 4, title: "卷四", arc_list: [arc("V04-A01", 73, 84), arc("V04-A02", 85, 96)] },
    ];
    // 每卷各 2 条 major 卷内兑现 → 密度全达标；F-MAJ-01 额外为埋卷1兑卷4的超长线
    p.foreshadowing_registry = [
      fs("M-V1a", "major", 1, "5"),
      fs("M-V1b", "major", 2, "6"),
      fs("M-V2a", "major", 25, "30"),
      fs("M-V2b", "major", 26, "31"),
      fs("M-V3a", "major", 49, "55"),
      fs("M-V3b", "major", 50, "56"),
      fs("M-V4a", "major", 73, "80"),
      fs("M-V4b", "major", 74, "81"),
      fs("F-MAJ-01", "major", 8, "90"), // 埋卷1、兑卷4（跨 3 卷 / 82 章）
    ];
    const result = checkForeshadowingPayoffTiming(p);
    expect(result.errors).toEqual([]);
    // 每卷密度达标 → 无密度告警
    expect(result.warnings.some((w) => w.includes("major 伏笔兑现仅"))).toBe(false);
    // 单条超长 major 仍命中跨度告警，含 id / 跨卷数 / 跨章数
    const spanWarn = result.warnings.find((w) => w.includes("F-MAJ-01") && w.includes("跨度过长"));
    expect(spanWarn).toBeTruthy();
    expect(spanWarn).toContain("跨 3 卷");
    expect(spanWarn).toContain("82 章");
  });

  it("每卷恰好 N 条 major 兑现：不触发密度告警（边界）", () => {
    const p = twoVolumePayload();
    p.foreshadowing_registry = [
      fs("M1", "major", 1, "5"), // 卷1
      fs("M2", "major", 2, "6"), // 卷1
      fs("M3", "major", 25, "30"), // 卷2
      fs("M4", "major", 26, "31"), // 卷2
    ];
    const result = checkForeshadowingPayoffTiming(p);
    expect(result.warnings.some((w) => w.includes("major 伏笔兑现"))).toBe(false);
  });

  it("某卷少一条 major（N-1）：触发该卷密度告警（边界）", () => {
    const p = twoVolumePayload();
    p.foreshadowing_registry = [
      fs("M1", "major", 1, "5"), // 卷1：1 条
      fs("M3", "major", 25, "30"), // 卷2：2 条
      fs("M4", "major", 26, "31"),
    ];
    const result = checkForeshadowingPayoffTiming(p);
    expect(result.warnings.some((w) => w.includes("第 1 卷 major"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("第 2 卷 major"))).toBe(false);
  });

  it("target_reveal 兼容 vol-VV 粗锚点：解析为该卷最后一章归户", () => {
    const p = twoVolumePayload();
    p.foreshadowing_registry = [
      fs("M1", "major", 1, "vol-01"), // 卷1 末章=24 → 归卷1
      fs("M2", "major", 2, "vol-01"),
      fs("M3", "major", 25, "vol-02"), // 卷2 末章=48 → 归卷2
      fs("M4", "major", 26, "vol-02"),
    ];
    const result = checkForeshadowingPayoffTiming(p);
    expect(result.warnings.some((w) => w.includes("major 伏笔兑现"))).toBe(false);
  });

  it("一律产出 warning、绝不返回 errors（非阻断契约）", () => {
    const p = twoVolumePayload();
    p.foreshadowing_registry = [
      fs("S-LATE", "small", 1, "20"), // 跨 arc 且跨卷
      fs("MED-LATE", "medium", 2, "30"), // 跨卷
      // major 全空 → 两卷都密度告警
    ];
    const result = checkForeshadowingPayoffTiming(p);
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("checkStructureRhythm — 结构节奏反退化门控", () => {
  const S_BUDGET = computeStructureBudget(60, 3000); // S 档：arc_span {5,15}，total 60
  const XL_BUDGET = computeStructureBudget(2400, 3000); // XL 档：arc_span {20,40}，total 2400

  function arc(id: string, start: number, end: number): OutlinePayload["volumes"][number]["arc_list"][number] {
    return {
      arc_id: id,
      title: id,
      chapter_start: start,
      chapter_end: end,
      core_question: "q",
      irreversible_change: "c",
      next_arc_seed: "s",
      payoff_beats: ["level_up"],
    };
  }
  function sl(
    id: string,
    entry: number,
    payoff?: number,
  ): OutlinePayload["storylines"][number] {
    return {
      id,
      name: id,
      type: "other",
      priority: 9,
      entry_chapter: entry,
      ...(payoff !== undefined ? { planned_payoff_chapter: payoff } : {}),
    };
  }
  function fsItem(
    id: string,
    type: "small" | "medium" | "major",
    planted: number,
    reveal: string,
  ): OutlinePayload["foreshadowing_registry"][number] {
    return { id, type, description: id, planted_chapter: planted, target_reveal: reveal };
  }
  function payloadWith(partial: Partial<OutlinePayload>): OutlinePayload {
    return {
      central_dramatic_question: "q",
      protagonist_core_desire: "d",
      protagonist_core_lack: "l",
      antagonistic_force: "a",
      stakes_progression: "s",
      storylines: partial.storylines ?? [],
      foreshadowing_registry: partial.foreshadowing_registry ?? [],
      volumes: partial.volumes ?? [],
    };
  }
  // 把一串 arc 长度铺成单卷 arc_list（章号连续）
  function volFromLengths(lengths: number[]): OutlinePayload["volumes"] {
    const arcs: OutlinePayload["volumes"][number]["arc_list"] = [];
    let cursor = 1;
    lengths.forEach((len, i) => {
      arcs.push(arc(`V01-A${String(i + 1).padStart(2, "0")}`, cursor, cursor + len - 1));
      cursor += len;
    });
    return [{ volume_no: 1, title: "卷一", arc_list: arcs }];
  }

  it("阈值默认：arc 众数占比上限 0.6、arc 数下限 6（产品收紧/放宽时提醒同步）", () => {
    expect(STRUCTURE_RHYTHM_THRESHOLDS.arc_mode_share_max).toBe(0.6);
    expect(STRUCTURE_RHYTHM_THRESHOLDS.arc_rhythm_min_arcs).toBe(6);
  });

  it("D1：≥6 个 arc 全等长 → ERROR", () => {
    const p = payloadWith({ volumes: volFromLengths([30, 30, 30, 30, 30, 30, 30, 30]) });
    const result = checkStructureRhythm(p, XL_BUDGET);
    expect(result.errors.some((e) => e.field === "arc 长短节奏")).toBe(true);
    const err = result.errors.find((e) => e.field === "arc 长短节奏");
    expect(err?.hint).toMatch(/arc-rhythm/);
  });

  it("D1：arc 长短错落（众数占比 ≤60%）→ 不报错", () => {
    const p = payloadWith({ volumes: volFromLengths([8, 12, 30, 6, 40, 10, 25, 15]) });
    const result = checkStructureRhythm(p, XL_BUDGET);
    expect(result.errors).toEqual([]);
  });

  it("D1：小书（<6 arc）即便全等长也豁免", () => {
    const p = payloadWith({ volumes: volFromLengths([30, 30, 30, 30, 30]) });
    const result = checkStructureRhythm(p, XL_BUDGET);
    expect(result.errors).toEqual([]);
  });

  it("D2：≥3 条故事线全部 entry_chapter=1 → ERROR", () => {
    const p = payloadWith({
      storylines: [sl("SL-1", 1), sl("SL-2", 1), sl("SL-3", 1)],
    });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.errors.some((e) => e.field === "storylines.entry_chapter")).toBe(true);
    const err = result.errors.find((e) => e.field === "storylines.entry_chapter");
    expect(err?.hint).toMatch(/storyline-weave/);
  });

  it("D2：故事线错峰入场（entry 不全为 1）→ 不报全 ch1", () => {
    const p = payloadWith({
      storylines: [sl("SL-1", 1), sl("SL-2", 5), sl("SL-3", 12)],
    });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.errors).toEqual([]);
  });

  it("D2：小书（<3 故事线）全 ch1 也豁免", () => {
    const p = payloadWith({ storylines: [sl("SL-1", 1), sl("SL-2", 1)] });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.errors).toEqual([]);
  });

  it("D2：≥4 条故事线无一条在中段收线 → WARNING（不阻断）", () => {
    // S_BUDGET total=60 → 中段窗口 [6, 51]；payoff 全 60（>51）→ 无中段收线
    const p = payloadWith({
      storylines: [sl("SL-1", 1, 60), sl("SL-2", 5, 60), sl("SL-3", 10, 60), sl("SL-4", 15, 60)],
    });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("中段"))).toBe(true);
  });

  it("D2：≥4 条故事线有一条落在中段窗口 → 不告警", () => {
    const p = payloadWith({
      storylines: [sl("SL-1", 1, 30), sl("SL-2", 5, 60), sl("SL-3", 10, 60), sl("SL-4", 15, 60)],
    });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.warnings.some((w) => w.includes("中段"))).toBe(false);
  });

  it("D2：小书（<4 故事线）不判中段收线", () => {
    const p = payloadWith({
      storylines: [sl("SL-1", 1, 60), sl("SL-2", 5, 60), sl("SL-3", 10, 60)],
    });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.warnings.some((w) => w.includes("中段"))).toBe(false);
  });

  it("D2：≥4 条故事线全部无 planned_payoff_chapter → 仍触发中段收线 WARNING", () => {
    const p = payloadWith({
      storylines: [sl("SL-1", 1), sl("SL-2", 5), sl("SL-3", 10), sl("SL-4", 15)],
    });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("中段"))).toBe(true);
  });

  it("D3：small 伏笔跨度 >2×arc_span.max → ERROR（死伏笔）", () => {
    // S 档 arc_span.max=15 → errMax=30；埋 1 兑 458 → span 457
    const p = payloadWith({ foreshadowing_registry: [fsItem("S-DEAD", "small", 1, "458")] });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.errors.some((e) => e.field === "foreshadowing S-DEAD")).toBe(true);
    const err = result.errors.find((e) => e.field === "foreshadowing S-DEAD");
    expect(err?.hint).toMatch(/foreshadow-distance/);
  });

  it("D3：small 跨度在 (1×,2×] arc_span.max → WARNING（不阻断）", () => {
    // warnMax=15 < span 19 ≤ errMax=30：埋 1 兑 20
    const p = payloadWith({ foreshadowing_registry: [fsItem("S-FAR", "small", 1, "20")] });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("S-FAR") && w.includes("small"))).toBe(true);
  });

  it("D3：small 在 arc 内快速兑现（跨度 ≤ arc_span.max）→ 不报", () => {
    // 埋 1 兑 8 → span 7 ≤ 15
    const p = payloadWith({ foreshadowing_registry: [fsItem("S-OK", "small", 1, "8")] });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("S-OK"))).toBe(false);
  });

  it("D3：small 用卷级粗锚点 vol-NN → WARNING", () => {
    const p = payloadWith({ foreshadowing_registry: [fsItem("S-VOL", "small", 1, "vol-08")] });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("S-VOL") && w.includes("small"))).toBe(true);
  });

  it("D3：major 早埋（书前 5%）却用 vol-NN 粗锚 → WARNING", () => {
    // early plant 阈值 = 60×0.05 = 3；埋 2 ≤ 3
    const p = payloadWith({ foreshadowing_registry: [fsItem("M-EARLY", "major", 2, "vol-08")] });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("M-EARLY") && w.includes("major"))).toBe(true);
  });

  it("D3：major 晚埋用 vol-NN 不告警（远期 major 适合卷级粗锚）", () => {
    const p = payloadWith({ foreshadowing_registry: [fsItem("M-LATE", "major", 30, "vol-08")] });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.warnings.some((w) => w.includes("M-LATE"))).toBe(false);
  });

  it("D3：major 用确切章号不触发粗锚告警", () => {
    const p = payloadWith({ foreshadowing_registry: [fsItem("M-NUM", "major", 2, "55")] });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.warnings.some((w) => w.includes("M-NUM"))).toBe(false);
  });

  it("D3：small 跨度恰为 2×arc_span.max（span=30）→ WARNING 非 ERROR（边界）", () => {
    // 埋 1 兑 31 → span 30；30 > errMax(30) 为 false → 落 WARNING
    const p = payloadWith({ foreshadowing_registry: [fsItem("S-BND30", "small", 1, "31")] });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("S-BND30") && w.includes("small"))).toBe(true);
  });

  it("D3：small 跨度恰为 1×arc_span.max（span=15）→ 不报（边界）", () => {
    // 埋 1 兑 16 → span 15；15 > warnMax(15) 为 false → 无告警
    const p = payloadWith({ foreshadowing_registry: [fsItem("S-OK15", "small", 1, "16")] });
    const result = checkStructureRhythm(p, S_BUDGET);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("S-OK15"))).toBe(false);
  });

  it("真实健康夹具 outline-v5-valid-book 不被任何门控误杀", () => {
    const payload = loadFixture<OutlinePayload>("outline-v5-valid-book.json");
    const result = checkStructureRhythm(payload, computeStructureBudget(60, 3000));
    expect(result.errors).toEqual([]);
  });
});

describe("checkChapterBatch — 章级引用一致性", () => {
  const chapterArcIndex = new Map<number, { arcId: string; volumeNo: number }>();
  for (let c = 1; c <= 12; c += 1) chapterArcIndex.set(c, { arcId: "V01-A01", volumeNo: 1 });
  for (let c = 13; c <= 24; c += 1) chapterArcIndex.set(c, { arcId: "V01-A02", volumeNo: 1 });

  const refs = {
    chapterArcIndex,
    storylineIds: new Set(["SL-main", "SL-growth"]),
    foreshadowingIds: new Set(["F-SWORD-CORE", "S-HERB"]),
  };

  it("合法批次通过并返回覆盖的 arc", () => {
    const chapters = loadFixture<ChapterOutlineItem[]>("chapter-outline-v5-valid-batch.json");
    const result = checkChapterBatch(chapters, refs);
    expect(result.errors).toEqual([]);
    expect(result.arcsCovered).toEqual(["V01-A01"]);
  });

  it("引用未注册故事线时报错", () => {
    const chapters = loadFixture<ChapterOutlineItem[]>("chapter-outline-v5-valid-batch.json");
    chapters[0].storyline_focus = ["SL-unknown"];
    const result = checkChapterBatch(chapters, refs);
    expect(result.errors.some((e) => e.actual === "SL-unknown")).toBe(true);
  });

  it("章号不在任何 arc 区间内时报错", () => {
    const chapters = loadFixture<ChapterOutlineItem[]>("chapter-outline-v5-valid-batch.json");
    chapters[0].chapter = 99;
    const result = checkChapterBatch(chapters, refs);
    expect(result.errors.some((e) => e.field === "chapter 99")).toBe(true);
  });
});

describe("checkPayoffIntensityConsistency — 爽点强度配对完整性（issue #429，WARN 不阻断）", () => {
  const mk = (
    chapter: number,
    payoff_beat?: PayoffBeat,
    payoff_intensity?: "small" | "medium" | "large",
  ) => ({ chapter, payoff_beat, payoff_intensity }) as unknown as ChapterOutlineItem;

  it("有 payoff_beat 但缺 payoff_intensity → WARN 触发，报出章号", () => {
    const result = checkPayoffIntensityConsistency([mk(5, "reveal")]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("第 5 章");
    expect(result.warnings[0]).toContain("payoff_intensity");
  });

  it("有 payoff_beat 且已标 payoff_intensity → 不触发", () => {
    const result = checkPayoffIntensityConsistency([mk(5, "reveal", "large")]);
    expect(result.warnings).toEqual([]);
  });

  it("无 payoff_beat（蓄压章）→ 不触发，不强求填强度", () => {
    const result = checkPayoffIntensityConsistency([mk(5)]);
    expect(result.warnings).toEqual([]);
  });

  it("多章缺失时合并进一条 WARN，按章号升序列出", () => {
    const result = checkPayoffIntensityConsistency([
      mk(9, "face_slap"),
      mk(3, "reveal"),
      mk(6, "reveal", "medium"), // 已标强度，不计入缺失
    ]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("第 3、9 章");
  });

  it("不做强度倒序/递增校验：large 后紧跟 small 不触发任何 WARN", () => {
    const result = checkPayoffIntensityConsistency([
      mk(5, "reveal", "large"),
      mk(6, "sweet", "small"),
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe("checkNarratorAddress — 叙述人称受控校验", () => {
  const narratorCard = (
    fields: Array<{ key: string; value: string; certainty?: string }>,
  ): PremiseCardsPayload =>
    ({ cards: [{ card: "narrator_voice", fields }] }) as unknown as PremiseCardsPayload;

  const noNarratorCard = {
    cards: [{ card: "core_hook", fields: [{ key: "hook", value: "黄金三章承诺" }] }],
  } as unknown as PremiseCardsPayload;

  // —— 值域合法性：无条件，两种 requirePresence 都拦非法值（修订路径不能架空受控值域）——
  it("address 非受控枚举值报错（含存量自由文本）", () => {
    const errors = checkNarratorAddress(narratorCard([{ key: "address", value: "第三人称" }]));
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("narrator_voice.address");
    expect(errors[0].actual).toBe("第三人称");
  });

  it("值域无条件：requirePresence=false（修订路径）仍拦非法 address，不被 merge 豁免架空", () => {
    const errors = checkNarratorAddress(narratorCard([{ key: "address", value: "第三人称" }]), {
      requirePresence: false,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("narrator_voice.address");
  });

  it("address 为四个合法枚举值之一时通过", () => {
    for (const value of ["first_person", "third_limited", "third_omniscient", "multi_pov"]) {
      expect(checkNarratorAddress(narratorCard([{ key: "address", value }]))).toEqual([]);
    }
  });

  it("address 标 certainty=open（有意留白）豁免值域校验", () => {
    expect(
      checkNarratorAddress(narratorCard([{ key: "address", value: "", certainty: "open" }])),
    ).toEqual([]);
  });

  // —— 存在性：仅 requirePresence（默认 true=全量立项；false=定点修订豁免）——
  it("默认（全量立项）：缺 narrator_voice 卡报错", () => {
    const errors = checkNarratorAddress(noNarratorCard);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("narrator_voice");
  });

  it("默认（全量立项）：narrator_voice 缺 address 字段报错", () => {
    const errors = checkNarratorAddress(narratorCard([{ key: "archetype", value: "冷峻说书人" }]));
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("narrator_voice.address");
    expect(errors[0].actual).toContain("缺 address");
  });

  it("requirePresence=false（修订）：缺卡 / 缺 address 均豁免存在性", () => {
    expect(checkNarratorAddress(noNarratorCard, { requirePresence: false })).toEqual([]);
    expect(
      checkNarratorAddress(narratorCard([{ key: "archetype", value: "冷峻说书人" }]), {
        requirePresence: false,
      }),
    ).toEqual([]);
  });
});

describe("validateDialogueSamples — 台词语料校验", () => {
  const validSample = () => ({
    chapter: 5,
    samples: [
      {
        character: "阿九",
        dialogue_text: "关你什么事。",
        dialogue_type: "dialogue",
      },
    ],
  });

  it("合法的最小 DialogueSamples 通过校验", () => {
    const result = validateDialogueSamples(validSample());
    expect(result.valid).toBe(true);
  });

  it("含可选字段的完整样本通过校验", () => {
    const result = validateDialogueSamples({
      chapter: 3,
      samples: [
        {
          character: "沈知言",
          dialogue_text: "以为在说我。",
          dialogue_type: "monologue",
          context: "书房独处时",
          emotion: "self-aware",
          position_in_chapter: 42,
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("缺 chapter 时校验失败", () => {
    const result = validateDialogueSamples({
      samples: [{ character: "阿九", dialogue_text: "嗯。", dialogue_type: "dialogue" }],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field.includes("chapter"))).toBe(true);
    }
  });

  it("缺 samples 时校验失败", () => {
    const result = validateDialogueSamples({ chapter: 1 });
    expect(result.valid).toBe(false);
  });

  it("samples[].dialogue_type 非法枚举值校验失败", () => {
    const result = validateDialogueSamples({
      chapter: 1,
      samples: [
        {
          character: "阿九",
          dialogue_text: "随便你。",
          dialogue_type: "narration", // 非法值
        },
      ],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field.includes("dialogue_type"))).toBe(true);
    }
  });

  it("samples[].dialogue_text 超过 500 字符时校验失败", () => {
    const result = validateDialogueSamples({
      chapter: 1,
      samples: [
        {
          character: "阿九",
          dialogue_text: "a".repeat(501),
          dialogue_type: "dialogue",
        },
      ],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field.includes("dialogue_text"))).toBe(true);
    }
  });

  it("samples[] 为空数组时通过（无台词也合法）", () => {
    const result = validateDialogueSamples({ chapter: 1, samples: [] });
    expect(result.valid).toBe(true);
  });

  it("缺 dialogue_text 时校验失败", () => {
    const result = validateDialogueSamples({
      chapter: 2,
      samples: [{ character: "阿九", dialogue_type: "thought" }],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field.includes("dialogue_text"))).toBe(true);
    }
  });
});

describe("checkOpeningRetention — 开局留存门控", () => {
  const mk = (chapter: number, payoff_beat?: PayoffBeat): ChapterOutlineItem =>
    ({
      chapter,
      title: `第${chapter}章`,
      positioning: "开局章定位",
      beats: ["入场压力", "升级", "收尾钩子"],
      payoff_beat,
      storyline_focus: ["SL-main"],
      characters: [{ character_uid: "U1", name: "主角" }],
      pov_character: { character_uid: "U1", name: "主角" },
    }) as ChapterOutlineItem;

  it("黄金三章 payoff_beat 全空 → D-open-1 ERROR", () => {
    const result = checkOpeningRetention([mk(1), mk(2), mk(3), mk(4, "face_slap")]);
    expect(result.errors.some((e) => e.field === "开局 payoff_beat")).toBe(true);
  });

  it("黄金三章含 1 个 payoff_beat → 无 D-open-1（errors 空）", () => {
    const result = checkOpeningRetention([mk(1), mk(2, "windfall"), mk(3)]);
    expect(result.errors).toEqual([]);
  });

  it("非开局批（无章号 ≤3）→ no-op，零 errors 零 warnings", () => {
    const result = checkOpeningRetention([mk(8), mk(9), mk(10)]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("开局批 >5 连续章零爽点 → D-open-2 WARN，不阻断", () => {
    // ch1 有爽点过 D-open-1；ch2-15 连续 14 章空
    const chapters = [mk(1, "level_up"), ...Array.from({ length: 14 }, (_, i) => mk(i + 2))];
    const result = checkOpeningRetention(chapters);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("死区"))).toBe(true);
  });

  it("开局批恰好 4 连续章零爽点 → 无 D-open-2 WARN（>4 边界下侧）", () => {
    // ch1 有爽点过 D-open-1；ch2-5 恰好 4 连续空，maxGap=4 不 >4
    const chapters = [mk(1, "level_up"), mk(2), mk(3), mk(4), mk(5), mk(6, "fame")];
    const result = checkOpeningRetention(chapters);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("开局批恰好 5 连续章零爽点 → D-open-2 WARN（>4 边界上侧，#340 复核收紧 5→4）", () => {
    // ch1 有爽点过 D-open-1；ch2-6 恰好 5 连续空，maxGap=5 > 4 → 触发死区 WARN
    const result = checkOpeningRetention([mk(1, "level_up"), mk(2), mk(3), mk(4), mk(5), mk(6)]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("死区"))).toBe(true);
  });

  it("黄金三章不齐全（有 ch1 缺 ch3）→ defer，不判 D-open-1", () => {
    // 窗口化提交下开局 arc 尚未规划完，黄金三章未齐全，不应误判「全空」（P1 修复）
    const result = checkOpeningRetention([mk(1), mk(2)]);
    expect(result.errors).toEqual([]);
  });
});

describe("checkOpeningArcPayoff — 开局 arc 爽点底线（阶段一）", () => {
  it("开局 arc(ch1) payoff_beats 为空 → ERROR", () => {
    const p = loadFixture<OutlinePayload>("outline-v5-valid-book.json");
    p.volumes[0].arc_list[0].payoff_beats = [];
    const result = checkOpeningArcPayoff(p);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toContain("payoff_beats");
  });

  it("开局 arc 有 ≥1 payoff_beats → pass（健康夹具 V01-A01=[face_slap,level_up]）", () => {
    const p = loadFixture<OutlinePayload>("outline-v5-valid-book.json");
    expect(checkOpeningArcPayoff(p).errors).toEqual([]);
  });

  it("无开局 arc（无 chapter_start===1，如补卷）→ no-op", () => {
    const p = loadFixture<OutlinePayload>("outline-v5-valid-book.json");
    p.volumes[0].arc_list[0].chapter_start = 100;
    expect(checkOpeningArcPayoff(p).errors).toEqual([]);
  });
});

describe("checkChapterProseHygiene — 大纲散文洁净门", () => {
  const clean = {
    chapter: 4,
    positioning: "本章收束这条线：苏见当众揭穿掌门伪善，并想通真凶是体系而非某个人。",
    beats: [
      "入场压力：苏见进茶馆听说书。",
      "翻转·揭示：拍出处分单当众对质。",
      "收尾：巷口青衫人塞碎银离开。",
    ],
    must_deliver: ["苏见以物证戳穿谎言，不靠旁白点题"],
  } as unknown as ChapterOutlineItem;

  it("干净中文散文（含中文 beat 标签「翻转·揭示」「收尾」）零 ERROR", () => {
    expect(checkChapterProseHygiene([clean])).toEqual([]);
  });

  it("positioning 含英文枚举 face_slap → ERROR", () => {
    const dirty = {
      ...clean,
      positioning: "arc 闭合章，face_slap + reveal 双 payoff 兑现",
    } as ChapterOutlineItem;
    expect(checkChapterProseHygiene([dirty]).some((e) => e.actual.includes("机器 token"))).toBe(
      true,
    );
  });

  it("beats 含伏笔编号 F-SML-04 / arc id V01-A03 → ERROR", () => {
    const dirty = {
      ...clean,
      beats: ["F-SML-04 说书人兑现，为 V01-A03 埋线"],
    } as unknown as ChapterOutlineItem;
    expect(checkChapterProseHygiene([dirty]).length).toBeGreaterThan(0);
  });

  it("must_deliver 含 snake_case 字段名 next_arc_seed → ERROR", () => {
    const dirty = {
      ...clean,
      must_deliver: ["next_arc_seed 落在茶馆角落一个听客"],
    } as ChapterOutlineItem;
    expect(checkChapterProseHygiene([dirty]).some((e) => e.actual.includes("机器 token"))).toBe(
      true,
    );
  });

  it("storyline id SL-revenge → ERROR", () => {
    const dirty = { ...clean, positioning: "本章推进 SL-revenge。" } as ChapterOutlineItem;
    expect(checkChapterProseHygiene([dirty]).length).toBeGreaterThan(0);
  });

  it("散文含破折号 —— → ERROR（破折号提示）", () => {
    const dirty = {
      ...clean,
      beats: ["苏见进阁——陆昭已在"],
    } as unknown as ChapterOutlineItem;
    expect(checkChapterProseHygiene([dirty]).some((e) => e.expected.includes("不使用破折号"))).toBe(
      true,
    );
  });

  it("章号范围「20-30」等纯数字连字符不误杀", () => {
    const ok = { ...clean, must_deliver: ["为第 20-30 章的高潮蓄势"] } as ChapterOutlineItem;
    expect(checkChapterProseHygiene([ok])).toEqual([]);
  });

  it("裸术语词表 arc / payoff（不含 snake_case/编号）单独命中 → ERROR（隔离词表分支）", () => {
    const dirty = {
      ...clean,
      positioning: "本章是这条线的 arc 收束，payoff 落在打脸。",
    } as ChapterOutlineItem;
    expect(checkChapterProseHygiene([dirty]).some((e) => e.actual.includes("机器 token"))).toBe(
      true,
    );
  });

  it("散文里出现 UUID → ERROR（隔离 UUID 分支）", () => {
    const dirty = {
      ...clean,
      must_deliver: ["交付给角色 a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"],
    } as ChapterOutlineItem;
    expect(checkChapterProseHygiene([dirty]).some((e) => e.actual.includes("机器 token"))).toBe(
      true,
    );
  });

  it("短伏笔编号 F01（无连字符）→ ERROR", () => {
    const dirty = { ...clean, beats: ["F01 伏笔在本章兑现"] } as unknown as ChapterOutlineItem;
    expect(checkChapterProseHygiene([dirty]).some((e) => e.actual.includes("机器 token"))).toBe(
      true,
    );
  });

  it("单字母+单数字（A4/B2 纸张页码类）不误杀", () => {
    const ok = { ...clean, must_deliver: ["拿出一张 A4 大小的纸"] } as ChapterOutlineItem;
    expect(checkChapterProseHygiene([ok])).toEqual([]);
  });
});

describe("scanManuscriptProseHygiene — 正文散文洁净门（去 AI 味）", () => {
  // 一段无破折号、无「不是X是Y」的干净散文（约 40 汉字）
  const cleanPara =
    "他握紧长刀缓步走进院子，风掠过瓦檐卷起满地枯叶，远处传来一声闷响，众人屏住呼吸不敢出声。";
  const para = (n: number) => Array.from({ length: n }, () => cleanPara).join("\n");
  // 一整章体量（约 2200 汉字），贴近真实章长，密度判定才有意义
  const chapterBody = para(55);

  it("干净散文（无破折号、无对仗转折）零命中", () => {
    expect(scanManuscriptProseHygiene(chapterBody).errors).toEqual([]);
  });

  it("整章零星破折号（低于阈值）不误伤", () => {
    // 一整章约 2200 字里 2 个破折号 ≈ 0.9/千字，低于 2.0 阈值
    const text = chapterBody + "\n他停住——身后有人。\n刀光一闪——血溅上墙。";
    const { errors, stats } = scanManuscriptProseHygiene(text);
    expect(stats.emDashCount).toBe(2);
    expect(errors).toEqual([]);
  });

  it("破折号密度超标 → 命中破折号错误", () => {
    const dashes = Array.from({ length: 12 }, () => "他停住——身后有人。").join("\n");
    const { errors, stats } = scanManuscriptProseHygiene(chapterBody + "\n" + dashes);
    expect(stats.emDashCount).toBe(12);
    expect(errors.some((e) => e.field === "破折号密度")).toBe(true);
  });

  it("「不是X是Y」对仗密度超标（分散在不同段落）→ 命中对仗错误（密度分支）", () => {
    const anti = [
      "这一次他明白了，不是天赋差，而是从没拼过命。",
      "她终于看清，不是刀快，是握刀的人快。",
      "他忽然懂了，不是运气，是十年苦功。",
      "众人这才反应过来，不是他退了，是敌人跪了。",
    ].join("\n");
    const { errors, stats } = scanManuscriptProseHygiene(chapterBody + "\n" + anti);
    expect(stats.antithesisCount).toBe(4);
    expect(stats.maxAntithesisInParagraph).toBe(1); // 各在独立段落，非连排
    const hit = errors.find((e) => e.field === "「不是…是…」对仗转折");
    expect(hit).toBeDefined();
    expect(hit?.actual).toContain("/千字");
  });

  it("「不是X是Y」同段连排 → 即便文本短（密度关闭）也命中（连排硬禁）", () => {
    const text = "他忽然懂了，不是刀快，是心快，不是招狠，而是人狠。";
    const { errors, stats } = scanManuscriptProseHygiene(text);
    expect(stats.hanzi).toBeLessThan(500); // 不足最小样本，密度分支关闭
    expect(stats.maxAntithesisInParagraph).toBeGreaterThanOrEqual(2);
    const hit = errors.find((e) => e.field === "「不是…是…」对仗转折");
    expect(hit).toBeDefined();
    expect(hit?.expected).toContain("连排");
  });

  it("字面「不是…而是…」与换标点变体「不是X——是Y」都被捕获", () => {
    const literal = scanManuscriptProseHygiene("他说，不是我不想，而是我不能。他说，不是我不想，而是我不能。");
    expect(literal.stats.antithesisCount).toBe(2);
    const variant = scanManuscriptProseHygiene("这不是运气——是实力，这不是运气——是实力。");
    expect(variant.stats.antithesisCount).toBe(2);
  });

  it("整章零星「不是X是Y」（正常否定陈述、低密度）不误伤", () => {
    // 一整章约 2200 字里 2 处正常否定 ≈ 0.9/千字，低于 1.0 阈值，各在独立段落
    const text = chapterBody + "\n他不是本地人，是外地来的。\n那不是铁，是精钢。";
    const { errors, stats } = scanManuscriptProseHygiene(text);
    expect(stats.antithesisCount).toBe(2);
    expect(stats.maxAntithesisInParagraph).toBe(1);
    expect(errors).toEqual([]);
  });

  it("跨句陈述「他不是本地人。他是外地人」不被当作对仗（句号界断）", () => {
    const { stats } = scanManuscriptProseHygiene("他不是本地人。他是外地人。".repeat(30));
    expect(stats.antithesisCount).toBe(0);
  });
});

describe("checkHookCadence — 章末钩节奏门", () => {
  const mk = (chapter: number, end_hook?: "suspense" | "danger" | "emotional" | "none") =>
    ({ chapter, end_hook });

  it("连续 3 章显式 none → W2 告警", () => {
    const r = checkHookCadence([mk(5, "none"), mk(6, "none"), mk(7, "none")], new Set([5, 6, 7]));
    expect(r.warnings.some((w) => w.includes("连续 3 章"))).toBe(true);
  });

  it("2 章 none + 1 章 suspense → 无告警", () => {
    const r = checkHookCadence(
      [mk(5, "none"), mk(6, "none"), mk(7, "suspense")],
      new Set([5, 6, 7]),
    );
    expect(r.warnings).toEqual([]);
  });

  it("存量章缺字段 = unknown 截断，不误报也不被 W1 点名", () => {
    // 5-6 是存量落盘章（无 end_hook 字段），7-8 本批显式 none：unknown 截断，连续段只有 2
    const r = checkHookCadence([mk(5), mk(6), mk(7, "none"), mk(8, "none")], new Set([7, 8]));
    expect(r.warnings).toEqual([]);
  });

  it("章号断档（窗口内未规划章）截断连续段", () => {
    const r = checkHookCadence([mk(5, "none"), mk(6, "none"), mk(9, "none")], new Set([5, 6, 9]));
    expect(r.warnings).toEqual([]);
  });

  it("W1: 本批章缺 end_hook 字段 → 提醒补填，且只报本批", () => {
    const r = checkHookCadence([mk(5), mk(6)], new Set([6]));
    expect(r.warnings.some((w) => w.includes("第 6 章") && w.includes("end_hook"))).toBe(true);
    expect(r.warnings.every((w) => !w.includes("第 5 章"))).toBe(true);
  });

  it("跨批连续段：存量显式 none + 本批 none 拼出 3 连 → 告警", () => {
    // 5-6 存量已落盘且显式 none，本批只提交 7=none —— 合并后 3 连
    const r = checkHookCadence([mk(5, "none"), mk(6, "none"), mk(7, "none")], new Set([7]));
    expect(r.warnings.some((w) => w.includes("连续 3 章"))).toBe(true);
  });
});

describe("validateStateVocabulary — 本书状态词表 ajv 入口", () => {
  it("enum 维度缺 values 报错并带 hint", () => {
    const r = validateStateVocabulary({
      dimensions: [
        {
          key: "cultivation_level",
          predicate: "ability",
          display_name: "境界",
          cardinality: "one",
          value_type: "enum",
        },
      ],
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.length).toBeGreaterThan(0);
  });

  it("合法词表通过", () => {
    const r = validateStateVocabulary({
      dimensions: [
        {
          key: "cultivation_level",
          predicate: "ability",
          display_name: "境界",
          cardinality: "one",
          value_type: "enum",
          values: ["练气", "筑基", "金丹"],
        },
        {
          key: "inventory",
          predicate: "possession",
          display_name: "持有物",
          cardinality: "many",
          value_type: "free",
        },
      ],
    });
    expect(r.valid).toBe(true);
  });
});

describe("validateCharacterEntity — 角色结构化实体 ajv 入口", () => {
  it("缺 name 报错", () => {
    expect(validateCharacterEntity({}).valid).toBe(false);
  });

  it("合法实体通过", () => {
    const r = validateCharacterEntity({
      name: "苏见",
      aliases: ["剑圣"],
      gender: "男",
      age: "18 岁",
      initial_states: [{ dimension: "cultivation_level", value: "练气" }],
    });
    expect(r.valid).toBe(true);
  });

  it("name 含路径分隔符 / 报错（防写入口逃逸出 bible/characters/）", () => {
    expect(validateCharacterEntity({ name: "a/b" }).valid).toBe(false);
  });

  it("name 以 . 开头报错（防写入口逃逸出 bible/characters/）", () => {
    expect(validateCharacterEntity({ name: ".hidden" }).valid).toBe(false);
  });

  it("中文名带中缀点（如「圣·剑」）通过——只禁路径分隔符与前导 .，不禁中缀符号", () => {
    expect(validateCharacterEntity({ name: "圣·剑" }).valid).toBe(true);
  });
});

describe("validateAuthoredState", () => {
  const base = { character_uid: "11111111-1111-4111-8111-111111111111" };
  it("set_current 缺 effective_chapter 拒绝", () => {
    expect(validateAuthoredState({ ...base, action: "set_current", dimension: "cultivation_level", value: "金丹" }).valid).toBe(false);
  });
  it("correct 缺 new_value 与 new_event_chapter 拒绝", () => {
    expect(validateAuthoredState({ ...base, action: "correct", target_fact_id: "abcd1234" }).valid).toBe(false);
  });
  it("retract 带 target 通过", () => {
    expect(validateAuthoredState({ ...base, action: "retract", target_fact_id: "abcd1234-ffff" }).valid).toBe(true);
  });
  it("未知 action 拒绝", () => {
    expect(validateAuthoredState({ ...base, action: "overwrite" }).valid).toBe(false);
  });
  it("多余字段拒绝（additionalProperties:false）", () => {
    expect(validateAuthoredState({ ...base, action: "retract", target_fact_id: "abcd1234", force: true }).valid).toBe(false);
  });
});

describe("checkChapterWordCount — 成稿字数守卫（finding-only）", () => {
  it("低于目标 70% → 返回缺口数据", () => {
    const r = checkChapterWordCount(2000, 3000);
    expect(r).toEqual({ actual: 2000, target: 3000, ratio: 2000 / 3000 });
  });

  it("阈值边界：恰好 70% 不告警，再少 1 字告警", () => {
    expect(checkChapterWordCount(2100, 3000)).toBeNull();
    expect(checkChapterWordCount(2099, 3000)).not.toBeNull();
  });

  it("无目标（缺失 / null / 0）→ null，不告警", () => {
    expect(checkChapterWordCount(2000, undefined)).toBeNull();
    expect(checkChapterWordCount(2000, null)).toBeNull();
    expect(checkChapterWordCount(2000, 0)).toBeNull();
  });

  it("达标与超额 → null（守卫只看缺口）", () => {
    expect(checkChapterWordCount(3000, 3000)).toBeNull();
    expect(checkChapterWordCount(4500, 3000)).toBeNull();
  });
});
