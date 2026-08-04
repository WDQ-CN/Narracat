/**
 * Craft Pack 加载器与结构化触发选包。
 *
 * 从 novel-web-craft skill 的 pack-index.json 加载 pack 元数据（机器 SSOT），
 * 按章纲文本命中的 triggers + 本章情绪命中的 emotion_tags 打分选包。
 * 确定性、可解释；无命中返回空数组（向后兼容）。
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { detectChapterEmotions } from "./corpus-loader.js";
import type { CraftPoolEntry } from "./packs/pack-resolver.js";

/** 候选来源裁决优先级（ADR-0034 v1.1）：user 覆盖官方，官方覆盖社区。 */
const ORIGIN_RANK: Record<string, number> = { user: 0, official: 1, community: 2 };

export interface CraftPackIndexEntry {
  pack_id: string;
  path: string;
  triggers: string[];
  beat_types: string[];
  technique_tags: string[];
  emotion_tags: string[];
  exclusions: string[];
  priority: number;
}

export interface CraftPackHint {
  pack_id: string;
  reference_path: string;
  reason: string;
  matched_triggers: string[];
}

let packIndexCache: CraftPackIndexEntry[] | null = null;

function resolvePackIndexPath(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  // dist/ → ../../skills/novel-web-craft/references/pack-index.json
  return path.resolve(
    dir,
    "../../skills/novel-web-craft/references/pack-index.json",
  );
}

/**
 * plugin 根目录（= ${CLAUDE_PLUGIN_ROOT} 的真值）。
 * pack-index.json 在 <pluginRoot>/skills/novel-web-craft/references/，回退三层得 pluginRoot。
 */
function resolvePluginRoot(): string {
  return path.resolve(path.dirname(resolvePackIndexPath()), "../../..");
}

/**
 * 把 pack-index.json 里 path 字段的 ${CLAUDE_PLUGIN_ROOT} 前缀展开成真实绝对路径。
 *
 * reference_path 经 MCP 工具写进 WritingContextPack 数据、再由写手 Read——这条路径
 * 不经过 SDK plugin 运行时、也不经 App 的 agent-prompt 展开层，字面 ${CLAUDE_PLUGIN_ROOT}
 * 在写手侧不会被解析。故在 MCP 侧用真实 plugin root 展开后再交付（存储层保留变量前缀以
 * 保持可移植 + 过 lint:plugin-paths；消费层交付绝对路径以保证 Read 得到）。
 */
function expandReferencePath(rawPath: string): string {
  return rawPath.replace(
    /\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b/g,
    resolvePluginRoot(),
  );
}

export function loadPackIndex(): CraftPackIndexEntry[] {
  if (packIndexCache !== null) return packIndexCache;
  const p = resolvePackIndexPath();
  if (!existsSync(p)) {
    packIndexCache = [];
    return packIndexCache;
  }
  try {
    const data = JSON.parse(readFileSync(p, "utf-8")) as {
      packs?: CraftPackIndexEntry[];
    };
    packIndexCache = data.packs ?? [];
  } catch (err) {
    console.error("[NovelMemory] Failed to load pack-index.json:", err);
    packIndexCache = [];
  }
  return packIndexCache;
}

/** 测试用：清空模块缓存 */
export function _resetPackIndexCache(): void {
  packIndexCache = null;
}

/**
 * pool 省略时的默认候选池：从既有 pack-index.json 构造，origin 一律标 official。
 * 这是向后兼容的等价路径——equivalence 由 origin 单一（排序 tie-break 恒为 no-op）保证。
 */
export function defaultCraftPool(): CraftPoolEntry[] {
  return loadPackIndex().map((entry) => ({
    ...entry,
    absolute_path: expandReferencePath(entry.path),
    origin: "official" as const,
    source_pack_id: "novel-web-craft",
    source_pack_version: "legacy",
  }));
}

export function selectCraftPacks(
  chapterOutline: string,
  limit = 3,
  pool?: CraftPoolEntry[],
): CraftPackHint[] {
  if (!chapterOutline) return [];
  const packs = pool ?? defaultCraftPool();
  if (packs.length === 0) return [];
  const emotions = new Set(detectChapterEmotions(chapterOutline));

  const scored: Array<{
    entry: CraftPoolEntry;
    score: number;
    reasons: string[];
    matchedTriggers: string[];
  }> = [];
  for (const entry of packs) {
    if (entry.exclusions.some((x) => x && chapterOutline.includes(x))) continue;
    const reasons: string[] = [];
    const matchedTriggers: string[] = [];
    let triggerHits = 0;
    let emotionHits = 0;
    for (const t of entry.triggers) {
      if (t && chapterOutline.includes(t)) {
        triggerHits += 1;
        reasons.push(`触发词「${t}」`);
        matchedTriggers.push(t);
      }
    }
    for (const e of entry.emotion_tags) {
      if (emotions.has(e)) {
        emotionHits += 1;
        reasons.push(`情绪「${e}」`);
      }
    }
    // emotion 只作 boost/tiebreaker：必须至少一个 trigger 命中才入选。否则多个 pack 共享同一情绪
    // （如「紧张」被 crisis-action / tense-dialogue / chapter-end-hook 共享）会把无对话/无钩子信号的
    // 纯动作章纲也拉进对话/钩子 pack，污染选包。命中 trigger 后 emotion 命中再加分用于排序取舍。
    if (triggerHits > 0)
      scored.push({ entry, score: triggerHits + emotionHits, reasons, matchedTriggers });
  }
  // 用户命中卡分层置顶（产品拍板：手写一等公民）：tier 优先于 score——命中的 user 卡
  // 稳定排在所有 official/community 前占坑，剩余名额按 tier 内既有 score→priority→
  // origin→pack_id 顺序分给非 user 卡。只提升 user，official vs community 相对关系不变。
  const tierOf = (origin: string) => (origin === "user" ? 0 : 1);
  scored.sort((a, b) => {
    const tierDiff = tierOf(a.entry.origin) - tierOf(b.entry.origin);
    if (tierDiff !== 0) return tierDiff;
    if (b.score !== a.score) return b.score - a.score;
    if (b.entry.priority !== a.entry.priority)
      return b.entry.priority - a.entry.priority;
    const rankDiff =
      (ORIGIN_RANK[a.entry.origin] ?? 9) - (ORIGIN_RANK[b.entry.origin] ?? 9);
    if (rankDiff !== 0) return rankDiff;
    return a.entry.pack_id.localeCompare(b.entry.pack_id);
  });
  return scored.slice(0, Math.max(0, limit)).map(({ entry, reasons, matchedTriggers }) => ({
    pack_id: entry.pack_id,
    reference_path: entry.absolute_path,
    reason: reasons.join("、"),
    matched_triggers: matchedTriggers,
  }));
}
