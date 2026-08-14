import { describe, expect, it } from "vitest";
import { scanProseFingerprints } from "./prose-fingerprints.js";
import { PROSE_FINGERPRINT_LEXICON } from "../data/prose-hygiene-lexicon.js";

describe("scanProseFingerprints — 洁净词库 v1（finding-only，spec §4.4）", () => {
  it("逐类命中并给出 per_kilo 与 replace_hint", () => {
    const text = "他缓缓抬头，眸中闪过一丝冷意。就在这时，她深吸一口气，淡淡道：走。".repeat(30);
    const findings = scanProseFingerprints(text);
    const ids = findings.map((f) => f.category);
    expect(ids).toEqual(expect.arrayContaining(["adverb_universal", "gaze_template", "turn_template", "action_cliche", "said_tag"]));
    const adverb = findings.find((f) => f.category === "adverb_universal")!;
    expect(adverb.total).toBe(60); // 缓缓×30 + 淡淡×30（「淡淡道」同时计入 said_tag，允许重叠计数）
    expect(adverb.per_kilo).toBeGreaterThan(0);
    expect(adverb.replace_hint.length).toBeGreaterThan(0);
  });
  it("emotion_label 正则命中「他感到/她只觉」式标签句", () => {
    const text = "他感到愤怒。她只觉一阵心酸。".repeat(10);
    const f = scanProseFingerprints(text).find((x) => x.category === "emotion_label")!;
    expect(f.total).toBe(20);
  });
  it("干净文本零 finding", () => {
    expect(scanProseFingerprints("他把杯子一放。「不去。」窗外的雨还在下。")).toEqual([]);
  });

  it("pivot_rhetoric 覆盖翻案腔的各种外衣，不只字面「不是…而是…」", () => {
    const cases = [
      "他要的不是钱，而是那句话。",
      "他要的不是钱，是那句话。",
      "问题并非出在剑上，而是握剑的人。",
      "胜负不在于快，而在于稳。",
      "与其说他在等人，不如说他在等一个借口。",
      "看似随口一问，其实早就想好了。",
      "他一直以为父亲死于旧疾，后来才知道另有其人。",
      "回头才发现，那晚谁都没睡。",
      "他要的从来不是名声。",
      "快慢不重要，重要的是他敢不敢出手。",
      "真正让他停下的，是院子里那盏还亮着的灯。",
    ];
    for (const text of cases) {
      const f = scanProseFingerprints(text).find((x) => x.category === "pivot_rhetoric");
      expect(f, `未命中翻案腔：${text}`).toBeDefined();
    }
  });

  it("pivot_rhetoric 不误伤跨句的正常否定陈述", () => {
    expect(scanProseFingerprints("他不是本地人。他从山外面来。")).toEqual([]);
  });

  it("insight_signpost / nominalization / abstract_lyric 各自命中", () => {
    const ids = (t: string) => scanProseFingerprints(t).map((f) => f.category);
    expect(ids("值得注意的是，他一直没有回头。")).toContain("insight_signpost");
    expect(ids("他们对这件事进行了讨论。")).toContain("nominalization");
    expect(ids("那些话被他安放在某个说不出口的地方。")).toContain("abstract_lyric");
  });

  it("抽象抒情词只收在小说里必然修饰抽象物的几个，本义高频词不收（防误杀）", () => {
    const lyric = PROSE_FINGERPRINT_LEXICON.find((c) => c.id === "abstract_lyric")!;
    for (const w of ["滚烫", "赤裸", "剥开", "锋利", "坚硬", "柔软"]) {
      expect(lyric.terms).not.toContain(w);
    }
  });
  it("中性节拍词不在词库（防误杀红线）", () => {
    const banned = ["突然", "这一刻", "此刻", "下一秒", "无比", "彻底", "不由得"];
    for (const cat of PROSE_FINGERPRINT_LEXICON) {
      for (const w of banned) expect(cat.terms ?? []).not.toContain(w);
    }
  });
  it("hits 附带命中字符偏移（term 模式，PR#502 人审 R4）", () => {
    const text = "他缓缓抬头，眸中闪过一丝冷意。就在这时，她深吸一口气，淡淡道：走。".repeat(30);
    const adverb = scanProseFingerprints(text).find((f) => f.category === "adverb_universal")!;
    const huanhuan = adverb.hits.find((h) => h.term === "缓缓")!;
    expect(huanhuan.positions[0]).toBe(1);
    expect(huanhuan.positions[1]).toBe(34);
  });
  it("单 term 命中超过 10 次时 positions 截断到 10，count 仍是全量", () => {
    const text = "缓缓".repeat(15); // 15 次不重叠命中
    const adverb = scanProseFingerprints(text).find((f) => f.category === "adverb_universal")!;
    const huanhuan = adverb.hits.find((h) => h.term === "缓缓")!;
    expect(huanhuan.count).toBe(15);
    expect(huanhuan.positions).toHaveLength(10);
  });
  it("regex 模式 hits 同样附带命中位置", () => {
    const text = "他感到愤怒。她只觉一阵心酸。".repeat(10);
    const emotion = scanProseFingerprints(text).find((f) => f.category === "emotion_label")!;
    for (const hit of emotion.hits) {
      expect(hit.positions.length).toBeGreaterThan(0);
      expect(hit.positions.length).toBeLessThanOrEqual(10);
      for (const pos of hit.positions) {
        expect(text.slice(pos, pos + hit.term.length)).toBe(hit.term);
      }
    }
  });
});
