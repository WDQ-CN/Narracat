import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import {
  isPayoffCoolingAnnotation,
  hasVividTechnique,
  annotationCarriesRestraintVocab,
  selectStyleExamples,
  detectChapterEmotions,
  queryStyleReference,
  workIdOf,
  resolveCorpusSource,
  __resetCorpusCachesForTest,
} from "./corpus-loader.js";

const FIXTURE_DIR = fileURLToPath(
  new URL("./__fixtures__/corpus-extracts/", import.meta.url),
);
const realFetch = globalThis.fetch;

// 宿主 shell/.env 若已配置 NARRACAT_CORPUS_*（.env.example 正引导维护者这么做），会泄入
// 三态源判定测试——vi.stubEnv 只能覆盖测试内显式设的值，盖不住「宿主本来就有值」，须显式 delete。
const CORPUS_ENV_KEYS = [
  "NARRACAT_CORPUS_TOKEN",
  "NARRACAT_CORPUS_URL",
  "NARRACAT_CORPUS_DIR",
] as const;
const savedCorpusEnv: Partial<Record<(typeof CORPUS_ENV_KEYS)[number], string>> = {};

beforeEach(() => {
  __resetCorpusCachesForTest();
  vi.unstubAllEnvs();
  for (const key of CORPUS_ENV_KEYS) {
    if (process.env[key] !== undefined) savedCorpusEnv[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  for (const key of CORPUS_ENV_KEYS) {
    if (savedCorpusEnv[key] !== undefined) process.env[key] = savedCorpusEnv[key];
    else delete process.env[key];
    delete savedCorpusEnv[key];
  }
});

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

describe("workIdOf（从记录 id 取 work_id，供同书去重）", () => {
  it("取 WK 前缀，剥掉末段 -NNN", () => {
    expect(workIdOf("WK-031-001")).toBe("WK-031");
    expect(workIdOf("WK-068-142")).toBe("WK-068");
  });
});

describe("resolveCorpusSource（三态源判定）", () => {
  it("NARRACAT_CORPUS_DIR 优先 → local", () => {
    vi.stubEnv("NARRACAT_CORPUS_DIR", "/tmp/corpus");
    vi.stubEnv("NARRACAT_CORPUS_TOKEN", "t");
    expect(resolveCorpusSource()).toEqual({ mode: "local", dir: "/tmp/corpus" });
  });
  it("有 token 无 dir → remote，URL 默认 corpus.narracat.com 可被 env 覆盖", () => {
    vi.stubEnv("NARRACAT_CORPUS_TOKEN", "t");
    expect(resolveCorpusSource()).toEqual({ mode: "remote", url: "https://corpus.narracat.com", token: "t" });
    vi.stubEnv("NARRACAT_CORPUS_URL", "http://localhost:8787");
    expect(resolveCorpusSource()).toMatchObject({ url: "http://localhost:8787" });
  });
  it("均无 → disabled（fork 默认态）", () => {
    expect(resolveCorpusSource({})).toEqual({ mode: "disabled" });
  });
});

describe("local 模式（fixture 语料）", () => {
  it("selectStyleExamples 走本地目录：过滤负向、同书去重", async () => {
    vi.stubEnv("NARRACAT_CORPUS_DIR", FIXTURE_DIR);
    const ex = await selectStyleExamples(1, 3);
    expect(ex).toHaveLength(3);
    for (const e of ex) expect(e.mechanism_note).not.toContain("留渣");
  });
  it("queryStyleReference 走本地目录打分", async () => {
    vi.stubEnv("NARRACAT_CORPUS_DIR", FIXTURE_DIR);
    const r = await queryStyleReference({ technique: ["动作细节"], emotion: ["紧张"] });
    expect(r.total_matches).toBeGreaterThan(0);
    expect(r.unavailable).toBeUndefined();
  });
});

describe("remote 模式（stub fetch）", () => {
  it("selectStyleExamples 发 /v1/select-examples 带 Bearer，成功结果进程内缓存（同参不二发）", async () => {
    vi.stubEnv("NARRACAT_CORPUS_TOKEN", "tok-1");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, examples: [{ excerpt: "远", mechanism_note: "注" }] }), { status: 200 });
    }) as typeof fetch;
    const a = await selectStyleExamples(7, 2, ["紧张"]);
    const b = await selectStyleExamples(7, 2, ["紧张"]);
    expect(a).toEqual([{ excerpt: "远", mechanism_note: "注" }]);
    expect(b).toEqual(a);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://corpus.narracat.com/v1/select-examples");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ chapter: 7, limit: 2, emotions: ["紧张"] });
  });
  it("网络失败/非 200 → fail-open 空数组且不缓存（下次重试）", async () => {
    vi.stubEnv("NARRACAT_CORPUS_TOKEN", "tok-1");
    let n = 0;
    globalThis.fetch = (async () => { n += 1; throw new Error("offline"); }) as typeof fetch;
    expect(await selectStyleExamples(1, 3)).toEqual([]);
    expect(await selectStyleExamples(1, 3)).toEqual([]);
    expect(n).toBe(2);
  });
  it("queryStyleReference 失败（5xx）→ {results:[], total_matches:0, unavailable:true}", async () => {
    vi.stubEnv("NARRACAT_CORPUS_TOKEN", "tok-1");
    globalThis.fetch = (async () => new Response("oops", { status: 500 })) as typeof fetch;
    expect(await queryStyleReference({ technique: ["对话设计"] })).toEqual({ results: [], total_matches: 0, unavailable: true });
  });
  it("HTTP 400（入参越界）→ selectStyleExamples 返回 []（不是「服务不可用」重试语义）", async () => {
    vi.stubEnv("NARRACAT_CORPUS_TOKEN", "tok-1");
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: "invalid_params" }), { status: 400 })) as typeof fetch;
    expect(await selectStyleExamples(1, 3)).toEqual([]);
  });
  it("HTTP 400（入参越界）→ queryStyleReference 返回空结果且不带 unavailable（区分「零匹配」与「不可用」）", async () => {
    vi.stubEnv("NARRACAT_CORPUS_TOKEN", "tok-1");
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: "invalid_params" }), { status: 400 })) as typeof fetch;
    const r = await queryStyleReference({ technique: ["对话设计"] });
    expect(r).toEqual({ results: [], total_matches: 0 });
    expect(r.unavailable).toBeUndefined();
  });
});

describe("disabled 模式（fork 默认态）", () => {
  it("不发任何请求，直接空/unavailable", async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
    expect(await selectStyleExamples(1, 3)).toEqual([]);
    expect(await queryStyleReference({ technique: ["对话设计"] })).toMatchObject({ unavailable: true });
    expect(called).toBe(false);
  });
});
