/**
 * 生成后时序 / 状态冲突检测（DOME 思路的机械版）
 *
 * 一章写完后，把记忆里的有效 facts 互相比对，机械检出潜在矛盾，供人工修订。
 * 遵循弱模型纪律「代码能算的绝不让 LLM」与审校「只标不改」：纯规则检测、机械渲染
 * 报告、只读不写、不回流污染主链。
 *
 * 真机校准（novel-36156 验证）：机械版无法靠「同一谓词存在多个未失效值」判矛盾——
 * 小说里 location/status/injury/goal 等谓词本就随剧情累积演变（角色会移动、状态会变），
 * 且按章多采样并集（ADR-0022）会留同章近重复措辞。故收窄为：
 *   ① 设定漂移 / 关系矛盾：只在「同一章（event 轴）内」出现「**互斥**（非近重复）的 ≥2 值」才报
 *      ——跨章演变豁免、同章近重复归并；且只对同一时刻应唯一的谓词（identity / location）。
 *   ② 死而复生：status 含终结词（死亡 / 陨落…）后，同一实体更晚章仍有新事实——时序强信号。
 * 真矛盾的语义判定（如身份反转、关系反目）超出机械能力，交 /review 深审与人读。
 */
/** 分组 key 的分隔符：用 NUL 转义避免实体名 / 谓词里出现而碰撞 */
const KEY_SEP = "\u0000";
/**
 * 同一时刻应唯一的谓词：同一角色在同一章里不该有两个互斥的身份 / 所在地。
 * 刻意不含 status/injury/goal/possession/ability 等——它们可多侧面 / 随章累积演变，
 * 「多值」是常态而非矛盾（折叠按 event 轴取最新即可）。
 */
const SINGLE_VALUE_PREDICATES = new Set(["identity", "location"]);
/** 终结状态词：status.object 含其一即视为角色终结 */
const TERMINAL_STATUS_WORDS = [
    "死亡",
    "已死",
    "身死",
    "战死",
    "陨落",
    "殒命",
    "丧命",
    "身亡",
    "去世",
    "毙命",
];
/** 实体归并 key：优先 canonical uid，回退 subject 文本 */
function entityKey(f) {
    return f.subject_character_uid ?? f.subject;
}
/** event 轴章号（默认 = ingestion）；用于「同一时刻」分组 */
function chapterOf(f) {
    return f.event_chapter ?? f.from_chapter;
}
function pushTo(m, k, f) {
    const arr = m.get(k);
    if (arr)
        arr.push(f);
    else
        m.set(k, [f]);
}
/** 字符 bigram 集合（去标点空白） */
function bigrams(s) {
    const t = s.replace(/[\s，。、,.；;：:！!？?「」『』（）()]/g, "");
    const set = new Set();
    if (t.length <= 1) {
        if (t)
            set.add(t);
        return set;
    }
    for (let i = 0; i < t.length - 1; i++)
        set.add(t.slice(i, i + 2));
    return set;
}
/** 近重复：bigram Jaccard ≥ 0.5（多采样并集的同章措辞变体归并掉） */
function nearDuplicate(a, b) {
    if (a === b)
        return true;
    const A = bigrams(a);
    const B = bigrams(b);
    if (A.size === 0 || B.size === 0)
        return a === b;
    let inter = 0;
    for (const x of A)
        if (B.has(x))
            inter += 1;
    return inter / (A.size + B.size - inter) >= 0.5;
}
/** 同章内「互斥」对象数：近重复归并后剩几个代表 */
function distinctValues(objects) {
    const reps = [];
    for (const o of objects) {
        if (!reps.some((r) => nearDuplicate(r, o)))
            reps.push(o);
    }
    return reps;
}
/** 在「同实体/同对」的分组上，按章找「同章 ≥2 互斥值」的冲突 */
function chapterClashes(groups, type, detail, predicateOf) {
    const out = [];
    for (const group of groups.values()) {
        const byChapter = new Map();
        for (const f of group)
            pushTo(byChapter, chapterOf(f), f);
        for (const [chapter, chFacts] of byChapter) {
            const reps = distinctValues(chFacts.map((f) => f.object));
            if (reps.length < 2)
                continue;
            out.push({
                type,
                subject: chFacts[0].subject,
                ...(predicateOf(chFacts[0]) ? { predicate: predicateOf(chFacts[0]) } : {}),
                chapter,
                detail: detail(chFacts[0].subject, predicateOf(chFacts[0]), chapter, reps.length),
                facts: chFacts.map((f) => ({
                    id: f.id,
                    object: f.object,
                    chapter: chapterOf(f),
                    from_chapter: f.from_chapter,
                })),
            });
        }
    }
    return out;
}
/**
 * 检出有效 facts 间的潜在冲突。
 * @param opts.chapter 给定则只保留发生在该章的冲突
 */
