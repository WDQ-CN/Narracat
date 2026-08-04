/**
 * MCP 写入口硬校验
 *
 * 启动时（模块加载时）用 ajv 一次性编译全部 schema——编译失败即顶层 throw，
 * mcp-server 启动失败，fail-fast。
 *
 * 校验失败统一返回 { ok: false, errors: [{field, expected, actual, hint}] }；
 * hint 是写给上游 LLM 的修复指令，agent 据此自修正后重试。
 *
 * 覆盖范围：
 * - novel_submit_outline         → schemas/outline-structure.json（书级+卷级）+ 结构预算核验
 * - novel_submit_chapter_outline → outline-structure.json $defs/chapter_outline_batch
 * - novel_submit_extraction      → schemas/memory-extraction.json
 * - novel_submit_review          → schemas/review-report.json
 * - novel_commit_chapter         → 内联 schema（参数即契约，无独立 schema 文件）
 * - novel_consolidate            → 内联 schema
 * - novel_register_foreshadowing → foreshadowing-system.json registry item fragment
 * - CascadeImpactReport          → schemas/cascade-impact-report.json（/rewrite 级联分析）
 *
 * 结构预算公式（computeStructureBudget）也在本文件实现，
 * novel_get_structure_budget 读工具与 submit_outline 校验共用。
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { NARRATOR_ADDRESS_VALUES, isNarratorAddress } from "./narrator-address.js";
import { attributeFact } from "./state-dimensions.js";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
const Ajv2020 = Ajv2020Module;
const addFormats = addFormatsModule;
// ============================================================
// Schema 加载
// ============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 从 mcp-server/src/handlers/（或 dist/handlers/）走两级到 mcp-server/ 再一级到仓库根 schemas/
const SCHEMAS_DIR = resolve(__dirname, "../../../schemas");
function loadJsonSchema(name) {
    return JSON.parse(readFileSync(resolve(SCHEMAS_DIR, name), "utf-8"));
}
const outlineSchema = loadJsonSchema("outline-structure.json");
const premiseSchema = loadJsonSchema("premise-cards.json");
const dialogueSamplesSchema = loadJsonSchema("dialogue-samples.json");
const stateVocabularySchema = loadJsonSchema("state-vocabulary.json");
const characterEntitySchema = loadJsonSchema("character-entity.json");
const authoredStateSchema = loadJsonSchema("authored-state.json");
/** chapter_outline_batch 包装：复用 outline-structure.json 的 $defs */
function buildChapterBatchSchema() {
    const defs = outlineSchema["$defs"];
    if (!defs || typeof defs !== "object") {
        throw new Error("[validators] outline-structure.json 缺少 $defs/chapter_outline_batch——schema 结构变更需同步更新本文件");
    }
    return {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "ChapterOutlineBatch",
        $ref: "#/$defs/chapter_outline_batch",
        $defs: defs,
    };
}
/** foreshadowing-system.json 的单条 registry item fragment（novel_register_foreshadowing 入参） */
function extractForeshadowingItemFragment() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root = loadJsonSchema("foreshadowing-system.json");
    const item = root?.properties?.registry?.items;
    if (!item || typeof item !== "object") {
        throw new Error("[validators] 无法从 foreshadowing-system.json 提取 registry item fragment——schema 结构变更需同步更新本文件");
    }
    return {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "ForeshadowingRegistryItem",
        ...item,
    };
}
// novel_commit_chapter 参数契约（内联：工具入参即契约，无独立 schema 文件）
const COMMIT_CHAPTER_SCHEMA = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "CommitChapterParams",
    type: "object",
    required: [
        "chapter",
        "summary",
        "anchor",
        "key_events",
        "characters_appeared",
        "emotional_tone",
        "continuation_hook",
    ],
    properties: {
        chapter: { type: "integer", minimum: 1 },
        // 叙事摘要 200-500 字（保留丰盛：具体动作/代价/未解压力，禁标签化）
        summary: { type: "string", minLength: 120, maxLength: 1000 },
        anchor: {
            type: "object",
            required: ["core_experience", "heartbeat_moment"],
            properties: {
                core_experience: { type: "string", minLength: 1 },
                heartbeat_moment: { type: "string", minLength: 1 },
            },
        },
        key_events: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: { type: "string", minLength: 1 },
        },
        characters_appeared: {
            type: "array",
            items: { type: "string", minLength: 1 },
        },
        emotional_tone: { type: "string", minLength: 1 },
        continuation_hook: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string", minLength: 1 },
        },
        foreshadowing_actions: {
            type: "array",
            items: {
                type: "object",
                required: ["id", "action"],
                properties: {
                    id: { type: "string", minLength: 1 },
                    action: { type: "string", enum: ["plant", "develop", "reveal"] },
                },
            },
        },
        timeline_note: { type: "string" },
    },
};
// novel_consolidate 参数契约（内联）
const CONSOLIDATE_SCHEMA = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "ConsolidateParams",
    type: "object",
    required: ["scope", "scope_id", "summary"],
    properties: {
        scope: { type: "string", enum: ["arc", "volume"] },
        scope_id: { type: "string", minLength: 1 },
        // arc 300-500 字 / volume 500-800 字；机械下限放宽到 120 字防重试打转
        summary: { type: "string", minLength: 120, maxLength: 2000 },
    },
};
// ============================================================
// ajv 编译（启动一次性，失败即 throw → fail-fast）
// ============================================================
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const outlineValidator = ajv.compile(outlineSchema);
// 书级段校验：同一 schema、required 去掉 volumes（两段制阶段一 a；$defs 随对象展开共享）
const outlineBookSchema = {
    ...outlineSchema,
    required: outlineSchema["required"].filter((key) => key !== "volumes"),
};
const outlineBookValidator = ajv.compile(outlineBookSchema);
const chapterBatchValidator = ajv.compile(buildChapterBatchSchema());
const extractionValidator = ajv.compile(loadJsonSchema("memory-extraction.json"));
const reviewValidator = ajv.compile(loadJsonSchema("review-report.json"));
const cascadeValidator = ajv.compile(loadJsonSchema("cascade-impact-report.json"));
const foreshadowingItemValidator = ajv.compile(extractForeshadowingItemFragment());
const commitChapterValidator = ajv.compile(COMMIT_CHAPTER_SCHEMA);
const consolidateValidator = ajv.compile(CONSOLIDATE_SCHEMA);
const premiseValidator = ajv.compile(premiseSchema);
const dialogueSamplesValidator = ajv.compile(dialogueSamplesSchema);
const stateVocabularyValidator = ajv.compile(stateVocabularySchema);
const characterEntityValidator = ajv.compile(characterEntitySchema);
const authoredStateValidator = ajv.compile(authoredStateSchema);
function pass() {
    return { valid: true, errors: null };
}
function fail(errors) {
    return { valid: false, errors };
}
// ============================================================
// ajv error → ToolErrorItem 通用转换
// ============================================================
function typeOfValue(value) {
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "array";
    return typeof value;
}
function fieldFromInstancePath(instancePath) {
    if (!instancePath)
        return "(root)";
    return instancePath.replace(/^\//, "").replace(/\//g, ".");
}
function extractByPath(rootData, instancePath) {
    if (!instancePath)
        return rootData;
    const parts = instancePath.split("/").filter(Boolean);
    let cur = rootData;
    for (const p of parts) {
        if (cur && typeof cur === "object") {
            cur = cur[p];
        }
        else {
            return undefined;
        }
    }
    return cur;
}
function describeActual(value) {
    if (value === undefined)
        return "missing";
    const t = typeOfValue(value);
    let rendered;
    try {
        rendered = JSON.stringify(value) ?? String(value);
    }
    catch {
        rendered = String(value);
    }
    if (rendered.length > 120)
        rendered = `${rendered.slice(0, 120)}…`;
    return `${t}: ${rendered}`;
}
/**
 * 把 ajv 错误数组转为统一 ToolErrorItem 数组。
 * hint 按 keyword 通用生成，指向 schema 的字段语义。
 */
export function ajvErrorsToItems(errors, rootData, schemaName) {
    const items = [];
    for (const err of errors) {
        const field = fieldFromInstancePath(err.instancePath);
        const actualValue = err.data !== undefined ? err.data : extractByPath(rootData, err.instancePath);
        if (err.keyword === "required") {
            const missing = err.params.missingProperty ?? "";
            const target = field === "(root)" ? missing : `${field}.${missing}`;
            items.push({
                field: target,
                expected: "required",
                actual: "missing",
                hint: `必填字段 ${missing} 缺失，补上后重新提交（字段语义见 ${schemaName}）`,
            });
            continue;
        }
        if (err.keyword === "dependentRequired") {
            // 条件依赖：填了 A 就必须同时填 B（如 payoff_intensity 依附 payoff_beat 存在）——
            // 只有 A 没有 B 是语义矛盾的机械事实，在 ajv 入口拒绝，不让脏数据流进渲染层被静默吞掉
            const present = err.params.property ?? "";
            const missing = err.params.missingProperty ?? "";
            const target = field === "(root)" ? missing : `${field}.${missing}`;
            items.push({
                field: target,
                expected: `填了 ${present} 就必须同时填 ${missing}`,
                actual: "missing",
                hint: `字段 ${present} 依附于 ${missing} 存在：补上 ${missing}，或一并删去 ${present} 后重新提交（字段语义见 ${schemaName}）`,
            });
            continue;
        }
        if (err.keyword === "type") {
            const expectedType = err.params.type ?? "?";
            items.push({
                field,
                expected: expectedType,
                actual: describeActual(actualValue),
                hint: `${field} 类型错误：期望 ${expectedType}。整数不要写成字符串、数组不要写成单值`,
            });
            continue;
        }
        if (err.keyword === "enum") {
            const allowed = JSON.stringify(err.params.allowedValues ?? []);
            items.push({
                field,
                expected: `enum ${allowed}`,
                actual: describeActual(actualValue),
                hint: `${field} 必须取 ${allowed} 之一，原样使用英文枚举值`,
            });
            continue;
        }
        if (err.keyword === "pattern") {
            items.push({
                field,
                expected: `string matching ${err.params.pattern}`,
                actual: describeActual(actualValue),
                hint: `${field} 不符合 pattern ${err.params.pattern}，按 ${schemaName} 中该字段的示例改写`,
            });
            continue;
        }
        if (err.keyword === "minimum" || err.keyword === "maximum") {
            items.push({
                field,
                expected: `${err.keyword} ${err.params.limit}`,
                actual: describeActual(actualValue),
                hint: `${field} ${err.message ?? "数值越界"}`,
            });
            continue;
        }
        if (err.keyword === "minItems" || err.keyword === "maxItems") {
            const n = Array.isArray(actualValue) ? String(actualValue.length) : "非数组";
            items.push({
                field,
                expected: `array ${err.keyword}=${err.params.limit}`,
                actual: `length: ${n}`,
                hint: `${field} 数量必须${err.keyword === "minItems" ? " ≥" : " ≤"} ${err.params.limit}（当前 ${n}）`,
            });
            continue;
        }
        if (err.keyword === "minLength" || err.keyword === "maxLength") {
            const len = typeof actualValue === "string" ? String(actualValue.length) : "非字符串";
            items.push({
                field,
                expected: `string ${err.keyword}=${err.params.limit}`,
                actual: `length: ${len}`,
                hint: err.keyword === "minLength"
                    ? `${field} 太短（当前 ${len} 字符，至少 ${err.params.limit}），补足具体内容而非凑字`
                    : `${field} 太长（当前 ${len} 字符，至多 ${err.params.limit}），压缩到要点`,
            });
            continue;
        }
        if (err.keyword === "false schema") {
            // 条件禁止（schema 里 properties.<field>: false 的 if/then 块）：字段本身合法但
            // 不属于当前提交组合（如 known 只许 mark_secret_known 携带）——fail-loud 指明删字段
            items.push({
                field,
                expected: "（当前提交组合下不允许携带）",
                actual: describeActual(actualValue),
                hint: `字段 ${field} 不适用于本次提交的 action，删去后重新提交（字段适用条件见 ${schemaName} 中该字段的 description）`,
            });
            continue;
        }
        items.push({
            field,
            expected: err.keyword,
            actual: describeActual(actualValue),
            hint: `${field} ${err.message ?? "校验失败"}（schema: ${schemaName}）`,
        });
    }
    return items;
}
function runAjv(validator, value, schemaName) {
    const passed = validator(value);
    if (passed)
        return pass();
    return fail(ajvErrorsToItems(validator.errors ?? [], value, schemaName));
}
// ============================================================
// 各工具入口校验
// ============================================================
export function validateOutlinePayload(value) {
    return runAjv(outlineValidator, value, "outline-structure.json");
}
export function validateOutlineBookPayload(value) {
    return runAjv(outlineBookValidator, value, "outline-structure.json（书级段，volumes 非必填）");
}
export function validateChapterOutlineBatch(value) {
    return runAjv(chapterBatchValidator, value, "outline-structure.json#/$defs/chapter_outline_batch");
}
export function validateExtraction(value) {
    return runAjv(extractionValidator, value, "memory-extraction.json");
}
export function validateReview(value) {
    return runAjv(reviewValidator, value, "review-report.json");
}
export function validateForeshadowingItem(value) {
    return runAjv(foreshadowingItemValidator, value, "foreshadowing-system.json#registry.items");
}
export function validateCommitChapter(value) {
    return runAjv(commitChapterValidator, value, "novel_commit_chapter 参数");
}
export function validateConsolidate(value) {
    return runAjv(consolidateValidator, value, "novel_consolidate 参数");
}
export function validatePremise(value) {
    return runAjv(premiseValidator, value, "premise-cards.json");
}
/** 本书状态词表（bible/state-vocabulary.json）：novel_submit_state_vocabulary 写入口 */
export function validateStateVocabulary(value) {
    return runAjv(stateVocabularyValidator, value, "state-vocabulary.json");
}
/** 角色结构化实体（bible/characters/<name>.json）：novel_submit_character_entity 写入口 */
export function validateCharacterEntity(value) {
    return runAjv(characterEntityValidator, value, "character-entity.json");
}
/** 作者对角色结构化状态的直接修订 */
export function validateAuthoredState(value) {
    return runAjv(authoredStateValidator, value, "authored-state.json");
}
/**
 * 校验 CascadeImpactReport 完整对象（级联影响分析产出）。
 * 两类变更共用本契约，ajv 之上按 change_kind 补语义约束：
 * - 公共：has_impact=true 时 affected_chapters 非空
 * - chapter_rewrite（默认）：必带 rewritten_chapter；affected_chapters[].chapter 必须 > rewritten_chapter
 * - character_added：必带 added_character 与 insertion_point；
 *     insertion_point=forward（纯前向，仅建档）时 has_impact 必须为 false
 */
export function validateCascadeImpactReport(value) {
    const base = runAjv(cascadeValidator, value, "cascade-impact-report.json");
    const errors = base.valid ? [] : [...base.errors];
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const obj = value;
        const changeKind = obj.change_kind === undefined ? "chapter_rewrite" : obj.change_kind;
        if (obj.has_impact === true &&
            Array.isArray(obj.affected_chapters) &&
            obj.affected_chapters.length === 0) {
            errors.push({
                field: "affected_chapters",
                expected: "has_impact=true 时非空数组",
                actual: "length: 0",
                hint: "has_impact=true 与空 affected_chapters 矛盾：填入至少一个受影响章节，或把 has_impact 改为 false",
            });
        }
        if (changeKind === "chapter_rewrite") {
            if (typeof obj.rewritten_chapter !== "number" ||
                !Number.isInteger(obj.rewritten_chapter) ||
                obj.rewritten_chapter < 1) {
                errors.push({
                    field: "rewritten_chapter",
                    expected: "integer ≥ 1（change_kind=chapter_rewrite 必填）",
                    actual: describeActual(obj.rewritten_chapter),
                    hint: "重写类级联必须给出被重写的章节号 rewritten_chapter",
                });
            }
            else if (Array.isArray(obj.affected_chapters)) {
                for (let i = 0; i < obj.affected_chapters.length; i++) {
                    const item = obj.affected_chapters[i];
                    if (item && typeof item === "object" && !Array.isArray(item)) {
                        const ch = item.chapter;
                        if (typeof ch === "number" && Number.isInteger(ch) && ch <= obj.rewritten_chapter) {
                            errors.push({
                                field: `affected_chapters.${i}.chapter`,
                                expected: `integer > rewritten_chapter (${obj.rewritten_chapter})`,
                                actual: String(ch),
                                hint: `重写级联只针对后续章节：affected_chapters[${i}].chapter (${ch}) 必须大于 rewritten_chapter (${obj.rewritten_chapter})`,
                            });
                        }
                    }
                }
            }
        }
        else if (changeKind === "character_added") {
            if (typeof obj.added_character !== "string" || !obj.added_character.trim()) {
                errors.push({
                    field: "added_character",
                    expected: "非空字符串（change_kind=character_added 必填）",
                    actual: describeActual(obj.added_character),
                    hint: "角色新增类级联必须给出新增角色显示名 added_character",
                });
            }
            const insertion = obj.insertion_point;
            if (insertion !== "forward" && insertion !== "backward" && insertion !== "retroactive") {
                errors.push({
                    field: "insertion_point",
                    expected: "forward / backward / retroactive（change_kind=character_added 必填）",
                    actual: describeActual(insertion),
                    hint: "按时间插入点路由级联：forward（仅建档无级联）/ backward（后续纳入）/ retroactive（追溯回填已写章）",
                });
            }
            else if (insertion === "forward" && obj.has_impact === true) {
                errors.push({
                    field: "has_impact",
                    expected: "insertion_point=forward 时为 false",
                    actual: "true",
                    hint: "纯前向新增只建档、不回溯进已写章，无级联：has_impact 应为 false，或把 insertion_point 改为 backward/retroactive",
                });
            }
        }
    }
    return errors.length === 0 ? pass() : fail(errors);
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
const ARC_SPAN_BY_TIER = {
    S: { min: 5, max: 15 },
    M: { min: 10, max: 25 },
    L: { min: 15, max: 35 },
    XL: { min: 20, max: 40 },
};
/**
 * 伏笔兑现节奏阈值（可调）：网文要求长线悬念稳定供给、近线伏笔及时兑现。
 * 集中成一个对象便于产品收紧/放宽。
 * - major_min_payoffs_per_volume：每卷至少应兑现的 major 伏笔条数（长线悬念密度下限）
 * - small 伏笔应 arc 内兑现、medium 应本卷内兑现——跨界即视为延迟兑现
 */
// C1 阈值复核（#340 遗愿）：伏笔跨度是「大纲注册表结构级」量，剧情网格 9 字段是「章级」标签，
// grid 实测数据结构性够不到伏笔卷级跨度——以下两值无章级实测背书，沿用 #340 单本诊断（F-MAJ-01 跨 4 卷违规）+ 网文阶段性利息常识。
export const FORESHADOWING_PAYOFF_THRESHOLDS = {
    major_min_payoffs_per_volume: 2,
    // 单条 major 兑现允许跨的卷数上限：major 本就长线可跨卷，但跨过多卷=久悬不付利息（反网文阶段性利息）。
    // 以卷为「结账」单位而非章数（章数因书长浮动），>该值即告警；不阻断。
    major_max_span_volumes: 2,
};
export function computeStructureBudget(estimatedTotalChapters, wordsPerChapter) {
    const totalWords = estimatedTotalChapters * wordsPerChapter;
    const tier = totalWords <= 600_000
        ? "S"
        : totalWords <= 1_500_000
            ? "M"
            : totalWords <= 3_000_000
                ? "L"
                : "XL";
    const arcSpan = ARC_SPAN_BY_TIER[tier];
    const arcMid = Math.round((arcSpan.min + arcSpan.max) / 2);
    const arcsEstimate = Math.max(1, Math.ceil(estimatedTotalChapters / arcMid));
    const volumesRecommended = Math.max(1, Math.ceil(estimatedTotalChapters / 60));
    return {
        tier,
        total_chapters: estimatedTotalChapters,
        total_words: totalWords,
        volumes: {
            recommended: volumesRecommended,
            min: Math.max(1, Math.ceil(estimatedTotalChapters / 80)),
            max: Math.max(1, Math.ceil(estimatedTotalChapters / 40)),
        },
        arc_span: arcSpan,
        storyline_budget: clamp(Math.floor(totalWords / 10_000 / 50), 2, 8),
        arcs_estimate: arcsEstimate,
        foreshadowing: {
            major: volumesRecommended,
            medium: arcsEstimate,
            small: Math.max(1, Math.floor(estimatedTotalChapters / 10)),
        },
        iconic_scenes_per_volume: [2, 3],
        turning_points_per_volume: 3,
        payoff_beats_min_per_arc: tier === "S" ? 0 : 1,
    };
}
const MILESTONE_RANK = {
    ability: 1,
    choice: 2,
    value: 3,
    identity: 4,
    existential: 5,
};
/**
 * target_reveal → 兑现章号：纯数字直接用；vol-VV 取该卷最后一章（从 volumeLastChapter 映射）；
 * 无法解析返回 null。供 checkOutlineSemantics（时序完整性）与 checkForeshadowingPayoffTiming（节奏）共用。
 */
export function resolveRevealChapter(targetReveal, volumeLastChapter) {
    const volMatch = /^vol-(\d{2})$/.exec(targetReveal);
    if (volMatch) {
        return volumeLastChapter.get(Number(volMatch[1])) ?? null;
    }
    const chapter = Number(targetReveal);
    return Number.isInteger(chapter) && chapter > 0 ? chapter : null;
}
/**
 * 结构语义核验：arc 区间合法、有序、不重叠、连续；卷号与 id 唯一；伏笔兑现晚于埋设。
 */
export function checkOutlineSemantics(payload) {
    const errors = [];
    const warnings = [];
    const volumes = [...payload.volumes].sort((a, b) => a.volume_no - b.volume_no);
    const volumeLastChapter = new Map();
    const seenVolumeNos = new Set();
    const seenArcIds = new Set();
    let prevEnd = 0;
    let isFirstArc = true;
    for (const vol of volumes) {
        if (seenVolumeNos.has(vol.volume_no)) {
            errors.push({
                field: "volumes",
                expected: "volume_no 唯一",
                actual: `volume_no ${vol.volume_no} 重复`,
                hint: `卷号 ${vol.volume_no} 出现多次，合并为一卷或改正卷号`,
            });
        }
        seenVolumeNos.add(vol.volume_no);
        const arcs = [...vol.arc_list].sort((a, b) => a.chapter_start - b.chapter_start);
        for (const arc of arcs) {
            if (seenArcIds.has(arc.arc_id)) {
                errors.push({
                    field: `volumes[${vol.volume_no}].arc_list`,
                    expected: "arc_id 唯一",
                    actual: `arc_id ${arc.arc_id} 重复`,
                    hint: `arc_id ${arc.arc_id} 出现多次，改成唯一标识（如 V0${vol.volume_no}-A02）`,
                });
            }
            seenArcIds.add(arc.arc_id);
            if (arc.chapter_end < arc.chapter_start) {
                errors.push({
                    field: `arc ${arc.arc_id}`,
                    expected: "chapter_end ≥ chapter_start",
                    actual: `${arc.chapter_start}-${arc.chapter_end}`,
                    hint: `arc ${arc.arc_id} 的起止章号填反了，调换后重新提交`,
                });
                continue;
            }
            if (isFirstArc) {
                if (arc.chapter_start !== 1) {
                    warnings.push(`首个 arc 从第 ${arc.chapter_start} 章开始（非第 1 章）——增量提交后续卷时正常，全新规划时请检查`);
                }
                isFirstArc = false;
            }
            else if (arc.chapter_start !== prevEnd + 1) {
                errors.push({
                    field: `arc ${arc.arc_id}`,
                    expected: `chapter_start = ${prevEnd + 1}（与上一 arc 连续）`,
                    actual: `chapter_start = ${arc.chapter_start}`,
                    hint: `arc 区间必须连续无缝：上一 arc 结束于第 ${prevEnd} 章，本 arc 应从第 ${prevEnd + 1} 章开始`,
                });
            }
            prevEnd = Math.max(prevEnd, arc.chapter_end);
            volumeLastChapter.set(vol.volume_no, Math.max(volumeLastChapter.get(vol.volume_no) ?? 0, arc.chapter_end));
        }
    }
    const slIds = new Set();
    for (const sl of payload.storylines) {
        if (slIds.has(sl.id)) {
            errors.push({
                field: "storylines",
                expected: "id 唯一",
                actual: `id ${sl.id} 重复`,
                hint: `故事线 id ${sl.id} 出现多次，合并或改名`,
            });
        }
        slIds.add(sl.id);
    }
    if (payload.storylines.length >= 3 &&
        !payload.storylines.some((sl) => sl.is_through_line === true)) {
        warnings.push("未标记任何全书贯穿故事线（is_through_line=true）——建议把主线/宿敌线标记为贯穿线，使其进 WCP 常驻层、远卷写作时不被卷滚动丢弃");
    }
    const fsIds = new Set();
    for (const fs of payload.foreshadowing_registry) {
        if (fsIds.has(fs.id)) {
            errors.push({
                field: "foreshadowing_registry",
                expected: "id 唯一",
                actual: `id ${fs.id} 重复`,
                hint: `伏笔 id ${fs.id} 出现多次，合并或改名`,
            });
        }
        fsIds.add(fs.id);
        // 伏笔时序完整性：兑现章必须晚于埋设章——先兑后埋是不可能数据（vol-NN 解析后比较）
        const revealChapter = resolveRevealChapter(fs.target_reveal, volumeLastChapter);
        if (revealChapter !== null && revealChapter <= fs.planted_chapter) {
            errors.push({
                field: `foreshadowing ${fs.id}`,
                expected: "兑现章晚于埋设章（target_reveal > planted_chapter）",
                actual: `埋第 ${fs.planted_chapter}、兑第 ${revealChapter} 章`,
                hint: `伏笔 ${fs.id} 的兑现位不晚于埋设位——伏笔必须先埋后兑，把 target_reveal 调到 planted_chapter 之后，或修正 planted_chapter`,
            });
        }
    }
    return { errors, warnings };
}
/**
 * 预算下限核验：用 computeStructureBudget 的数字作 validator 下限。
 * 下限按已提交章数等比折算——超长篇允许先交书级骨架+第一卷。
 */
export function checkOutlineBudget(payload, budget) {
    const errors = [];
    const warnings = [];
    const arcs = payload.volumes.flatMap((v) => v.arc_list);
    const submittedChapters = arcs.reduce((max, a) => Math.max(max, a.chapter_end), 0);
    const coverage = clamp(submittedChapters / Math.max(1, budget.total_chapters), 0, 1);
    for (const arc of arcs) {
        const span = arc.chapter_end - arc.chapter_start + 1;
        if (span > budget.arc_span.max) {
            errors.push({
                field: `arc ${arc.arc_id}`,
                expected: `跨度 ≤ ${budget.arc_span.max} 章（${budget.tier} 档）`,
                actual: `${span} 章`,
                hint: `arc ${arc.arc_id} 跨 ${span} 章，超出 ${budget.tier} 档上限，拆成两个以上 arc`,
            });
        }
        else if (span < budget.arc_span.min) {
            if (arc.chapter_end === submittedChapters) {
                warnings.push(`末尾 arc ${arc.arc_id} 仅 ${span} 章（低于 ${budget.tier} 档下限 ${budget.arc_span.min}），收尾 arc 可接受`);
            }
            else {
                errors.push({
                    field: `arc ${arc.arc_id}`,
                    expected: `跨度 ≥ ${budget.arc_span.min} 章（${budget.tier} 档）`,
                    actual: `${span} 章`,
                    hint: `arc ${arc.arc_id} 只有 ${span} 章，并入相邻 arc 或扩展事件密度`,
                });
            }
        }
        if (arc.payoff_beats.length < budget.payoff_beats_min_per_arc) {
            errors.push({
                field: `arc ${arc.arc_id}.payoff_beats`,
                expected: `≥ ${budget.payoff_beats_min_per_arc} 个爽点`,
                actual: `${arc.payoff_beats.length} 个`,
                hint: `arc ${arc.arc_id} 没有编排爽点，从 face_slap/level_up/windfall/fame/reveal/reunion/counterattack/sweet 中选至少 1 个`,
            });
        }
    }
    if (payload.storylines.length < 2) {
        errors.push({
            field: "storylines",
            expected: `≥ 2 条（本书预算 ${budget.storyline_budget} 条）`,
            actual: `${payload.storylines.length} 条`,
            hint: "至少需要主线 + 1 条副线；按预算补足故事线",
        });
    }
    else if (Math.abs(payload.storylines.length - budget.storyline_budget) > 2) {
        warnings.push(`故事线 ${payload.storylines.length} 条与预算 ${budget.storyline_budget} 条偏差较大`);
    }
    const majorCount = payload.foreshadowing_registry.filter((f) => f.type === "major").length;
    if (majorCount < 1) {
        errors.push({
            field: "foreshadowing_registry",
            expected: `≥ 1 条 major（本书预算约 ${budget.foreshadowing.major} 条）`,
            actual: `${majorCount} 条 major`,
            hint: "至少注册 1 条贯穿多卷的 major 伏笔作为长线悬念",
        });
    }
    const totalMin = Math.max(1, Math.floor((budget.foreshadowing.small * coverage) / 2));
    if (payload.foreshadowing_registry.length < totalMin) {
        errors.push({
            field: "foreshadowing_registry",
            expected: `≥ ${totalMin} 条（按已提交 ${submittedChapters} 章折算的下限）`,
            actual: `${payload.foreshadowing_registry.length} 条`,
            hint: `伏笔注册量不足：本书预算 major ≈ ${budget.foreshadowing.major} / medium ≈ ${budget.foreshadowing.medium} / small ≈ ${budget.foreshadowing.small}，至少补到 ${totalMin} 条`,
        });
    }
    if (submittedChapters >= budget.total_chapters &&
        payload.volumes.length < budget.volumes.min) {
        errors.push({
            field: "volumes",
            expected: `≥ ${budget.volumes.min} 卷（每卷 40-80 章）`,
            actual: `${payload.volumes.length} 卷`,
            hint: `全书 ${budget.total_chapters} 章至少分 ${budget.volumes.min} 卷，按约 60 章/卷重新分卷`,
        });
    }
    return { errors, warnings };
}
/**
 * 困境里程碑核验（全书里程碑制）：
 * - 声明的里程碑随卷序单调不降（ability→choice→value→identity→existential）
 * - 覆盖全书 50% 处的卷（如声明）须达 value 及以上
 * - 末卷（chapter_end ≥ 全书总章数，如声明）须达 identity / existential
 */
export function checkDilemmaMilestones(payload, totalChapters) {
    if (payload.volumes.length === 0)
        return { errors: [], warnings: [] };
    const errors = [];
    const warnings = [];
    const volumes = [...payload.volumes].sort((a, b) => a.volume_no - b.volume_no);
    let prevRank = 0;
    for (const vol of volumes) {
        if (!vol.dilemma_milestone)
            continue;
        const rank = MILESTONE_RANK[vol.dilemma_milestone] ?? 0;
        if (rank < prevRank) {
            errors.push({
                field: `volumes[${vol.volume_no}].dilemma_milestone`,
                expected: "里程碑随卷序单调不降（ability→choice→value→identity→existential）",
                actual: vol.dilemma_milestone,
                hint: `第 ${vol.volume_no} 卷的困境层级低于前一卷，困境只升不降`,
            });
        }
        prevRank = Math.max(prevRank, rank);
        if (totalChapters && totalChapters > 0 && vol.arc_list.length > 0) {
            const volStart = Math.min(...vol.arc_list.map((a) => a.chapter_start));
            const volEnd = Math.max(...vol.arc_list.map((a) => a.chapter_end));
            const midChapter = Math.floor(totalChapters * 0.5);
            if (volStart <= midChapter && midChapter <= volEnd && rank < MILESTONE_RANK.value) {
                errors.push({
                    field: `volumes[${vol.volume_no}].dilemma_milestone`,
                    expected: "全书 50% 处达 value 及以上",
                    actual: vol.dilemma_milestone,
                    hint: `第 ${vol.volume_no} 卷覆盖全书中点（第 ${midChapter} 章），困境层级至少升到 value`,
                });
            }
            if (volEnd >= totalChapters && rank < MILESTONE_RANK.identity) {
                errors.push({
                    field: `volumes[${vol.volume_no}].dilemma_milestone`,
                    expected: "末段达 identity 或 existential",
                    actual: vol.dilemma_milestone,
                    hint: `第 ${vol.volume_no} 卷是全书末卷，困境层级须达 identity 或 existential`,
                });
            }
        }
    }
    return { errors, warnings };
}
/**
 * 伏笔兑现节奏核验（确定性、纯代码，非 LLM）：
 * 检查伏笔注册表的兑现节奏是否合网文规律，对反网文的延迟兑现告警。
 *
 * 一律产出 warning、绝不阻断入库——架构师可有意为之，告警随回执给架构师按需调整。
 *
 * 卷/arc 归属从 arc_meta（arc_list 的 chapter_start/chapter_end + volume_no）机械推导；
 * target_reveal 兼容章号（"120"）与卷级粗锚点（"vol-08"，解析为该卷最后一章）。
 *
 * 三类节奏告警：
 * 1. 每卷 major 兑现密度：每卷至少兑现 major_min_payoffs_per_volume 条，不足则告警。
 * 2. 单条 major 兑现跨度：major 可跨卷，但跨过 major_max_span_volumes 卷=久悬不付利息，单条告警。
 * 3. 近线伏笔远期距离：small 不跨 arc、medium 不跨卷——埋设位与兑现位跨界则告警。
 */
export function checkForeshadowingPayoffTiming(payload) {
    if (payload.volumes.length === 0)
        return { errors: [], warnings: [] };
    const errors = [];
    const warnings = [];
    const volumes = [...payload.volumes].sort((a, b) => a.volume_no - b.volume_no);
    // arc_meta 机械推导：章号 → arc / 卷；卷号 → 卷的最后一章（解析 vol-VV 锚点用）
    const chapterToArc = new Map();
    const chapterToVolume = new Map();
    const volumeLastChapter = new Map();
    for (const vol of volumes) {
        for (const arc of vol.arc_list) {
            for (let c = arc.chapter_start; c <= arc.chapter_end; c += 1) {
                chapterToArc.set(c, arc.arc_id);
                chapterToVolume.set(c, vol.volume_no);
            }
            volumeLastChapter.set(vol.volume_no, Math.max(volumeLastChapter.get(vol.volume_no) ?? 0, arc.chapter_end));
        }
    }
    // 每卷 major 兑现计数（按兑现章所属卷归户）
    const majorPayoffsByVolume = new Map();
    for (const vol of volumes)
        majorPayoffsByVolume.set(vol.volume_no, 0);
    for (const fs of payload.foreshadowing_registry) {
        const revealChapter = resolveRevealChapter(fs.target_reveal, volumeLastChapter);
        if (revealChapter === null)
            continue; // 无法机械解析的锚点跳过，不臆测
        if (fs.type === "major") {
            const revealVolume = chapterToVolume.get(revealChapter);
            if (revealVolume !== undefined) {
                majorPayoffsByVolume.set(revealVolume, (majorPayoffsByVolume.get(revealVolume) ?? 0) + 1);
                // 单条 major 的兑现跨度：密度达标也要查——单条长线悬念久悬不付利息（如埋第8章兑第180章）
                const plantedVolume = chapterToVolume.get(fs.planted_chapter);
                if (plantedVolume !== undefined &&
                    revealVolume - plantedVolume > FORESHADOWING_PAYOFF_THRESHOLDS.major_max_span_volumes) {
                    const spanVolumes = revealVolume - plantedVolume;
                    const spanChapters = revealChapter - fs.planted_chapter;
                    warnings.push(`伏笔 ${fs.id}（major）兑现跨度过长：埋设于第 ${plantedVolume} 卷（第 ${fs.planted_chapter} 章）拖到第 ${revealVolume} 卷（第 ${revealChapter} 章）兑现，跨 ${spanVolumes} 卷 / ${spanChapters} 章——major 可跨卷但不宜久悬不付利息，考虑中途加阶段性揭示或拉近兑现位`);
                }
            }
            continue;
        }
        // small / medium：近线伏笔的跨界距离
        const plantedArc = chapterToArc.get(fs.planted_chapter);
        const revealArc = chapterToArc.get(revealChapter);
        const plantedVolume = chapterToVolume.get(fs.planted_chapter);
        const revealVolume = chapterToVolume.get(revealChapter);
        if (fs.type === "small") {
            if (plantedArc !== undefined && revealArc !== undefined && plantedArc !== revealArc) {
                warnings.push(`伏笔 ${fs.id}（small）应在 arc 内兑现：埋设于 ${plantedArc}（第 ${fs.planted_chapter} 章）却拖到 ${revealArc}（第 ${revealChapter} 章）兑现——small 伏笔跨 arc 即延迟兑现，改为 medium 或拉近兑现位`);
            }
        }
        else if (fs.type === "medium") {
            if (plantedVolume !== undefined &&
                revealVolume !== undefined &&
                plantedVolume !== revealVolume) {
                warnings.push(`伏笔 ${fs.id}（medium）应在本卷内兑现：埋设于第 ${plantedVolume} 卷（第 ${fs.planted_chapter} 章）却拖到第 ${revealVolume} 卷（第 ${revealChapter} 章）兑现——medium 伏笔跨卷即延迟兑现，改为 major 或拉近兑现位`);
            }
        }
    }
    // 每卷 major 兑现密度：不足下限则告警（架构师可有意为之，不阻断）
    const minPerVolume = FORESHADOWING_PAYOFF_THRESHOLDS.major_min_payoffs_per_volume;
    for (const vol of volumes) {
        const count = majorPayoffsByVolume.get(vol.volume_no) ?? 0;
        if (count < minPerVolume) {
            warnings.push(`第 ${vol.volume_no} 卷 major 伏笔兑现仅 ${count} 条（建议每卷至少兑现 ${minPerVolume} 条）——长线悬念扎堆末卷兑现会让中段卷缺乏大爆发，把部分 major 的 target_reveal 提前到本卷`);
        }
    }
    return { errors, warnings };
}
/**
 * 结构节奏反退化门控阈值（可调）：只拦明显机械的退化产出，不规定具体长短/章号。
 * 集中成一个对象便于产品收紧/放宽，仿 FORESHADOWING_PAYOFF_THRESHOLDS。
 */
export const STRUCTURE_RHYTHM_THRESHOLDS = {
    // D1 arc 匀速：arc 数达此下限才判（小书豁免）；众数长度占比超此值即判匀速退化
    arc_rhythm_min_arcs: 6,
    arc_mode_share_max: 0.6,
    // D2 全 ch1 入场：故事线达此下限才判错峰（小书豁免）
    storyline_min_for_stagger: 3,
    // D2 中段收线：故事线达此下限才判中段收线（小书豁免）
    storyline_min_for_midpoint: 4,
    // 中段收线窗口：planned_payoff_chapter 落在全书 [start, end] 比例区间算中段收线
    midpoint_payoff_window: { start: 0.1, end: 0.85 },
    // D3 死伏笔：small 跨度 > arc_span.max 的此倍数 → ERROR / WARNING
    // C1 复核：伏笔/arc 跨度为大纲结构级，grid 章级数据够不到——沿用结构常识值，无实测校准
    small_span_error_multiple: 2,
    small_span_warn_multiple: 1,
    // D3 major 粗锚：planted_chapter ≤ 全书此比例视为「早埋」
    // C1 实测背书（#340 复核）：金手指首现相对书位全局中位 0.04（男频 0.01 / 女频 0.08），头部网文 major 元素书前 4% 即现 → 0.05 与实测吻合，保留
    major_early_plant_ratio: 0.05,
};
/**
 * 开局留存门控阈值（可调）：只抬开局爽点前置的硬下限，不规定爽点类型/具体章号。
 * 集中成对象便于产品收紧/放宽，仿 STRUCTURE_RHYTHM_THRESHOLDS。
 */
export const OPENING_RETENTION_THRESHOLDS = {
    // 黄金三章：章号 ≤ 此值的章视为开局章（C1 实测背书：B-p1 案例池 first_payoff 100% ≤3 章）
    golden_chapters: 3,
    // 开局须落的 payoff_beat 数下限（D-open-1 硬下限；C1 实测全局 57% 章有爽点，开局段更密）
    min_opening_payoff_beats: 1,
    // 开局批内 payoff_beat 连续为空超过此章数 → D-open-2 WARN
    // C1 实测复核（了结 #340）：全局爽点间隔 p90=3 章（男频 small p90=4），开局段更密（B-p1 池 first_payoff 100%≤3 章）
    // → 5 章死区告警线偏松，收紧到 4（gap>4 即 ≥5 连续空触发；留一章裕度避 payoff_beat 主观标注误报）
    max_opening_payoff_gap_warn: 4,
};
/**
 * 结构节奏反退化门控（确定性、纯代码，非 LLM）：
 * 提交全书 arc 骨架 + storylines + foreshadowing_registry 时看全局，只 BAN 明显机械的
 * 退化产出，不规定具体长短/章号——下限被硬抬，天花板由 pack + prompt 决定。
 * 阈值随 tier / arc_span 折算，小书豁免对应门。
 *
 *   D1 arc 匀速      ERROR  arc≥6 且众数长度占比 >60%
 *   D2 全 ch1 入场    ERROR  storyline≥3 且全部 entry_chapter==1
 *   D2 零中段收线     WARN   storyline≥4 且无一条 planned_payoff_chapter 落在全书 10%-85%
 *   D3 死伏笔        ERROR/WARN  small 跨度 >2×arc_span.max → ERROR；>1× → WARN；small 用 vol-NN → WARN
 *   D3 major 粗锚    WARN   major 早埋（书前 5%）却用 vol-NN 锚点
 */
export function checkStructureRhythm(payload, budget) {
    const errors = [];
    const warnings = [];
    const T = STRUCTURE_RHYTHM_THRESHOLDS;
    // ---- D1 arc 匀速 ----
    const arcs = payload.volumes.flatMap((v) => v.arc_list);
    if (arcs.length >= T.arc_rhythm_min_arcs) {
        const lengths = arcs.map((a) => a.chapter_end - a.chapter_start + 1);
        const freq = new Map();
        for (const len of lengths)
            freq.set(len, (freq.get(len) ?? 0) + 1);
        let modeLen = lengths[0];
        let modeCount = 0;
        for (const [len, count] of freq) {
            if (count > modeCount) {
                modeCount = count;
                modeLen = len;
            }
        }
        const share = modeCount / lengths.length;
        if (share > T.arc_mode_share_max) {
            errors.push({
                field: "arc 长短节奏",
                expected: "arc 长度随剧情功能起伏（建立/过场/转折压短、蓄势/高潮拉长）",
                actual: `${arcs.length} 个 arc 中 ${modeCount} 个都是 ${modeLen} 章（占 ${Math.round(share * 100)}%）`,
                hint: "arc-rhythm 包：按剧情功能定 arc 长短——建立/过场/转折 arc 压短贴下限、蓄势/高潮/收束 arc 拉长贴上限，全书长短要有可读出的起伏、不对齐同一数字",
            });
        }
    }
    // ---- D2 全 ch1 入场 ----
    const sls = payload.storylines;
    if (sls.length >= T.storyline_min_for_stagger &&
        sls.every((s) => s.entry_chapter === 1)) {
        errors.push({
            field: "storylines.entry_chapter",
            expected: "副线随触发事件错峰进场（非全部第 1 章）",
            actual: `${sls.length} 条故事线全部 entry_chapter=1`,
            hint: "storyline-weave 包：主线第 1 章入场，副线各随其触发事件错峰进场，避免所有线第一章一拥而上",
        });
    }
    // ---- D2 零中段收线 ----
    if (sls.length >= T.storyline_min_for_midpoint && budget.total_chapters > 0) {
        const lo = budget.total_chapters * T.midpoint_payoff_window.start;
        const hi = budget.total_chapters * T.midpoint_payoff_window.end;
        const hasMidpoint = sls.some((s) => s.planned_payoff_chapter !== undefined &&
            s.planned_payoff_chapter >= lo &&
            s.planned_payoff_chapter <= hi);
        if (!hasMidpoint) {
            warnings.push(`${sls.length} 条故事线无一条 planned_payoff_chapter 落在全书中段区间（第 ${Math.round(lo)}-${Math.round(hi)} 章）——storyline-weave 包：中段收掉一些线再开新线，别把所有线都拖到结尾或不给收线章`);
        }
    }
    // ---- D3 死伏笔 + major 粗锚 ----
    const errMax = T.small_span_error_multiple * budget.arc_span.max;
    const warnMax = T.small_span_warn_multiple * budget.arc_span.max;
    const earlyPlant = budget.total_chapters * T.major_early_plant_ratio;
    for (const fs of payload.foreshadowing_registry) {
        const volAnchor = /^vol-\d{2}$/.test(fs.target_reveal);
        if (fs.type === "small") {
            if (volAnchor) {
                warnings.push(`伏笔 ${fs.id}（small）用卷级粗锚点 ${fs.target_reveal} 标兑现——foreshadow-distance 包：small 伏笔应在 arc 内快速兑现并给确切章号，改用近距章号或降档为 medium/major`);
                continue;
            }
            const reveal = Number(fs.target_reveal);
            if (!Number.isInteger(reveal) || reveal <= 0)
                continue;
            const span = reveal - fs.planted_chapter;
            if (span > errMax) {
                errors.push({
                    field: `foreshadowing ${fs.id}`,
                    expected: `small 伏笔跨度 ≤ ${errMax} 章（${budget.tier} 档 arc 上限 ${budget.arc_span.max} 的 ${T.small_span_error_multiple} 倍）`,
                    actual: `跨 ${span} 章（埋第 ${fs.planted_chapter}、兑第 ${reveal}）`,
                    hint: "foreshadow-distance 包：small 伏笔应在 arc 内快速兑现；跨度这么大说明它其实是 medium/major，降档登记、拆成中继伏笔分段兑现，或拉近兑现章",
                });
            }
            else if (span > warnMax) {
                warnings.push(`伏笔 ${fs.id}（small）跨 ${span} 章（埋第 ${fs.planted_chapter}、兑第 ${reveal}）超出单个 arc 跨度（${budget.tier} 档 ≤ ${budget.arc_span.max} 章）——foreshadow-distance 包：small 应 arc 内兑现，降档为 medium 或拉近兑现位`);
            }
            continue;
        }
        if (fs.type === "major" && volAnchor && fs.planted_chapter <= earlyPlant) {
            warnings.push(`伏笔 ${fs.id}（major）早埋于第 ${fs.planted_chapter} 章（书前 ${Math.round(T.major_early_plant_ratio * 100)}%）却用卷级粗锚点 ${fs.target_reveal} 标兑现——早揭的 major 可用精确章号替代 vol-NN 粗锚（远期 major 才适合卷级粗锚），让兑现位更可控`);
        }
    }
    return { errors, warnings };
}
// 大纲散文洁净门判据：中文散文里绝不出现的机器 token（命中即打回自修正）
const PROSE_ID_RE = /\b([A-Z]{1,3}-[A-Za-z0-9][A-Za-z0-9-]*|[A-Z]{1,3}\d{2,}|V\d{2}-A\d{2})\b/; // F-SML-04 / S-HERB / SL-revenge / F01 / V01-A03
const PROSE_UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const PROSE_SNAKE_RE = /\b[a-z]+_[a-z0-9_]+\b/; // core_question / next_arc_seed / face_slap / level_up
const PROSE_TERM_RE = /\b(windfall|fame|reveal|reunion|counterattack|sweet|plant|develop|arc|payoff)\b/;
const PROSE_EM_DASH = "——";
function firstMachineToken(text) {
    for (const re of [PROSE_ID_RE, PROSE_UUID_RE, PROSE_SNAKE_RE, PROSE_TERM_RE]) {
        const m = re.exec(text);
        if (m)
            return m[0];
    }
    return null;
}
/**
 * 大纲散文洁净门：positioning / beats / must_deliver 是给作者读的人话，命中机器 token
 * （编号 / snake_case / 英文枚举）或破折号 —— 即 ERROR 打回自修正。机器语义已在结构化字段
 * （payoff_beat / foreshadowing_touch / storyline_focus），散文里再写既冗余又让作者读不懂。
 */
export function checkChapterProseHygiene(chapters) {
    const errors = [];
    for (const ch of chapters) {
        const proseFields = [];
        if (typeof ch.positioning === "string")
            proseFields.push(["positioning", ch.positioning]);
        (ch.beats ?? []).forEach((b, i) => {
            if (typeof b === "string")
                proseFields.push([`beats[${i + 1}]`, b]);
        });
        (ch.must_deliver ?? []).forEach((m, i) => {
            if (typeof m === "string")
                proseFields.push([`must_deliver[${i + 1}]`, m]);
        });
        for (const [label, text] of proseFields) {
            if (text.includes(PROSE_EM_DASH)) {
                errors.push({
                    field: `第 ${ch.chapter} 章 ${label}`,
                    expected: "不使用破折号 ——",
                    actual: "含 ——",
                    hint: "用逗号或句号断句，不用 —— 表转折或解释",
                });
            }
            const token = firstMachineToken(text);
            if (token) {
                errors.push({
                    field: `第 ${ch.chapter} 章 ${label}`,
                    expected: "散文只用中文故事语言",
                    actual: `含机器 token「${token}」`,
                    hint: "positioning/beats/必须落地 是给作者读的人话，去掉字段名/英文枚举/编号，用中文描述剧情；爽点·伏笔·故事线的机器语义已在结构化字段里",
                });
            }
        }
    }
    return errors;
}
// ============================================================
// 章级计划状态变更语义校验（ajv 形状通过后调用；fail-loud 不静默丢弃）
// ============================================================
/**
 * state_changes 语义门：维度必须在本书状态词表内、enum 维度值必须落值域、
 * operation 与维度 cardinality 匹配（one 恒 set 可省略；many 缺省 add、显式 set 拒——
 * 与作者编辑入口 novel_submit_authored_state 同一套规则，两处语义保持镜像）、
 * 值按 attributeFact 归属规则必须落回计划维度（enum 值域优先、free 兜底——否则该计划
 * 在事实账上永远兑现不了，兑现门只会空报警）。
 * 词表缺失时携带非空 state_changes 一律拒绝（引导先建词表，不做无词表的裸计划）。
 */
export function checkStateChanges(chapters, vocab) {
    const errors = [];
    const withChanges = chapters.filter((ch) => (ch.state_changes ?? []).length > 0);
    if (withChanges.length === 0)
        return errors;
    if (!vocab) {
        errors.push({
            field: `第 ${withChanges[0].chapter} 章 state_changes`,
            expected: "本书存在状态词表（bible/state-vocabulary.json）",
            actual: "词表缺失",
            hint: "该书未建状态词表，去掉 state_changes 字段重新提交；状态词表由建书 world 流程产出",
        });
        return errors;
    }
    const byKey = new Map(vocab.dimensions.map((d) => [d.key, d]));
    for (const ch of withChanges) {
        for (const [index, sc] of (ch.state_changes ?? []).entries()) {
            const label = `第 ${ch.chapter} 章 state_changes[${index + 1}]`;
            const dim = byKey.get(sc.dimension);
            if (!dim) {
                errors.push({
                    field: label,
                    expected: `维度在词表内（${[...byKey.keys()].join(" / ")}）`,
                    actual: `未知维度 ${sc.dimension}`,
                    hint: "改用词表既有维度 key；确需新维度先扩词表再排计划",
                });
                continue;
            }
            if (dim.cardinality === "one" && sc.operation !== undefined && sc.operation !== "set") {
                errors.push({
                    field: label,
                    expected: `${sc.dimension} 是单值维度，operation 只能省略或 set`,
                    actual: sc.operation,
                    hint: "单值维度换值即覆盖，去掉 operation 或改为 set",
                });
            }
            if (dim.cardinality === "many" && sc.operation === "set") {
                errors.push({
                    field: label,
                    expected: `${sc.dimension} 是多值维度，operation 只能省略（=add）或 add/remove`,
                    actual: "set",
                    hint: "多值维度按项增减，改为 add 或 remove",
                });
            }
            if (dim.value_type === "enum" && !(dim.values ?? []).includes(sc.value)) {
                errors.push({
                    field: label,
                    expected: `值在维度 ${sc.dimension} 的值域内（${(dim.values ?? []).join(" / ")}）`,
                    actual: sc.value,
                    hint: "纠正为值域内的值；确需新档位先扩词表再排计划",
                });
                continue;
            }
            // 归属一致性：值经归属规则须落回计划维度（同谓词下 enum 值域优先认领、free 声明序兜底）。
            // 典型误排：free 维度排了 enum 值域内的值——事实入库后会归 enum 维度，本计划永远不兑现。
            const attributed = attributeFact(vocab, dim.predicate, sc.value);
            if (attributed?.key !== sc.dimension) {
                errors.push({
                    field: label,
                    expected: `值「${sc.value}」按归属规则落在维度 ${sc.dimension}`,
                    actual: attributed ? `会归属维度 ${attributed.key}` : "无法归入任何维度",
                    hint: attributed
                        ? `把这条计划改排到维度 ${attributed.key}，或换一个属于 ${sc.dimension} 的值`
                        : "换一个能归入该维度的值，或调整词表",
                });
            }
        }
    }
    return errors;
}
// ============================================================
// 正文散文洁净门（去 AI 味）：机械 blacklist 扫描，抬下限不杀绝
// ============================================================
//
// 读者真正读的是正文散文，而正文全程不经 MCP，历来无任何机械门。诊断实测我们成稿的
// 「破折号 —— 后接转折解释」与「不是X，是Y 式对仗转折」密度是番茄头部真书的 3-5 倍，是
// 最刺眼的 AI 马脚。本扫描器是纯函数，只扫这两类确定的机械对仗腔（可机械检测的 blacklist
// 模式，CLAUDE.md 核心纪律「可机械检测子集下沉为代码扫描」的合法范畴），不判文笔好坏。
//
// 判据用「密度」而非「零容忍」：破折号连接人名、范围、拟声，以及「不是A，是B」的正常否定
// 陈述在中文里都是合法用法，零容忍会误伤正常散文、把写手逼进更差的机械改写。以真书密度为
// 地板、留足余量设阈，只杀「明显超标」。
/** 破折号密度阈值（每千汉字）：真书基线约 1.2，放宽到 2.0 只杀明显超标 */
const MANUSCRIPT_EM_DASH_PER_KILO = 2.0;
/** 「不是X是Y」对仗转折密度阈值（每千汉字）：真书基线约 0.3，放宽到 1.0 */
const MANUSCRIPT_ANTITHESIS_PER_KILO = 1.0;
/** 密度判定的最小汉字样本：短文本密度噪声大，不足此量只按「同段连排」硬禁、不按密度判 */
const MANUSCRIPT_MIN_HANZI_FOR_DENSITY = 500;
const MANUSCRIPT_HANZI_RE = /[一-鿿]/g;
const MANUSCRIPT_EM_DASH_RE = /——/g;
/**
 * 「不是X是Y」对仗转折：`不是` + 句内 ≤18 字的 X + 连接（，|——|—|而） + `是`。
 * 覆盖字面「不是…而是…」与换标点的变体（不是X，是Y / 不是X——是Y）。X 用 `[^。！？\n；]`
 * 界住不跨句，避免把「他不是本地人。他是外地人」这种跨句陈述误当对仗。X 用非贪婪
 * 量词，否则一次匹配会把同段紧邻的第二个「不是…是…」一并吞掉、连排数被低估。
 */
const MANUSCRIPT_ANTITHESIS_RE = /不是[^。！？\n；]{1,18}?(?:，|,|——|—|而)是/g;
function countMatches(text, re) {
    return (text.match(re) ?? []).length;
}
/**
 * 正文散文洁净门纯扫描：返回命中项（errors[]+hint，与账房层自修正回路同构）与密度统计。
 * errors 为空 = 通过。密度超阈或对仗同段连排即命中。只度量确定的机械马脚，不碰主观质量。
 */
export function scanManuscriptProseHygiene(text) {
    const hanzi = countMatches(text, MANUSCRIPT_HANZI_RE);
    const kilo = hanzi / 1000;
    const emDashCount = countMatches(text, MANUSCRIPT_EM_DASH_RE);
    const antithesisSamples = text.match(MANUSCRIPT_ANTITHESIS_RE) ?? [];
    const antithesisCount = antithesisSamples.length;
    const emDashPerKilo = kilo > 0 ? emDashCount / kilo : 0;
    const antithesisPerKilo = kilo > 0 ? antithesisCount / kilo : 0;
    // 同段连排：按空行/换行切段，任一段 ≥2 处对仗最刺眼，与整章密度无关，单独硬禁
    let maxAntithesisInParagraph = 0;
    for (const para of text.split(/\n+/)) {
        const c = countMatches(para, MANUSCRIPT_ANTITHESIS_RE);
        if (c > maxAntithesisInParagraph)
            maxAntithesisInParagraph = c;
    }
    const enoughForDensity = hanzi >= MANUSCRIPT_MIN_HANZI_FOR_DENSITY;
    const errors = [];
    if (enoughForDensity && emDashPerKilo > MANUSCRIPT_EM_DASH_PER_KILO) {
        errors.push({
            field: "破折号密度",
            expected: `每千字不超过 ${MANUSCRIPT_EM_DASH_PER_KILO} 处 ——`,
            actual: `全章 ${emDashCount} 处 ——，约 ${emDashPerKilo.toFixed(1)}/千字`,
            hint: "破折号后接转折或补充解释是 AI 腔，改用逗号、句号自然断句；只保留人名连接、数值范围、拟声等中文里破折号真正必要的少数用法",
        });
    }
    if ((enoughForDensity && antithesisPerKilo > MANUSCRIPT_ANTITHESIS_PER_KILO) ||
        maxAntithesisInParagraph >= 2) {
        const sample = antithesisSamples.slice(0, 3).join(" / ");
        errors.push({
            field: "「不是…是…」对仗转折",
            expected: maxAntithesisInParagraph >= 2
                ? "同一段落不连排「不是…是…」式对仗转折"
                : `每千字不超过 ${MANUSCRIPT_ANTITHESIS_PER_KILO} 处`,
            actual: `全章 ${antithesisCount} 处${maxAntithesisInParagraph >= 2 ? `（有一段连排 ${maxAntithesisInParagraph} 处）` : `，约 ${antithesisPerKilo.toFixed(1)}/千字`}${sample ? `（例：${sample}）` : ""}`,
            hint: "「不是A，是B」「不是A而是B」这类对仗转折堆多了就是 AI 腔，想强调什么直接说出来，或用逗号、句号自然断句",
        });
    }
    return {
        errors,
        stats: {
            hanzi,
            emDashCount,
            emDashPerKilo,
            antithesisCount,
            antithesisPerKilo,
            maxAntithesisInParagraph,
        },
    };
}
/** 单批章纲覆盖的 arc 数上限 */
export const CHAPTER_BATCH_MAX_ARCS = 4;
export function checkChapterBatch(chapters, refs) {
    const errors = [];
    const warnings = [];
    const arcsCovered = new Set();
    const seenChapters = new Set();
    for (const ch of chapters) {
        if (seenChapters.has(ch.chapter)) {
            errors.push({
                field: `chapter ${ch.chapter}`,
                expected: "章号在批内唯一",
                actual: `第 ${ch.chapter} 章重复`,
                hint: `第 ${ch.chapter} 章在本批出现多次，删去重复项`,
            });
        }
        seenChapters.add(ch.chapter);
        const arc = refs.chapterArcIndex.get(ch.chapter);
        if (!arc) {
            errors.push({
                field: `chapter ${ch.chapter}`,
                expected: "章号落在已提交的 arc 区间内",
                actual: `第 ${ch.chapter} 章无所属 arc`,
                hint: `第 ${ch.chapter} 章不在任何 arc 的章节区间内：先用 novel_submit_outline 提交覆盖该章的书级大纲`,
            });
        }
        else {
            arcsCovered.add(arc.arcId);
        }
        for (const slId of ch.storyline_focus) {
            if (!refs.storylineIds.has(slId)) {
                errors.push({
                    field: `chapter ${ch.chapter}.storyline_focus`,
                    expected: "引用已注册的故事线 id",
                    actual: slId,
                    hint: `故事线 ${slId} 未注册。可用 id：${[...refs.storylineIds].join(", ") || "(空)"}`,
                });
            }
        }
        for (const ft of ch.foreshadowing_touch ?? []) {
            if (!refs.foreshadowingIds.has(ft.id)) {
                errors.push({
                    field: `chapter ${ch.chapter}.foreshadowing_touch`,
                    expected: "引用已注册的伏笔 id",
                    actual: ft.id,
                    hint: `伏笔 ${ft.id} 未注册：改用已注册 id，或先用 novel_register_foreshadowing 补登`,
                });
            }
        }
    }
    if (arcsCovered.size > CHAPTER_BATCH_MAX_ARCS) {
        errors.push({
            field: "payload",
            expected: `单批覆盖 ≤ ${CHAPTER_BATCH_MAX_ARCS} 个 arc`,
            actual: `${arcsCovered.size} 个 arc`,
            hint: `本批章纲跨 ${arcsCovered.size} 个 arc，拆成多次提交（每批不超过 ${CHAPTER_BATCH_MAX_ARCS} 个 arc 的章）`,
        });
    }
    return { errors, warnings, arcsCovered: [...arcsCovered] };
}
/**
 * 爽点强度配对完整性门控（确定性、纯代码，非 LLM；只 WARN 不 ERROR）：
 * 本批内每一章若填了 payoff_beat 却没填 payoff_intensity，提醒补全——纯结构完整性检查
 * （字段存在与否），不判断强度选得对不对。
 *
 * 反向半边（只有 payoff_intensity 没有 payoff_beat）不在本函数：那是语义矛盾的机械事实
 * （强度依附于爽点存在），由 outline-structure.json 章级对象的 dependentRequired 在 ajv
 * 提交入口直接 ERROR 拒绝，走 errors[]+hint 自修正回路，不让脏数据流到渲染层被静默吞掉。
 *
 * 刻意不做的事：不检查同 arc 内强度是否「递增」或「倒序」——payoff-cadence 包本身鼓励
 * 「为 large 蓄势的长线里穿插 small 兑现维持在场感」，那正是大爆点后接一个更弱释放的
 * 正常写法；机械倒序检查会把这种编排误判为退化，属于误伤，故不做。
 */
export function checkPayoffIntensityConsistency(chapters) {
    const warnings = [];
    const missing = chapters
        .filter((c) => c.payoff_beat != null && c.payoff_intensity == null)
        .map((c) => c.chapter)
        .sort((a, b) => a - b);
    if (missing.length > 0) {
        warnings.push(`第 ${missing.join("、")} 章有 payoff_beat 但未标 payoff_intensity——补一个强度档位（small/medium/large），让 payoff-cadence 包的强度金字塔知识有字段可落`);
    }
    return { warnings };
}
/**
 * 开局留存门控（确定性、纯代码，非 LLM）：入参是「完整开局 arc 的已规划章」（已落盘
 * ch JSON ∪ 本批 payload，由 handler 合并组装，兼容 /plan 窗口化分批提交——开局 arc 可能
 * 被切到多批，见 outline-planning §3），看开局爽点前置——黄金三章 payoff_beat 全空即 BAN，
 * 开局段内长死区告警。下限被硬抬，爽点是否「真」由 outline-architect prompt
 * + novel-structure「黄金三章」决定。
 *
 *   D-open-1  ERROR  黄金三章（第 1..golden_chapters 章）齐全且 payoff_beat 数 < min_opening_payoff_beats
 *                    （未齐全=尚未规划完，defer 不判，避免窗口化下误判）
 *   D-open-2  WARN   开局段按章号排序 > max_opening_payoff_gap_warn 连续章 payoff_beat 为空
 *
 * 不含第 1 章（非开局集）→ no-op，返回空 errors/warnings。
 */
export function checkOpeningRetention(chapters) {
    const errors = [];
    const warnings = [];
    const T = OPENING_RETENTION_THRESHOLDS;
    const sorted = [...chapters].sort((a, b) => a.chapter - b.chapter);
    const present = new Set(sorted.map((c) => c.chapter));
    if (!present.has(1))
        return { errors, warnings }; // 非开局集（不含第 1 章）→ no-op
    // ---- D-open-1 黄金三章零爽点（仅当黄金三章齐全才判：窗口化提交下未齐=尚未规划完，defer 不误判）----
    const goldenNums = Array.from({ length: T.golden_chapters }, (_, i) => i + 1);
    const goldenComplete = goldenNums.every((n) => present.has(n));
    if (goldenComplete) {
        const openingBeats = sorted.filter((c) => c.chapter <= T.golden_chapters && c.payoff_beat != null).length;
        if (openingBeats < T.min_opening_payoff_beats) {
            errors.push({
                field: "开局 payoff_beat",
                expected: `黄金三章（前 ${T.golden_chapters} 章）至少 ${T.min_opening_payoff_beats} 个 payoff_beat`,
                actual: "黄金三章 payoff_beat 全空",
                hint: "开局 arc 别走标准蓄压→释放：黄金三章要前置至少一个 payoff_beat、让金手指/核心卖点亮一次相，别把开局 arc 的爽点全推到释放期",
            });
        }
    }
    // ---- D-open-2 开局批内长死区 ----
    let gap = 0;
    let gapStart = 0;
    let maxGap = 0;
    let worstStart = 0;
    let worstEnd = 0;
    for (const c of sorted) {
        if (c.payoff_beat == null) {
            if (gap === 0)
                gapStart = c.chapter;
            gap += 1;
            if (gap > maxGap) {
                maxGap = gap;
                worstStart = gapStart;
                worstEnd = c.chapter;
            }
        }
        else {
            gap = 0;
        }
    }
    if (maxGap > T.max_opening_payoff_gap_warn) {
        warnings.push(`开局段第 ${worstStart}-${worstEnd} 章连续 ${maxGap} 章无 payoff_beat（超 ${T.max_opening_payoff_gap_warn} 章死区）——开局是读者最易流失段，按本书反馈回路补几处小爽，别留长空窗`);
    }
    return { errors, warnings };
}
/**
 * 章末钩节奏门阈值（可调）：只警成片无钩死区，不规定钩子类型。仿 OPENING_RETENTION_THRESHOLDS。
 */
export const HOOK_CADENCE_THRESHOLDS = {
    // 连续显式 none 达此章数 → W2 WARN（C1 实测 30.1% 章无钩为真人常态，随机 3 连概率 ~2.7%）
    consecutive_none_warn: 3,
    // handler 合并窗口向批章号两侧外延章数（= consecutive_none_warn - 1，保证跨批边界连续段可见）
    window_pad: 2,
};
/**
 * 章末钩节奏门（确定性、纯代码，非 LLM；只出 WARN 不 ERROR——钩子该不该有最终是剧作判断，
 * 门只抬「别成片裸奔」下限）。入参 merged = 合并窗口章集（本批 payload ∪ 已落盘 ch JSON，
 * 由 handler 组装，见 novelSubmitChapterOutline），兼容 /plan 窗口化分批提交。
 *
 * 三态语义（C3 spec §4 裁定，兼容存量无 end_hook 数据）：
 *   显式 "none"        → 延长连续无钩段
 *   字段缺失（存量章）  → unknown，截断连续段、不计数
 *   章不在 merged 里    → 未规划/文件缺失，同样截断（由章号断档表达）
 *
 *   W1  WARN  本批 payload 章缺 end_hook 字段 → 提醒补填（堵「不填字段绕过门」；不查存量章 → 存量书零误报）
 *   W2  WARN  窗口内按章号排序连续 ≥consecutive_none_warn 章显式 none → 成片死区
 */
export function checkHookCadence(merged, batchChapters) {
    const warnings = [];
    const T = HOOK_CADENCE_THRESHOLDS;
    const sorted = [...merged].sort((a, b) => a.chapter - b.chapter);
    // ---- W1 本批缺字段 ----
    const missing = sorted
        .filter((c) => batchChapters.has(c.chapter) && c.end_hook == null)
        .map((c) => c.chapter);
    if (missing.length > 0) {
        warnings.push(`本批第 ${missing.join("、")} 章未填 end_hook——每章显式声明章末钩类型（悬念/危机/情绪），确属刻意缓冲的章填 none，别留空`);
    }
    // ---- W2 连续显式 none（unknown / 章号断档截断）----
    let run = 0;
    let runStart = 0;
    let prev = Number.NaN;
    for (const c of sorted) {
        if (c.end_hook === "none") {
            const contiguous = c.chapter === prev + 1;
            if (run === 0 || !contiguous) {
                run = 1;
                runStart = c.chapter;
            }
            else {
                run += 1;
            }
            if (run >= T.consecutive_none_warn) {
                warnings.push(`第 ${runStart}-${c.chapter} 章连续 ${run} 章无章末钩——头部网文约七成章有钩，成片无钩是追读死区；给其中至少一章排一个钩（悬念/危机/情绪），或确认这段确是刻意缓冲`);
                run = 0; // 报一次后重置计数：长死区每满 3 章块提醒一次，不逐章刷屏
            }
        }
        else {
            run = 0;
        }
        prev = c.chapter;
    }
    return { warnings };
}
/**
 * 开局 arc 爽点底线（确定性、阶段一，书级提交时调用）：覆盖第 1 章的 arc（开局 arc）
 * 必须至少 min_opening_payoff_beats 个书级 payoff_beats——否则阶段二章级 D-open-1 会逼出
 * 一个无 arc 出处的章级爽点，与「章级 payoff_beat 从 arc payoff_beats 落下」契约冲突
 * （S 档 payoff_beats_min_per_arc=0 对开局 arc 不适用；其它 arc 仍可遵 S 档 0）。
 * 补卷/不含开局 arc（无 chapter_start===1）的提交 → no-op。
 */
export function checkOpeningArcPayoff(payload) {
    if (payload.volumes.length === 0)
        return { errors: [], warnings: [] };
    const errors = [];
    const openingArc = payload.volumes
        .flatMap((v) => v.arc_list)
        .find((a) => a.chapter_start === 1);
    if (openingArc &&
        openingArc.payoff_beats.length < OPENING_RETENTION_THRESHOLDS.min_opening_payoff_beats) {
        errors.push({
            field: `arc ${openingArc.arc_id}.payoff_beats`,
            expected: `开局 arc（覆盖第 1 章）至少 ${OPENING_RETENTION_THRESHOLDS.min_opening_payoff_beats} 个 payoff_beats`,
            actual: "开局 arc payoff_beats 为空",
            hint: "开局 arc 是读者上船的窗口，必须规划至少一个早爽点（face_slap/level_up/windfall…），让阶段二章纲能把它落到黄金三章；S 档其它 arc 仍可零爽点，但开局 arc 不行",
        });
    }
    return { errors, warnings: [] };
}
/**
 * 立项卡语义核验：同一 card 不得重复提交（ajv 数组无法表达唯一性）。
 * 卡内 field.key 允许重复（如 narrator_voice 的多条 reference_example）。
 */
export function checkPremiseSemantics(payload) {
    const errors = [];
    const seen = new Set();
    for (const card of payload.cards) {
        if (seen.has(card.card)) {
            errors.push({
                field: "cards",
                expected: "card 唯一",
                actual: `card ${card.card} 重复`,
                hint: `立项卡 ${card.card} 出现多次，合并为一张卡（同卡的多条内容放进同一 fields 数组）`,
            });
        }
        seen.add(card.card);
    }
    return errors;
}
/**
 * 叙述人称受控校验。两层要求分开处理，防止「值域受控」被任何写入路径架空：
 *  - 值域合法性【无条件】：只要提交的 narrator_voice 卡含 address，其 value 必须属受控值域
 *    NARRATOR_ADDRESS_VALUES（certainty='open' 有意留白除外）——定点修订（merge_cards）也不许
 *    写自由文本（如 "第三人称"）。修订正是改人称的预期路径，绝不能成为绕过受控值域的口子。
 *  - 存在性【仅 requirePresence】：narrator_voice 卡 + address 字段必须存在。全量立项
 *    （novel_submit_premise 的 merge_cards !== true）要求；定点修订只提交目标卡、payload 不带
 *    narrator_voice 属正常 → 豁免，不惩罚存量未填人称的小说（#297 方案 E）。
 */
export function checkNarratorAddress(payload, opts = {}) {
    const requirePresence = opts.requirePresence ?? true;
    const valueDomain = NARRATOR_ADDRESS_VALUES.join(" / ");
    const card = payload.cards.find((c) => c.card === "narrator_voice");
    if (!card) {
        return requirePresence
            ? [
                {
                    field: "narrator_voice",
                    expected: `全量立项含 narrator_voice 卡（叙述声音），且 address ∈ ${valueDomain}`,
                    actual: "缺 narrator_voice 卡",
                    hint: `立项必须提交叙述声音卡（narrator_voice），并含一条 key='address' 的 field：叙述人称四选一（${valueDomain}）`,
                },
            ]
            : []; // 修订只改其余卡 → 不带 narrator_voice 属正常
    }
    const address = card.fields.find((f) => f.key === "address");
    if (!address) {
        return requirePresence
            ? [
                {
                    field: "narrator_voice.address",
                    expected: `narrator_voice 卡含 address（叙述人称），value ∈ ${valueDomain}`,
                    actual: "缺 address 字段",
                    hint: `叙述声音卡必须含一条 key='address' 的 field：叙述人称四选一（${valueDomain}），写入 fields；作者明确未定时可标 certainty=open 留白`,
                },
            ]
            : []; // 修订提交的 narrator_voice 卡未带 address → 不在修订职责内
    }
    if (address.certainty === "open")
        return []; // 有意留白
    const value = (address.value ?? "").trim();
    if (!isNarratorAddress(value)) {
        return [
            {
                field: "narrator_voice.address",
                expected: `value ∈ ${valueDomain}`,
                actual: value || "(空)",
                hint: `address 的 value 必须是受控枚举之一（${valueDomain}）；存英文枚举值，中文展示由渲染层负责`,
            },
        ];
    }
    return [];
}
/**
 * 校验 DialogueSamples（台词语料提交参数）。
 * 对应 novel_submit_dialogue_samples 工具入口；schema 在 schemas/dialogue-samples.json。
 */
export function validateDialogueSamples(value) {
    return runAjv(dialogueSamplesValidator, value, "dialogue-samples.json");
}
/**
 * 状态词表机械语义校验：ajv 只管结构合法，撞名/歧义类问题结构上都合法，须在此层拦。
 *  1. dimensions[].key 唯一——key 是折叠（foldCharacterCard）建卡槽的稳定标识，撞名会让
 *     两个维度共享同一张卡槽、后者悄悄覆盖前者；
 *  2. display_name 唯一——人读卡（renderCardHumanMap）按 display_name 渲染，撞名会互相覆盖，
 *     作者/写手分不清取的是哪个维度的值；
 *  3. 同 predicate 至多一个 value_type=free 维度——free 维度按声明顺序兜底认领同谓词 fact
 *     （attributeFact），两个 free 维度撞谓词时永远认领第一个，第二个变成收不到 fact 的死维度；
 *  4. 同 predicate 的多个 enum 维度值域两两不相交——enum 维度按「object ∈ values」认领 fact，
 *     值域重叠时同一个 fact 该落哪个维度取决于声明顺序，形成隐性歧义。
 * 任一违反返回非空错误数组，调用方据此拒绝落盘、不返回部分写（PR#452评审P2-C）。
 */
export function checkStateVocabularySemantics(payload) {
    const errors = [];
    const dims = payload.dimensions ?? [];
    const seenKeys = new Set();
    for (const dim of dims) {
        if (seenKeys.has(dim.key)) {
            errors.push({
                field: "dimensions[].key",
                expected: "key 唯一",
                actual: `key "${dim.key}" 重复`,
                hint: `维度 key "${dim.key}" 被多个维度共用：key 是折叠/编辑的稳定标识，撞名会让两个维度共享同一张卡槽，给其中一个改用不同的 key`,
            });
        }
        seenKeys.add(dim.key);
    }
    const seenNames = new Set();
    for (const dim of dims) {
        if (seenNames.has(dim.display_name)) {
            errors.push({
                field: "dimensions[].display_name",
                expected: "display_name 唯一",
                actual: `display_name "${dim.display_name}" 重复`,
                hint: `显示名「${dim.display_name}」被多个维度共用：人读卡按显示名渲染会互相覆盖，给其中一个改用不同的 display_name`,
            });
        }
        seenNames.add(dim.display_name);
    }
    const byPredicate = new Map();
    for (const dim of dims) {
        const group = byPredicate.get(dim.predicate) ?? [];
        group.push(dim);
        byPredicate.set(dim.predicate, group);
    }
    for (const [predicate, group] of byPredicate) {
        const freeDims = group.filter((d) => d.value_type === "free");
        if (freeDims.length > 1) {
            const keys = freeDims.map((d) => d.key).join(" 与 ");
            errors.push({
                field: "dimensions[].value_type",
                expected: `谓词 "${predicate}" 下至多一个 value_type=free 维度`,
                actual: `${keys} 均为 free 且共用谓词 "${predicate}"`,
                hint: `free 维度按声明顺序兜底认领同谓词 fact，谓词 "${predicate}" 下 ${keys} 撞车会让后者永远收不到 fact；给其中一个换用不同谓词，或合并为一个维度`,
            });
        }
        const enumDims = group.filter((d) => d.value_type === "enum" && Array.isArray(d.values));
        for (let i = 0; i < enumDims.length; i++) {
            for (let j = i + 1; j < enumDims.length; j++) {
                const a = enumDims[i];
                const b = enumDims[j];
                const overlap = (a.values ?? []).filter((v) => (b.values ?? []).includes(v));
                if (overlap.length > 0) {
                    errors.push({
                        field: "dimensions[].values",
                        expected: `谓词 "${predicate}" 下的 enum 维度值域两两不相交`,
                        actual: `维度 "${a.key}" 与 "${b.key}" 值域相交：${overlap.join("、")}`,
                        hint: `维度 "${a.key}" 与 "${b.key}" 同谓词 "${predicate}"，值域出现重叠值 ${overlap.join("、")}：fact 落哪个维度会产生歧义，改窄两者的 values 使其不相交`,
                    });
                }
            }
        }
    }
    return errors;
}
// ============================================================
// checkChapterWordCount — 成稿字数守卫（评价层 finding-only）
//
// 字数是网文商业基线（平台按字数计费 / 读者按字数感知更新诚意），但字数缺口
// 只度量、不阻断：低于告警线返回缺口数据，由调用方以 note / warning 形态上报，
// verdict 与提交流程不受影响。字数口径 = countWords 纯文字数（与目标同口径）。
// ============================================================
/** 成稿字数告警线：实际字数低于目标的该比例即告警 */
export const WORD_COUNT_WARN_RATIO = 0.7;
/** 无目标（缺失 / null / 非正数）或达线返回 null；低于告警线返回缺口数据 */
export function checkChapterWordCount(actual, target) {
    if (!target || target <= 0)
        return null;
    const ratio = actual / target;
    if (ratio >= WORD_COUNT_WARN_RATIO)
        return null;
    return { actual, target, ratio };
}
