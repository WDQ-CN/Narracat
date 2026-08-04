import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EMOTION_CUES, detectChapterEmotions } from "../corpus-loader.js";
import { selectCraftPacks, defaultCraftPool } from "../craft-pack-loader.js";
import { selectPersona, defaultPersonaPool } from "../persona-loader.js";

export interface TypicalScenario { id: string; name: string; outline: string }
export interface TypicalVoice { id: string; name: string; voice: Record<string, string> }

// 与 scripts/craft-pack-lint.mjs 的 TECHNIQUES 八值人工对齐（lint 是 mjs 脚本无法 import；测试锁值防漂移）
export const AUTHORING_TECHNIQUE_TAGS = ["对话设计","心理刻画","环境描写","动作细节","节奏控制","情感渲染","视角运用","悬念设置"] as const;
export const AUTHORING_EMOTION_TAGS = Object.keys(EMOTION_CUES);

// 资产目录定位与 pack-resolver.ts 的内置包定位同构：dist/packs/authoring.js → ../../authoring = mcp-server/authoring
// 注意：不放进 agent-core/narracat/packs/ ——那是 pack-resolver.discoverPacks() 的扫描根，
// 无 pack.json 的子目录会被当作「能力包读取失败」写进 notes 污染每章 buildNotes/能力回执 warnings。
function authoringDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../authoring");
}

export function loadTypicalScenarios(): TypicalScenario[] {
  return JSON.parse(readFileSync(join(authoringDir(), "typical-scenarios.json"), "utf8")).scenarios;
}
export function loadTypicalVoices(): TypicalVoice[] {
  return JSON.parse(readFileSync(join(authoringDir(), "typical-voices.json"), "utf8")).voices;
}

export interface AuthoringPreviewResult {
  id: string;
  name: string;
  selected: boolean;
  reason: string;
}

/**
 * craft 草稿卡干跑预览：把卡条目适配成 CraftPoolEntry（origin 固定 user，与官方池一并
 * 参与 selectCraftPacks 竞争），逐个典型情境跑一遍选卡，报每个情境是否会选中这张卡。
 * path/absolute_path 用占位——选卡只依赖 triggers/emotion_tags/exclusions/priority/origin。
 */
export function previewCraftCard(card: {
  id: string;
  triggers: string[];
  emotion_tags: string[];
  exclusions: string[];
  priority: number;
}): AuthoringPreviewResult[] {
  // 候选 id 命名空间化（`__draft__:` 前缀）：草稿卡 id 可能与已装载的官方/社区包 id 撞名，
  // 不加前缀会导致 hints.find 命中错误条目、把别人的选中结果错误归因给草稿卡。
  const draftPackId = `__draft__:${card.id}`;
  const candidate = {
    pack_id: draftPackId, path: "", absolute_path: "", triggers: card.triggers,
    beat_types: [], technique_tags: [], emotion_tags: card.emotion_tags, exclusions: card.exclusions,
    priority: card.priority ?? 50, origin: "user" as const, source_pack_id: "__draft__", source_pack_version: "0.0.0",
  };
  return loadTypicalScenarios().map((s) => {
    const hints = selectCraftPacks(s.outline, 3, [...defaultCraftPool(), candidate]);
    const hit = hints.find((h) => h.pack_id === draftPackId);
    return { id: s.id, name: s.name, selected: Boolean(hit), reason: hit?.reason ?? "触发词未命中或竞争落选" };
  });
}

/**
 * persona 草稿卡干跑预览：把卡条目适配成 PersonaPoolEntry（origin 固定 user，path 留空
 * 由 selectPersona 容错为空 body），逐个典型声音画像跑一遍选卡，报每个画像是否会选中这张卡。
 */
export function previewPersonaCard(card: {
  id: string;
  name: string;
  keywords: string[];
}): AuthoringPreviewResult[] {
  // 候选 id 命名空间化（`__draft__:` 前缀）：理由同 previewCraftCard——避免草稿卡 id 撞名
  // 官方/社区卡 id 时 picked?.id 比对张冠李戴。
  const draftId = `__draft__:${card.id}`;
  const candidate = {
    id: draftId, name: card.name, path: "", keywords: card.keywords,
    origin: "user" as const, source_pack_id: "__draft__", source_pack_version: "0.0.0",
  };
  return loadTypicalVoices().map((v) => {
    const voice = new Map(Object.entries(v.voice).filter(([, val]) => val));
    const picked = selectPersona(voice.size ? voice : null, detectChapterEmotions(""), undefined, [...defaultPersonaPool(), candidate]);
    return {
      id: v.id, name: v.name, selected: picked?.id === draftId,
      reason: picked?.id === draftId ? "该风格的书会选中这张腔调卡" : picked ? `会选中「${picked.name}」` : "该画像下不选任何腔调卡",
    };
  });
}
