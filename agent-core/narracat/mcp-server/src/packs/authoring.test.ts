import { readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUTHORING_TECHNIQUE_TAGS, AUTHORING_EMOTION_TAGS, loadTypicalScenarios, loadTypicalVoices, previewCraftCard, previewPersonaCard } from "./authoring.js";
import { EMOTION_CUES } from "../corpus-loader.js";

// 与 pack-resolver.ts 的 defaultBuiltinPacksDir() 同款定位：src/packs/authoring.test.ts →
// ../../../packs = agent-core/narracat/packs（pack-resolver.discoverPacks() 的扫描根）
function builtinPacksDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../packs");
}

describe("authoring vocab", () => {
  it("emotion 标签与 EMOTION_CUES 词表同源（防双 SSOT 漂移）", () => {
    expect(AUTHORING_EMOTION_TAGS).toEqual(Object.keys(EMOTION_CUES));
  });
  it("technique 标签与 craft-pack-lint 八值一致", () => {
    expect(AUTHORING_TECHNIQUE_TAGS).toEqual(["对话设计","心理刻画","环境描写","动作细节","节奏控制","情感渲染","视角运用","悬念设置"]);
  });
  it("典型情境集可加载且含六情境", () => {
    const s = loadTypicalScenarios();
    expect(s.map((x) => x.id)).toContain("face-slap");
    expect(s).toHaveLength(6);
    for (const x of s) expect(x.outline.length).toBeGreaterThan(30);
  });
  it("典型声音画像可加载且含无特征负例", () => {
    const v = loadTypicalVoices();
    expect(v.map((x) => x.id)).toContain("plain");
    expect(v).toHaveLength(5);
  });
  it("防复发：authoring 资产不得放回 pack-resolver 的内置包扫描根（无 pack.json 的子目录会被当作能力包读取失败污染 notes）", () => {
    const dir = builtinPacksDir();
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(existsSync(join(dir, entry.name, "pack.json"))).toBe(true);
    }
  });
});

describe("authoring preview", () => {
  const craftCard = { type: "craft", id: "my-face-slap", path: "cards/x.md",
    triggers: ["打脸", "对峙"], beat_types: [], technique_tags: ["节奏控制"],
    emotion_tags: ["紧张"], exclusions: ["过渡"], priority: 50 };
  it("craft：触发词命中的情境 selected=true，排除词命中的为 false", () => {
    const r = previewCraftCard(craftCard);
    expect(r.find((x) => x.id === "face-slap")?.selected).toBe(true);
    expect(r.find((x) => x.id === "transition")?.selected).toBe(false);
  });
  it("craft：与官方池竞争仍可入选（user origin 命中即优先）", () => {
    const r = previewCraftCard(craftCard);
    expect(r.filter((x) => x.selected).length).toBeGreaterThan(0);
  });
  it("persona：词汇与官方卡高度重合时用户卡命中即优先（follow-up⑨：手写一等公民，等于无穷大权重——不比分，命中就赢）", () => {
    const personaCard = { type: "persona", id: "my-witty", path: "cards/y.md", name: "我的诙谐腔", keywords: ["说书人", "诙谐"] };
    const r = previewPersonaCard(personaCard);
    const hit = r.find((x) => x.id === "witty-storyteller");
    expect(hit?.selected).toBe(true);
    expect(hit?.reason).toBe("该风格的书会选中这张腔调卡");
  });
  it("persona：官方池未覆盖的题材，草稿卡真实胜出（填补空白是正路）", () => {
    const epicCard = { type: "persona", id: "my-epic", path: "cards/z.md", name: "我的史诗腔", keywords: ["史诗", "恢弘", "苍茫"] };
    const r = previewPersonaCard(epicCard);
    expect(r.find((x) => x.id === "epic-grand")?.selected).toBe(true);
  });
  it("persona：plain 无特征负例画像不选任何腔调卡", () => {
    const personaCard = { type: "persona", id: "my-witty", path: "cards/y.md", name: "我的诙谐腔", keywords: ["说书人", "诙谐"] };
    const r = previewPersonaCard(personaCard);
    const hit = r.find((x) => x.id === "plain");
    expect(hit?.selected).toBe(false);
    expect(hit?.reason).toBe("该画像下不选任何腔调卡");
  });
});
