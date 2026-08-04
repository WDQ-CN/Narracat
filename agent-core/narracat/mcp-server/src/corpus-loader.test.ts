import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isPayoffCoolingAnnotation,
  hasVividTechnique,
  annotationCarriesRestraintVocab,
  selectStyleExamples,
  detectChapterEmotions,
  queryStyleReference,
  workIdOf,
} from "./corpus-loader.js";

// 真实 corpus 的 annotation → technique 映射，用于侧面验证选样优先级
function loadCorpusByAnnotation(): Map<string, string[]> {
  const dir = fileURLToPath(
    new URL(
      "../../skills/novel-style-reference/references/corpus/extracts/",
      import.meta.url,
    ),
  );
  const map = new Map<string, string[]>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(dir + file, "utf-8")) as {
      extracts: Array<{ annotation: string; technique: string[] }>;
    };
    for (const e of data.extracts) map.set(e.annotation, e.technique);
  }
  return map;
}

// excerpt(paragraph) → work_id 映射，用于从返回范例还原书身份（StyleExampleForPack
// 去标识后不带 work_id，靠段落回查）；验证「同书去重」真生效（3 条来自 3 本不同书）。
function buildExcerptToWorkId(): Map<string, string> {
  const dir = fileURLToPath(
    new URL(
      "../../skills/novel-style-reference/references/corpus/extracts/",
      import.meta.url,
    ),
  );
  const map = new Map<string, string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(dir + file, "utf-8")) as {
      work_id: string;
      extracts: Array<{ paragraph: string }>;
    };
    for (const e of data.extracts) map.set(e.paragraph, data.work_id);
  }
  return map;
}

describe("isPayoffCoolingAnnotation（#333 负向过滤：冷处理 payoff/留渣取向）", () => {
  it("命中「把爽点收着/留渣/从爽滑向闷」取向", () => {
    expect(
      isPayoffCoolingAnnotation("灰色主角的爽点必须留渣——残留的痛、闷、悲"),
    ).toBe(true);
    expect(isPayoffCoolingAnnotation("用动作渐变把情绪从爽滑向闷")).toBe(true);
    expect(
      isPayoffCoolingAnnotation("纯爽则会把立体的人物推回非黑即白"),
    ).toBe(true);
  });

  it("不误伤「克制而精准」「不煽情=show don't tell」类褒义 craft 观察", () => {
    expect(
      isPayoffCoolingAnnotation("告别场景写得克制而精准，粗粝的细节比诗意更生动"),
    ).toBe(false);
    expect(
      isPayoffCoolingAnnotation("不渲染、不煽情，这正是 show don't tell 的高级应用"),
    ).toBe(false);
    expect(
      isPayoffCoolingAnnotation("引爆的那句话越短越有力，留白由读者自己填满"),
    ).toBe(false);
    expect(
      isPayoffCoolingAnnotation("从轻声嘲讽的收敛到哐哐哐的爆发，力度阶梯式上升"),
    ).toBe(false);
  });
});

describe("hasVividTechnique（#333 正向优先：画面感/情绪外显技法）", () => {
  it("动作细节/环境描写/情感渲染 命中", () => {
    expect(hasVividTechnique(["心理刻画", "动作细节"])).toBe(true);
    expect(hasVividTechnique(["环境描写"])).toBe(true);
    expect(hasVividTechnique(["情感渲染", "节奏控制"])).toBe(true);
  });

  it("纯内省/结构技法不算画面感优先", () => {
    expect(hasVividTechnique(["心理刻画", "节奏控制"])).toBe(false);
    expect(hasVividTechnique(["对话设计", "悬念设置", "视角运用"])).toBe(false);
    expect(hasVividTechnique([])).toBe(false);
  });
});

describe("annotationCarriesRestraintVocab（#333 注解夹带克制类词 → 同档降级）", () => {
  it("注解含克制类词时命中", () => {
    expect(annotationCarriesRestraintVocab("告别场景写得克制而精准")).toBe(true);
    expect(annotationCarriesRestraintVocab("不渲染、不煽情，show don't tell")).toBe(true);
    expect(annotationCarriesRestraintVocab("留白由读者自己填满")).toBe(true);
    expect(annotationCarriesRestraintVocab("从轻声嘲讽的收敛到爆发")).toBe(true);
  });

  it("注解不含克制类词时不命中", () => {
    expect(
      annotationCarriesRestraintVocab("用粗粝的细节把画面演出来，镜头感很强"),
    ).toBe(false);
    expect(
      annotationCarriesRestraintVocab("钩子一句话引爆，情绪外显、张力十足"),
    ).toBe(false);
  });
});

