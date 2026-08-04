export const PACK_FORMAT_VERSION = 1;
export const OFFICIAL_PACK_ID_PREFIX = "official-";
export const DEFAULT_ENABLED_PACK_IDS = ["official-base"];
export const STRUCTURE_STAGES = ["stage-1", "stage-2", "stage-opening"];
const KNOWN_CARD_TYPES = new Set(["persona", "craft", "structure", "benchmark"]);
// SemVer（不支持 build metadata `+`——`+` 在 `<id>@<version>` 目录名里不安全）。
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
// id 安全令牌：与 App 侧 pack-store.ts/pack-manifest.ts 同规则（只准字母数字与 `._-`，首字符不可为符号）。
// id 会被 resolver 直接拼进磁盘路径（`<id>@<version>`），放行 `/`、`..` 之类片段会路径穿越出包根目录。
const SAFE_PACK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every((x) => typeof x === "string"); }
export function validatePackManifest(raw) {
    const errors = [];
    const warnings = [];
    if (typeof raw !== "object" || raw === null)
        return { manifest: null, errors: ["manifest 不是对象"], warnings };
    const m = raw;
    if (m.pack_format_version !== PACK_FORMAT_VERSION)
        errors.push(`pack_format_version 不支持（须为 ${PACK_FORMAT_VERSION}）`);
    if (!isNonEmptyString(m.id))
        errors.push("id 缺失或为空");
    else if (!SAFE_PACK_ID_RE.test(m.id))
        errors.push("id 含非法字符（仅允许字母数字与 `._-`，且首字符不可为符号）");
    if (!isNonEmptyString(m.name))
        errors.push("name 缺失或为空");
    if (!isNonEmptyString(m.author))
        errors.push("author（署名）缺失或为空");
    if (!isNonEmptyString(m.version))
        errors.push("version 缺失或为空");
    else if (!SEMVER_RE.test(m.version))
        errors.push("version 不是合法 SemVer（不支持 build metadata）");
    if (!Array.isArray(m.cards))
        errors.push("cards 缺失或不是数组");
    const cards = [];
    const seenCardIds = new Set();
    if (Array.isArray(m.cards)) {
        for (const [i, rawCard] of m.cards.entries()) {
            const c = rawCard;
            const label = `cards[${i}]`;
            if (typeof c !== "object" || c === null || !isNonEmptyString(c.type)) {
                errors.push(`${label} 非法`);
                continue;
            }
            if (!KNOWN_CARD_TYPES.has(c.type)) {
                warnings.push(`${label} 未知卡类型「${c.type}」已跳过`);
                continue;
            }
            if (!isNonEmptyString(c.path) || !isNonEmptyString(c.id)) {
                errors.push(`${label} 缺 path 或 id`);
                continue;
            }
            if (c.type === "persona") {
                if (!isNonEmptyString(c.name) || !isStringArray(c.keywords)) {
                    errors.push(`${label} persona 卡缺 name/keywords`);
                    continue;
                }
            }
            else if (c.type === "craft") {
                const arrays = [c.triggers, c.beat_types, c.technique_tags, c.emotion_tags, c.exclusions];
                if (!arrays.every(isStringArray) || typeof c.priority !== "number") {
                    errors.push(`${label} craft 卡元数据不全`);
                    continue;
                }
            }
            else if (c.type === "structure") {
                if (!isNonEmptyString(c.dimension) || !isNonEmptyString(c.one_line)
                    || !STRUCTURE_STAGES.includes(c.stage)) {
                    errors.push(`${label} structure 卡缺 dimension/stage/one_line 或 stage 非法`);
                    continue;
                }
            }
            else if (c.type === "benchmark") {
                if (!isNonEmptyString(c.genre)) {
                    errors.push(`${label} benchmark 卡缺 genre`);
                    continue;
                }
            }
            if (seenCardIds.has(c.id)) {
                errors.push(`${label} 卡 id「${c.id}」在包内重复`);
                continue;
            }
            seenCardIds.add(c.id);
            cards.push(c);
        }
    }
    if (errors.length > 0)
        return { manifest: null, errors, warnings };
    return {
        manifest: {
            pack_format_version: PACK_FORMAT_VERSION,
            id: m.id, name: m.name, author: m.author,
            version: m.version,
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
