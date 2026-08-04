// ============================================================
// Persona 卡加载与机械选卡
//
// 卡是能力层数据（skills/novel-web-craft/references/personas/），
// builder 按叙述声音关键词确定性选卡，命中卡正文作为 persona 字段
// 随 WritingContextPack 投递；无命中返回 null（包内省略 persona，
// 写手回退 style_directive，行为与无卡时代一致）。零 LLM 判断。
// ============================================================
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/** 候选来源裁决优先级（ADR-0034 v1.1）：user 覆盖官方，官方覆盖社区。 */
const ORIGIN_RANK = { user: 0, official: 1, community: 2 };
/**
 * 解析 persona 卡目录路径（相对于编译后的 dist/）
 * dist/ → ../../skills/novel-web-craft/references/personas/
 */
function resolvePersonasDir() {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(__dirname, "../../skills/novel-web-craft/references/personas");
}
let personaIndex = null;
function loadPersonaIndex() {
    if (personaIndex !== null)
        return personaIndex;
    const dir = resolvePersonasDir();
    const indexPath = path.join(dir, "index.json");
    if (!existsSync(indexPath)) {
        console.error(`[NovelMemory] Persona index not found at: ${indexPath}`);
        personaIndex = [];
        return personaIndex;
    }
    try {
        const data = JSON.parse(readFileSync(indexPath, "utf-8"));
        personaIndex = (data.personas ?? []).filter((p) => p.id && p.file && Array.isArray(p.keywords));
    }
    catch (err) {
        console.error(`[NovelMemory] Failed to load persona index:`, err);
        personaIndex = [];
    }
    return personaIndex;
}
/** 单测用：清空模块级缓存 */
export function resetPersonaCache() {
    personaIndex = null;
}
/**
 * pool 省略时的默认候选池：从既有 persona index.json 构造，origin 一律标 official。
 * 这是向后兼容的等价路径——equivalence 由 origin 单一（tie-break 恒为 no-op）保证。
 */
export function defaultPersonaPool() {
    return loadPersonaIndex().map((e) => ({
        id: e.id,
        name: e.name,
        path: path.join(resolvePersonasDir(), e.file),
        keywords: e.keywords,
        origin: "official",
        source_pack_id: "novel-web-craft",
        source_pack_version: "legacy",
    }));
}
// 章级情绪调制门（GATE-1 book2 败因修正）：诙谐卡在悲怆/紧张主导章会放大声音与
// 章型的错配（用户批注「吐槽侵入严肃场景」）。词表口径对齐 corpus-loader.ts 的
// EMOTION_CUES 8 类实际标签，不发明新标签——「悲伤」「紧张」是与「悲怆/沉重/肃杀」
// 语义最贴近的既有标签。只治此一卡：cold-blade / skin-close 无实证不动，命中门槛的
// 唯一后果是回退 style_directive（省略 persona），不跨卡改投——跨卡映射无实证。
const WITTY_GATE_EMOTIONS = new Set(["悲伤", "紧张"]);
/**
 * 按叙述声音关键词机械选卡。
 * 计分：关键词命中 archetype（叙述声音原型）记 2 分，命中其余自由文本维度记 1 分；
 * 取最高分；零分或并列首名歧义时不选（宁缺勿错——省略 persona 是安全回退）。
 *
 * @param chapterEmotions 本章目标情绪（`detectChapterEmotions` 结果，按命中强度降序，
 *   首位即主导情绪）——builder 已算过一次，此处直接复用，不重复探测。
 * @param buildNotes 可选：命中调制门时向此数组记一条可解释说明（builder 的系统诊断通道）。
 */
export function selectPersona(voice, chapterEmotions = [], buildNotes, pool) {
    if (!voice)
        return null;
    const archetype = voice.get("archetype") ?? "";
    const freeText = [
        voice.get("tone"),
        voice.get("pacing"),
        voice.get("ornamentation"),
        voice.get("digression"),
        voice.get("style_keywords"),
    ]
        .filter(Boolean)
        .join(" ");
    if (!archetype && !freeText)
        return null;
    const entries = pool ?? defaultPersonaPool();
    let bestScore = 0;
    let top = [];
    const userHits = [];
    let userBestScore = 0;
    let userTop = [];
    for (const entry of entries) {
        let score = 0;
        for (const kw of entry.keywords) {
            if (archetype.includes(kw))
                score += 2;
            if (freeText.includes(kw))
                score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            top = [entry];
        }
        else if (score === bestScore && score > 0) {
            top.push(entry);
        }
        if (score > 0 && entry.origin === "user") {
            userHits.push(entry);
            if (score > userBestScore) {
                userBestScore = score;
                userTop = [entry];
            }
            else if (score === userBestScore) {
                userTop.push(entry);
            }
        }
    }
    // 用户卡命中即绝对优先（产品拍板：手写一等公民，等于无穷大权重而非加固定分）：
    // 只要存在任一命中的 user 卡，只在 user 子集里按 bestScore 竞争，official/community
    // 完全不参与——哪怕它们分数更高也出局。无 user 命中卡时回落下方全池逻辑（等价性保证）。
    let winners;
    if (userHits.length > 0) {
        winners = userTop.length === 1 ? userTop : [];
    }
    else {
        if (top.length === 0 || bestScore === 0)
            return null;
        // 同分并列裁决（ADR-0034 v1.1）：先按 originRank 过滤，唯一则取之，仍并列则宁缺勿错。
        winners = top;
        if (winners.length > 1) {
            const bestRank = Math.min(...winners.map((w) => ORIGIN_RANK[w.origin] ?? 9));
            winners = winners.filter((w) => (ORIGIN_RANK[w.origin] ?? 9) === bestRank);
        }
    }
    if (winners.length !== 1)
        return null;
    const best = winners[0];
    if (best.id === "storyteller-witty") {
        const dominant = chapterEmotions[0];
        if (dominant && WITTY_GATE_EMOTIONS.has(dominant)) {
            buildNotes?.push(`persona 调制：诙谐卡因本章情绪(${dominant})回退`);
            return null;
        }
    }
    // 造包中心草稿卡预览：候选注入时 path 故意留空（尚无落盘正文），容错为空 body 而非
    // 当作「文件缺失」拒选——草稿卡只验选卡命中逻辑，不要求已有正文。
    if (!best.path)
        return { id: best.id, name: best.name, body: "" };
    if (!existsSync(best.path)) {
        console.error(`[NovelMemory] Persona card file missing: ${best.path}`);
        return null;
    }
    const body = readFileSync(best.path, "utf-8").trim();
    if (!body)
        return null;
    return { id: best.id, name: best.name, body };
}
