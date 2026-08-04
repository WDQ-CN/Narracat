import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validatePackManifest } from "./pack-manifest.js";

const packJsonUrl = new URL("../../../packs/official-base/pack.json", import.meta.url);
const craftIndexUrl = new URL("../../../skills/novel-web-craft/references/pack-index.json", import.meta.url);
const personaIndexUrl = new URL("../../../skills/novel-web-craft/references/personas/index.json", import.meta.url);
const structureIndexUrl = new URL("../../../skills/novel-structure/references/packs/pack-index.json", import.meta.url);

function readJson(url: URL): any { return JSON.parse(readFileSync(url, "utf8")); }

describe("official-base pack.json 与三索引同步（生成物守护）", () => {
  const pack = readJson(packJsonUrl);

  it("通过契约校验，29 张卡，官方署名", () => {
    const r = validatePackManifest(pack);
    expect(r.errors).toEqual([]);
    expect(r.manifest?.cards).toHaveLength(29);
    expect(r.manifest?.author).toBe("narracat-official");
    expect(r.manifest?.id).toBe("official-base");
  });

  it("craft 卡与 pack-index.json 逐字段一致", () => {
    const index = readJson(craftIndexUrl).packs;
    const cards = pack.cards.filter((c: any) => c.type === "craft");
    expect(cards.map((c: any) => c.id).sort()).toEqual(index.map((e: any) => e.pack_id).sort());
    for (const entry of index) {
      const card = cards.find((c: any) => c.id === entry.pack_id);
      expect(card).toMatchObject({
        path: entry.path, triggers: entry.triggers, beat_types: entry.beat_types,
        technique_tags: entry.technique_tags, emotion_tags: entry.emotion_tags,
        exclusions: entry.exclusions, priority: entry.priority,
      });
    }
  });

  it("persona 卡与 personas/index.json 一致", () => {
    const index = readJson(personaIndexUrl).personas;
    const cards = pack.cards.filter((c: any) => c.type === "persona");
    expect(cards).toHaveLength(index.length);
    for (const entry of index) {
      const card = cards.find((c: any) => c.id === entry.id);
      expect(card).toMatchObject({
        name: entry.name, keywords: entry.keywords,
        path: "${CLAUDE_PLUGIN_ROOT}/skills/novel-web-craft/references/personas/" + entry.file,
      });
    }
  });

  it("structure 卡与 pack-index.json 一致", () => {
    const index = readJson(structureIndexUrl).packs;
    const cards = pack.cards.filter((c: any) => c.type === "structure");
    expect(cards).toHaveLength(index.length);
    for (const entry of index) {
      const card = cards.find((c: any) => c.id === entry.id);
      expect(card).toMatchObject({ path: entry.path, dimension: entry.dimension, stage: entry.stage, one_line: entry.one_line });
    }
  });
});
