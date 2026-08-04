export const PACK_FORMAT_VERSION = 1;
export const OFFICIAL_PACK_ID_PREFIX = "official-";
export const DEFAULT_ENABLED_PACK_IDS = ["official-base"];

export type PackOrigin = "official" | "user" | "community";

export const STRUCTURE_STAGES = ["stage-1", "stage-2", "stage-opening"] as const;
export type StructureStage = (typeof STRUCTURE_STAGES)[number];

interface PackCardBase { type: string; path: string; id: string }
export interface PersonaCardEntry extends PackCardBase { type: "persona"; name: string; keywords: string[] }
export interface CraftCardEntry extends PackCardBase {
  type: "craft"; triggers: string[]; beat_types: string[]; technique_tags: string[];
  emotion_tags: string[]; exclusions: string[]; priority: number;
}
export interface StructureCardEntry extends PackCardBase {
  type: "structure"; dimension: string; stage: StructureStage; one_line: string;
}
export interface BenchmarkCardEntry extends PackCardBase { type: "benchmark"; genre: string }
export type PackCardEntry = PersonaCardEntry | CraftCardEntry | StructureCardEntry | BenchmarkCardEntry;

export interface PackManifest {
  pack_format_version: number; id: string; name: string; author: string;
  version: string; description?: string;
  min_engine_version?: string; changelog?: string; publisher_id?: string; license?: string;
  cards: PackCardEntry[];
}

const KNOWN_CARD_TYPES = new Set(["persona", "craft", "structure", "benchmark"]);
// SemVer（不支持 build metadata `+`——`+` 在 `<id>@<version>` 目录名里不安全）。
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
// id 安全令牌：与 App 侧 pack-store.ts/pack-manifest.ts 同规则（只准字母数字与 `._-`，首字符不可为符号）。
// id 会被 resolver 直接拼进磁盘路径（`<id>@<version>`），放行 `/`、`..` 之类片段会路径穿越出包根目录。
const SAFE_PACK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isNonEmptyString(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0; }
function isStringArray(v: unknown): v is string[] { return Array.isArray(v) && v.every((x) => typeof x === "string"); }

export function validatePackManifest(raw: unknown): { manifest: PackManifest | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof raw !== "object" || raw === null) return { manifest: null, errors: ["manifest 不是对象"], warnings };
  const m = raw as Record<string, unknown>;

  if (m.pack_format_version !== PACK_FORMAT_VERSION) errors.push(`pack_format_version 不支持（须为 ${PACK_FORMAT_VERSION}）`);
  if (!isNonEmptyString(m.id)) errors.push("id 缺失或为空");
  else if (!SAFE_PACK_ID_RE.test(m.id)) errors.push("id 含非法字符（仅允许字母数字与 `._-`，且首字符不可为符号）");
  if (!isNonEmptyString(m.name)) errors.push("name 缺失或为空");
  if (!isNonEmptyString(m.author)) errors.push("author（署名）缺失或为空");
  if (!isNonEmptyString(m.version)) errors.push("version 缺失或为空");
  else if (!SEMVER_RE.test(m.version)) errors.push("version 不是合法 SemVer（不支持 build metadata）");
  if (!Array.isArray(m.cards)) errors.push("cards 缺失或不是数组");

  const cards: PackCardEntry[] = [];
  const seenCardIds = new Set<string>();
  if (Array.isArray(m.cards)) {
    for (const [i, rawCard] of m.cards.entries()) {
      const c = rawCard as Record<string, unknown>;
      const label = `cards[${i}]`;
      if (typeof c !== "object" || c === null || !isNonEmptyString(c.type)) { errors.push(`${label} 非法`); continue; }
      if (!KNOWN_CARD_TYPES.has(c.type)) { warnings.push(`${label} 未知卡类型「${c.type}」已跳过`); continue; }
      if (!isNonEmptyString(c.path) || !isNonEmptyString(c.id)) { errors.push(`${label} 缺 path 或 id`); continue; }
      if (c.type === "persona") {
        if (!isNonEmptyString(c.name) || !isStringArray(c.keywords)) { errors.push(`${label} persona 卡缺 name/keywords`); continue; }
      } else if (c.type === "craft") {
        const arrays = [c.triggers, c.beat_types, c.technique_tags, c.emotion_tags, c.exclusions];
        if (!arrays.every(isStringArray) || typeof c.priority !== "number") { errors.push(`${label} craft 卡元数据不全`); continue; }
      } else if (c.type === "structure") {
        if (!isNonEmptyString(c.dimension) || !isNonEmptyString(c.one_line)
          || !STRUCTURE_STAGES.includes(c.stage as StructureStage)) { errors.push(`${label} structure 卡缺 dimension/stage/one_line 或 stage 非法`); continue; }
      } else if (c.type === "benchmark") {
        if (!isNonEmptyString(c.genre)) { errors.push(`${label} benchmark 卡缺 genre`); continue; }
      }
      if (seenCardIds.has(c.id as string)) { errors.push(`${label} 卡 id「${c.id as string}」在包内重复`); continue; }
      seenCardIds.add(c.id as string);
      cards.push(c as unknown as PackCardEntry);
    }
  }
  if (errors.length > 0) return { manifest: null, errors, warnings };
  return {
    manifest: {
      pack_format_version: PACK_FORMAT_VERSION,
      id: m.id as string, name: m.name as string, author: m.author as string,
      version: m.version as string,
      ...(isNonEmptyString(m.description) ? { description: m.description } : {}),
      ...(isNonEmptyString(m.min_engine_version) ? { min_engine_version: m.min_engine_version } : {}),
      ...(isNonEmptyString(m.changelog) ? { changelog: m.changelog } : {}),
      ...(isNonEmptyString(m.publisher_id) ? { publisher_id: m.publisher_id } : {}),
      ...(isNonEmptyString(m.license) ? { license: m.license } : {}),
      cards,
    },
    errors, warnings,
  };
}
