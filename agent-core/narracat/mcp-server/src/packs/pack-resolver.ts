import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validatePackManifest, DEFAULT_ENABLED_PACK_IDS,
  type PackManifest, type PackOrigin, type StructureStage,
} from "./pack-manifest.js";

export interface NovelPacksEntry { id: string; version?: string }
interface PackProvenance { origin: PackOrigin; source_pack_id: string; source_pack_version: string }
export interface PersonaPoolEntry extends PackProvenance { id: string; name: string; path: string; keywords: string[] }
export interface CraftPoolEntry extends PackProvenance {
  pack_id: string; path: string; absolute_path: string;
  triggers: string[]; beat_types: string[]; technique_tags: string[];
  emotion_tags: string[]; exclusions: string[]; priority: number;
}
export interface StructurePoolEntry extends PackProvenance { id: string; path: string; dimension: string; stage: StructureStage; one_line: string }
export interface PackPools { personas: PersonaPoolEntry[]; craft: CraftPoolEntry[]; structure: StructurePoolEntry[]; notes: string[] }

interface ResolvedPack { manifest: PackManifest; origin: PackOrigin; rootDir: string }

function defaultBuiltinPacksDir(): string {
  // dist/packs/pack-resolver.js → ../../../packs = agent-core/narracat/packs
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../packs");
}

let discoveryCache: { key: string; packs: ResolvedPack[]; notes: string[] } | null = null;
export function resetPackResolverCache(): void { discoveryCache = null; }

function loadPackDir(rootDir: string, origin: PackOrigin, notes: string[]): ResolvedPack | null {
  try {
    const raw = JSON.parse(readFileSync(join(rootDir, "pack.json"), "utf8"));
    const { manifest, errors, warnings } = validatePackManifest(raw);
    for (const w of warnings) notes.push(`能力包 ${rootDir}：${w}`);
    if (!manifest) { notes.push(`能力包 ${rootDir} manifest 非法，已跳过：${errors.join("；")}`); return null; }
    return { manifest, origin, rootDir };
  } catch (err) {
    notes.push(`能力包 ${rootDir} 读取失败，已跳过：${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function discoverPacks(builtinPacksDir: string, userPacksDir: string | undefined): { packs: ResolvedPack[]; notes: string[] } {
  const key = `${builtinPacksDir}||${userPacksDir ?? ""}`;
  if (discoveryCache?.key === key) return discoveryCache;
  const notes: string[] = [];
  const packs: ResolvedPack[] = [];
  for (const [dir, origin] of [[builtinPacksDir, "official"], [userPacksDir, "user"]] as const) {
    if (!dir || !existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pack = loadPackDir(join(dir, entry.name), origin, notes);
      if (pack) packs.push(pack);
    }
  }
  discoveryCache = { key, packs, notes };
  return discoveryCache;
}

function defaultEnabledEntries(): NovelPacksEntry[] {
  return DEFAULT_ENABLED_PACK_IDS.map((id) => ({ id }));
}

// 启用清单重复条目防御：手工编辑/合并可能产生同 id 多条目。完全相同的条目（同 id + 同版本或双双缺失）
// 静默去重保留首条；同 id 但版本冲突（不同版本值，含一条带版本一条不带）→ 无法猜测意图，整 id 排除并留痕。
function dedupeEnabledEntries(entries: NovelPacksEntry[], notes: string[]): NovelPacksEntry[] {
  const order: string[] = [];
  const byId = new Map<string, NovelPacksEntry[]>();
  for (const entry of entries) {
    if (!byId.has(entry.id)) { byId.set(entry.id, []); order.push(entry.id); }
    byId.get(entry.id)!.push(entry);
  }
  const deduped: NovelPacksEntry[] = [];
  for (const id of order) {
    const group = byId.get(id)!;
    const versionKeys = new Set(group.map((e) => e.version ?? "\0"));
    if (versionKeys.size > 1) { notes.push(`启用清单中「${id}」存在冲突版本条目，已全部跳过`); continue; }
    deduped.push(group[0]);
  }
  return deduped;
}

function readEnabledPackEntries(projectRoot: string, notes: string[]): NovelPacksEntry[] {
  const filePath = join(projectRoot, ".narracat", "packs.json");
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(raw?.enabled)) { notes.push("packs.json 形状非法，回退默认启用清单"); return defaultEnabledEntries(); }
    const entries: NovelPacksEntry[] = [];
    for (const item of raw.enabled) {
      if (typeof item?.id !== "string" || item.id.length === 0) continue;
      entries.push(typeof item.version === "string" ? { id: item.id, version: item.version } : { id: item.id });
    }
    return dedupeEnabledEntries(entries, notes);
  } catch {
    return defaultEnabledEntries(); // 文件缺失 = 默认清单（存量书兜底）
  }
}

function resolveCardPath(cardPath: string, pack: ResolvedPack, pluginRoot: string): string {
  const expanded = cardPath.replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b/g, pluginRoot);
  return isAbsolute(expanded) ? expanded : join(pack.rootDir, expanded);
}

export function resolvePackPools(
  projectRoot: string,
  opts: { userPacksDir?: string; builtinPacksDir?: string } = {},
): PackPools {
  const builtinPacksDir = opts.builtinPacksDir ?? defaultBuiltinPacksDir();
  const userPacksDir = opts.userPacksDir ?? process.env.NARRACAT_USER_PACKS_DIR;
  const pluginRoot = resolve(builtinPacksDir, "..");
  const discovered = discoverPacks(builtinPacksDir, userPacksDir);
  const notes = [...discovered.notes];
  const enabled = readEnabledPackEntries(projectRoot, notes);

  const pools: PackPools = { personas: [], craft: [], structure: [], notes };
  const officialById = new Map(discovered.packs.filter((p) => p.origin === "official").map((p) => [p.manifest.id, p]));
  const userPacks = discovered.packs.filter((p) => p.origin === "user");

  for (const entry of enabled) {
    // 双轨版本解析（spec §4.3）：官方内置包随引擎走，导入包按锁定版本精确匹配
    let pack = officialById.get(entry.id);
    if (!pack) {
      if (!entry.version) { notes.push(`已启用的能力包「${entry.id}」缺少版本锁（导入包必须锁版本），已跳过`); continue; }
      pack = userPacks.find((p) => p.manifest.id === entry.id && p.manifest.version === entry.version);
      if (!pack) { notes.push(`已启用的能力包「${entry.id}@${entry.version}」未安装，已跳过`); continue; }
    }
    const provenance = { origin: pack.origin, source_pack_id: pack.manifest.id, source_pack_version: pack.manifest.version };
    for (const card of pack.manifest.cards) {
      const abs = resolveCardPath(card.path, pack, pluginRoot);
      if (card.type === "persona") {
        pools.personas.push({ id: card.id, name: card.name, path: abs, keywords: card.keywords, ...provenance });
      } else if (card.type === "craft") {
        pools.craft.push({
          pack_id: card.id, path: card.path, absolute_path: abs,
          triggers: card.triggers, beat_types: card.beat_types, technique_tags: card.technique_tags,
          emotion_tags: card.emotion_tags, exclusions: card.exclusions, priority: card.priority, ...provenance,
        });
      } else if (card.type === "structure") {
        pools.structure.push({ id: card.id, path: abs, dimension: card.dimension, stage: card.stage, one_line: card.one_line, ...provenance });
      }
      // benchmark 卡：仅 origin=official 登记（R4），本刀无消费方不入池（B2 第二刀接审校对标）
    }
  }
  return pools;
}