export function detectConflicts(facts, opts = {}) {
    const conflicts = [];
    // ① 设定漂移：单值谓词，同实体 + 同章 出现 ≥2 互斥值（跨章演变豁免、同章近重复归并）
    const byEntityPred = new Map();
    for (const f of facts) {
        if (f.predicate === "relationship" || !SINGLE_VALUE_PREDICATES.has(f.predicate))
            continue;
        pushTo(byEntityPred, `${entityKey(f)}${KEY_SEP}${f.predicate}`, f);
    }
    conflicts.push(...chapterClashes(byEntityPred, "state_divergence", (subject, predicate, chapter, n) => `「${subject}」第${chapter}章的 ${predicate} 同章出现 ${n} 个互斥值，疑似设定漂移`, (f) => f.predicate));
    // ② 死而复生：status 含终结词后，同实体更晚章仍有新 fact
    const byEntity = new Map();
    for (const f of facts)
        pushTo(byEntity, entityKey(f), f);
    for (const group of byEntity.values()) {
        const terminal = group.find((f) => f.predicate === "status" && TERMINAL_STATUS_WORDS.some((w) => f.object.includes(w)));
        if (!terminal)
            continue;
        const termCh = chapterOf(terminal);
        const after = group.filter((f) => chapterOf(f) > termCh && f.id !== terminal.id);
        if (after.length === 0)
            continue;
        conflicts.push({
            type: "revival",
            subject: terminal.subject,
            chapter: termCh,
            detail: `「${terminal.subject}」第${termCh}章已记为终结状态（${terminal.object}），其后仍有 ${after.length} 条新事实，请确认是否死而复生 / 时间线矛盾`,
            facts: [terminal, ...after].map((f) => ({
                id: f.id,
                object: f.object,
                chapter: chapterOf(f),
                from_chapter: f.from_chapter,
            })),
        });
    }
    // ③ 关系矛盾：同对角色 + 同章 出现 ≥2 互斥关系值
    const byPair = new Map();
    for (const f of facts) {
        if (f.predicate !== "relationship")
            continue;
        const a = f.subject_character_uid ?? f.subject;
        const b = f.subject_character_b_uid ?? "";
        pushTo(byPair, `${a}${KEY_SEP}${b}`, f);
    }
    conflicts.push(...chapterClashes(byPair, "relationship_divergence", (subject, _predicate, chapter, n) => `「${subject}」第${chapter}章同章出现 ${n} 个互斥关系值，疑似关系状态未收敛`, () => undefined));
    // 聚焦：保留「涉及该写入章（ingestion）」的冲突——/write 第 N 章落库后查刚写入的新 facts
    // 引入的冲突。revival 的 chapter 是死亡章（termCh），但触发它现身的新 fact 的 from_chapter
    // 才是当前写入章，故按 facts 的 ingestion 章判定，避免最强信号被写入章过滤掉。
    return opts.chapter != null
        ? conflicts.filter((c) => c.facts.some((f) => f.from_chapter === opts.chapter))
        : conflicts;
}
const TYPE_LABEL = {
    state_divergence: "设定漂移",
    revival: "死而复生 / 时间线",
    relationship_divergence: "关系矛盾",
};
/** 机械渲染可读冲突报告 */
export function renderConflictReport(conflicts) {
    if (conflicts.length === 0)
        return "未检出时序 / 状态冲突。";
    const lines = [`检出 ${conflicts.length} 处潜在冲突（仅标注，需人工确认 / 修订）：`, ""];
    conflicts.forEach((c, i) => {
        lines.push(`${i + 1}. [${TYPE_LABEL[c.type]}] ${c.detail}`);
        for (const f of c.facts)
            lines.push(`   - 第${f.chapter}章：${f.object}`);
    });
    return lines.join("\n");
}
export async function novelDetectConflicts(args, ctx) {
    const rawChapter = args["chapter"];
    const chapter = typeof rawChapter === "number" && Number.isInteger(rawChapter) && rawChapter >= 1
        ? rawChapter
        : undefined;
    const facts = ctx.db
        .prepare(`SELECT id, subject, subject_character_uid, subject_character_b_uid, predicate, object, from_chapter, event_chapter
       FROM facts
       WHERE novel_id = ? AND invalidated_at_chapter IS NULL`)
        .all(ctx.novelId);
    const conflicts = detectConflicts(facts, chapter != null ? { chapter } : {});
    return {
        ok: true,
        ...(chapter != null ? { chapter } : {}),
        conflict_count: conflicts.length,
        conflicts,
        report: renderConflictReport(conflicts),
    };
}