describe("selectStyleExamples（真实 corpus：负向过滤 + 正向优先）", () => {
  it("跨多章选样从不返回冷处理/留渣取向的范例", () => {
    for (let ch = 1; ch <= 30; ch += 1) {
      const examples = selectStyleExamples(ch, 3);
      expect(examples.length).toBeGreaterThan(0);
      for (const ex of examples) {
        expect(isPayoffCoolingAnnotation(ex.mechanism_note)).toBe(false);
      }
    }
  });

  it("正向池足够时，选出的范例全部偏画面感/情绪外显，且来自不同作品", () => {
    const byAnnotation = loadCorpusByAnnotation();
    const x2w = buildExcerptToWorkId();
    for (const ch of [1, 8, 9, 17, 23]) {
      const examples = selectStyleExamples(ch, 3);
      expect(examples).toHaveLength(3);
      // 同书去重真生效：3 条范例须来自 3 本不同作品（work_id 维度，非仅段落不同）
      expect(examples.every((e) => x2w.has(e.excerpt))).toBe(true);
      expect(new Set(examples.map((e) => x2w.get(e.excerpt))).size).toBe(3);
      // 正向池(76 条)远大于 count(3)，每条都应带画面感/情绪外显技法
      for (const ex of examples) {
        const technique = byAnnotation.get(ex.mechanism_note) ?? [];
        expect(hasVividTechnique(technique)).toBe(true);
      }
    }
  });

  it("干净注解充足时，选样不返回夹带克制类词的注解（降级生效）", () => {
    // 正向且注解干净的范例(67 条)远大于 count(3)，
    // 故任何章节选出的注解都不应夹带克制类词
    for (let ch = 1; ch <= 30; ch += 1) {
      for (const ex of selectStyleExamples(ch, 3)) {
        expect(annotationCarriesRestraintVocab(ex.mechanism_note)).toBe(false);
      }
    }
  });
});

// annotation → emotion[] 映射，用于验证情绪匹配选样
function loadCorpusEmotionByAnnotation(): Map<string, string[]> {
  const dir = fileURLToPath(
    new URL(
      "../../skills/novel-style-reference/references/corpus/extracts/",
      import.meta.url,
    ),
  );
  const map = new Map<string, string[]>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(dir + file, "utf-8")) as {
      extracts: Array<{ annotation: string; emotion: string[] }>;
    };
    for (const e of data.extracts) map.set(e.annotation, e.emotion);
  }
  return map;
}

describe("detectChapterEmotions（Layer B：从章纲文本探测目标情绪）", () => {
  it("命中事件型/情绪型线索", () => {
    expect(detectChapterEmotions("两人对峙，凶险逼近，生死一线")).toContain("紧张");
    expect(detectChapterEmotions("久别重逢，温情陪伴，一同归家")).toContain("温暖");
    expect(detectChapterEmotions("真相揭露，剧情反转，冲击全场")).toContain("震撼");
  });

  it("无线索返回空数组", () => {
    expect(detectChapterEmotions("")).toEqual([]);
    expect(detectChapterEmotions("主角走进房间，翻开桌上的卷宗")).toEqual([]);
  });

  it("多情绪时按命中数取前 3 类（封顶）", () => {
    const emos = detectChapterEmotions(
      "对峙凶险，真相反转冲击，复仇质问的怒火，温情守护，心动暧昧",
    );
    expect(emos.length).toBeLessThanOrEqual(3);
  });
});

describe("selectStyleExamples × Layer B 情绪匹配", () => {
  it("传入本章情绪时，命中该情绪的范例显著多于不传情绪的基线", () => {
    const byEmotion = loadCorpusEmotionByAnnotation();
    const hits = (examples: { mechanism_note: string }[], emo: string) =>
      examples.filter((ex) => (byEmotion.get(ex.mechanism_note) ?? []).includes(emo)).length;
    let withEmo = 0;
    let withoutEmo = 0;
    for (let ch = 1; ch <= 20; ch += 1) {
      withEmo += hits(selectStyleExamples(ch, 3, ["温暖"]), "温暖");
      withoutEmo += hits(selectStyleExamples(ch, 3), "温暖");
    }
    expect(withEmo).toBeGreaterThan(withoutEmo);
  });

  it("情绪匹配只是档内偏好：仍不破负向过滤、不同作品", () => {
    const x2w = buildExcerptToWorkId();
    for (let ch = 1; ch <= 20; ch += 1) {
      const ex = selectStyleExamples(ch, 3, ["紧张"]);
      expect(ex.length).toBeGreaterThan(0);
      for (const e of ex) {
        expect(isPayoffCoolingAnnotation(e.mechanism_note)).toBe(false);
      }
      // 同书去重：返回条数 == 不同 work_id 数（每条来自不同书）
      expect(ex.every((e) => x2w.has(e.excerpt))).toBe(true);
      expect(new Set(ex.map((e) => x2w.get(e.excerpt))).size).toBe(ex.length);
    }
  });

  it("不传情绪时与历史行为完全一致（向后兼容）", () => {
    for (const ch of [1, 8, 9, 17, 23]) {
      expect(selectStyleExamples(ch, 3, [])).toEqual(selectStyleExamples(ch, 3));
    }
  });

  // 回归守卫：检索库扩容（147→数千）后，按高频手法应能查到数百条真人范例；
  // 防 corpus 被误删/回退成稀疏池（扩容前「对话设计」远不足此数）。
  it("扩容后语料池规模显著（防回退稀疏池）", () => {
    const r = queryStyleReference({ technique: ["对话设计"] });
    expect(r.total_matches).toBeGreaterThan(300);
  });
});

describe("workIdOf（从记录 id 取 work_id，供同书去重）", () => {
  it("取 WK 前缀，剥掉末段 -NNN", () => {
    expect(workIdOf("WK-031-001")).toBe("WK-031");
    expect(workIdOf("WK-068-142")).toBe("WK-068");
  });
});
