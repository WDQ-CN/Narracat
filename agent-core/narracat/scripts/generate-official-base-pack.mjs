// agent-core/narracat/scripts/generate-official-base-pack.mjs
// 从三份既有索引生成官方通用基础包 manifest。索引是官方卡元数据 SSOT；
// 生成物提交入库，由 official-base-pack.test.ts 守护同步。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CRAFT_INDEX = join(ROOT, "skills/novel-web-craft/references/pack-index.json");
const PERSONA_INDEX = join(ROOT, "skills/novel-web-craft/references/personas/index.json");
const STRUCTURE_INDEX = join(ROOT, "skills/novel-structure/references/packs/pack-index.json");
const OUT = join(ROOT, "packs/official-base/pack.json");

export function buildOfficialBaseManifest() {
  const craft = JSON.parse(readFileSync(CRAFT_INDEX, "utf8")).packs ?? [];
  const personas = JSON.parse(readFileSync(PERSONA_INDEX, "utf8")).personas ?? [];
  const structure = JSON.parse(readFileSync(STRUCTURE_INDEX, "utf8")).packs ?? [];
  return {
    pack_format_version: 1,
    id: "official-base",
    name: "官方通用基础包",
    author: "narracat-official",
    version: "1.0.0",
    description: "NarraCat 官方跨题材通用能力：3 张声音卡、12 张写法卡、10 张剧作卡。",
    cards: [
      ...personas.map((p) => ({
        type: "persona", id: p.id, name: p.name,
        path: "${CLAUDE_PLUGIN_ROOT}/skills/novel-web-craft/references/personas/" + p.file,
        keywords: p.keywords,
      })),
      ...craft.map((c) => ({
        type: "craft", id: c.pack_id, path: c.path,
        triggers: c.triggers, beat_types: c.beat_types, technique_tags: c.technique_tags,
        emotion_tags: c.emotion_tags, exclusions: c.exclusions, priority: c.priority,
      })),
      ...structure.map((s) => ({
        type: "structure", id: s.id, path: s.path,
        dimension: s.dimension, stage: s.stage, one_line: s.one_line,
      })),
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = buildOfficialBaseManifest();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`已生成 ${OUT}（${manifest.cards.length} 张卡）`);
}
