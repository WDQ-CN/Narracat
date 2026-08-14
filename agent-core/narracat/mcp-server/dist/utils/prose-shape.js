// ============================================================
// 正文形状扫描器（finding-only，与洁净词库并列的第二条线）
// ============================================================
//
// 词库线查的是「用了哪个 AI 味词」，本扫描器查的是「句子和段落被排成了什么形状」——
// 句长彼此接近、整章压成短句、连续单句段排队喊结论、主干总来得太晚、一句话四个「的」、
// 三连同构排比、段落开场重复、连词密度过高。这些是统计形状，逐词扫描看不见。
//
// 与词库线一样是 finding-only：不产生 ToolErrorItem、不影响 ok 判定，只给冷 pass 一份
// 带定位的线索清单。
//
// **输出里不给阈值数字，只给定位与改写方向**：创作层 prompt 纪律禁止数值处方，给出
// 「超短句 20%，目标 14%」这类靶会被写手锚定成凑数字目标，机械合并短句反而更差。
// 阈值只在本文件内部用于触发。
//
// 小说适配（移植通用散文检查器时必须做的一层）：对白段天然是短的单句段，通用检查器会把
// 它们全判成「短段鼓点」。真人网文的对白段占比（约 24%）本就高于机器产出，误伤对白等于
// 把好东西扫掉。所以短段鼓点、单句段占比、超短句占比三项统计一律跳过含引号的段落。
const HANZI_RE = /[一-鿿]/g;
/** 中文对白引号（正文合同要求用弯引号，「」为兼容形态） */
const QUOTE_CHARS = ["“", "”", "「", "」", "『", "』"];
/** 句长变异系数下限：低于此值说明句子长度彼此过于接近（人写的段落里十字句会挨着四十字句） */
const SENTENCE_CV_FLOOR = 0.42;
/** 计算变异系数所需的最小句子数：样本太少时变异系数噪声大 */
const CV_MIN_SENTENCES = 12;
/** 超短句上限（汉字数）：≤6 字算超短句 */
const TINY_SENTENCE_HANZI = 6;
/** 叙述句里超短句占比上限（不含对白段）：超过说明整章被压成了短句 */
const TINY_SENTENCE_RATIO_CEIL = 0.25;
/** 判超短句占比所需的最小叙述句数 */
const TINY_RATIO_MIN_SENTENCES = 20;
/** 短促段：汉字数 ≤ 此值且只有一句 */
const SHORT_PARAGRAPH_HANZI = 24;
/** 连续短促单句段达到此数即报「鼓点」 */
const SHORT_PARAGRAPH_STREAK = 4;
/** 单句段占比上限（不含对白段） */
const ONE_SENTENCE_RATIO_CEIL = 0.75;
/** 判单句段占比所需的最小叙述段数 */
const ONE_SENTENCE_MIN_PARAGRAPHS = 10;
/** 重「的」长句：汉字数 ≥ 此值 */
const HEAVY_DE_HANZI = 38;
/** 重「的」长句：「的」出现次数 ≥ 此值 */
const HEAVY_DE_COUNT = 4;
/** 同一句里同构小句连排达到此数即算一处排比 */
const ANAPHORA_RUN = 3;
/** 全章排比处数达到此值才报（单处多为合法群像扫描，见 ⑦ 处注释） */
const ANAPHORA_MIN_HITS = 2;
/** 段落开场词重复达到此次数即报 */
const REPEATED_OPENER_TIMES = 4;
/** 连词密度上限（每千汉字） */
const CONJUNCTION_PER_KILO = 7;
/** 判连词密度所需的最小汉字量 */
const CONJUNCTION_MIN_HANZI = 600;
/** 长前置成分：主干（谁做了什么）被压到句子后半截 */
const LATE_SUBJECT_PATTERNS = [
    /(?:^|[。！？]\s*)在[^，。！？\n]{12,70}(?:以后|之后|之前|以前|过程中|情况下|背景下)，/g,
    /(?:^|[。！？]\s*)那些[^，。！？\n]{10,60}的[^，。！？\n]{2,30}[，。]/g,
    /(?:^|[。！？]\s*)(?:真正|最终|最后)让[^，。！？\n]{8,70}的，是/g,
];
const CONJUNCTIONS = [
    "因为",
    "所以",
    "但是",
    "然而",
    "同时",
    "此外",
    "而且",
    "并且",
    "因此",
    "不仅",
];
const REPEATED_OPENERS = [
    "其实",
    "不过",
    "当然",
    "所以",
    "但是",
    "后来",
    "当时",
    "而后",
    "随后",
    "然后",
    "可是",
    "只是",
];
function hanziCount(text) {
    return (text.match(HANZI_RE) ?? []).length;
}
/** 按中文句末标点切句，保留标点；省略号不当句末（它常在句中表停顿） */
function splitSentences(text) {
    return text
        .split(/(?<=[。！？!?])/)
        .map((s) => s.trim())
        .filter((s) => hanziCount(s) >= 2);
}
function excerpt(value, width = 40) {
    const clean = value.replace(/\s+/g, " ").trim();
    return clean.length <= width ? clean : `${clean.slice(0, width - 1)}…`;
}
/**
 * 切段。正文用空行分段（`ch-NNN.md` 的既有格式）；若整篇切不出多段（作者手写成单换行
 * 分段），退回按单换行切，两种格式都能扫。标题行与 markdown 列表行不计入段落。
 */
function splitParagraphs(text) {
    let blocks = text.split(/\n\s*\n/);
    if (blocks.filter((b) => b.trim().length > 0).length < 2) {
        blocks = text.split(/\n/);
    }
    const paragraphs = [];
    let index = 0;
    for (const block of blocks) {
        const clean = block.replace(/[>*_`]/g, "").trim();
        if (!clean)
            continue;
        index += 1;
        if (clean.startsWith("#") || /^(?:[-+*]|\d+[.、])\s/.test(clean))
            continue;
        const hanzi = hanziCount(clean);
        if (hanzi < 4)
            continue;
        paragraphs.push({
            index,
            text: clean,
            hanzi,
            sentences: splitSentences(clean),
            hasQuote: QUOTE_CHARS.some((q) => clean.includes(q)),
        });
    }
    return paragraphs;
}
/**
 * 一句里三个以上小句用同一个开头（同构排比）。
 * 对白段跳过：台词里的三连（「别提爹，别提医，别提剑」）是人物在使劲，不是模型摆整齐。
 */
function anaphoraSentences(paragraphs) {
    const hits = [];
    for (const para of paragraphs) {
        if (para.hasQuote)
            continue;
        for (const sentence of para.sentences) {
            const clauses = sentence
                .split(/[，、；,;]/)
                .map((c) => c.trim())
                .filter((c) => hanziCount(c) >= 3);
            if (clauses.length < ANAPHORA_RUN)
                continue;
            let run = 1;
            for (let i = 1; i < clauses.length; i += 1) {
                const prev = clauses[i - 1];
                const cur = clauses[i];
                if (prev.slice(0, 2) === cur.slice(0, 2) && /^[一-鿿]{2}/.test(cur)) {
                    run += 1;
                    if (run >= ANAPHORA_RUN) {
                        hits.push({ index: para.index, sentence });
                        break;
                    }
                }
                else {
                    run = 1;
                }
            }
        }
    }
    return hits;
}
function countTerms(text, terms) {
    const counts = new Map();
    for (const term of terms) {
        const n = text.split(term).length - 1;
        if (n > 0)
            counts.set(term, n);
    }
    return counts;
}
/**
 * 扫描正文的句段形状。返回命中的形状清单（可为空），供冷 pass 定位改写。
 * 只看形状，不判文笔好坏；所有判定都跳过 markdown 标题与列表行。
 */
export function scanProseShape(text) {
    const paragraphs = splitParagraphs(text);
    if (paragraphs.length === 0)
        return [];
    const findings = [];
    const totalHanzi = paragraphs.reduce((sum, p) => sum + p.hanzi, 0);
    const narration = paragraphs.filter((p) => !p.hasQuote);
    const allSentences = paragraphs.flatMap((p) => p.sentences);
    const narrationSentences = narration.flatMap((p) => p.sentences);
    // ① 句长彼此过于接近
    const lengths = allSentences.map(hanziCount).filter((n) => n >= 4);
    if (lengths.length >= CV_MIN_SENTENCES) {
        const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
        if (mean > 0) {
            const variance = lengths.reduce((sum, n) => sum + (n - mean) ** 2, 0) / lengths.length;
            const cv = Math.sqrt(variance) / mean;
            if (cv < SENTENCE_CV_FLOOR) {
                findings.push({
                    id: "sentence_length_uniform",
                    label: "句长彼此过于接近",
                    detail: "全章句子长度挤在同一个区间，读起来像按同一个模具切出来的",
                    hint: "人写的段落里十个字的句子会挨着四十个字的句子。心里绕弯子、算账、铺关系的地方放开写长，一句话把因果和情绪一并交清楚；要砸的地方再压短",
                });
            }
        }
    }
    // ② 叙述被压成短句（对白段不算——对白短是好事）
    if (narrationSentences.length >= TINY_RATIO_MIN_SENTENCES) {
        const tiny = narrationSentences.filter((s) => hanziCount(s) <= TINY_SENTENCE_HANZI).length;
        if (tiny / narrationSentences.length > TINY_SENTENCE_RATIO_CEIL) {
            findings.push({
                id: "tiny_sentence_flood",
                label: "叙述被切得太碎",
                detail: "对白之外的叙述句里，大量句子短到只剩几个字",
                hint: "把本该一口气说完的因果重新缝回长句；短句留给真正要砸的落点。切碎不等于节奏，读者为读懂一句话回头重看才是认知负荷",
            });
        }
    }
    // ③ 连续短促单句段（排队喊结论）
    let streak = [];
    let reportedStreak = false;
    for (const para of narration) {
        if (para.hanzi <= SHORT_PARAGRAPH_HANZI && para.sentences.length <= 1) {
            streak.push(para);
            if (streak.length >= SHORT_PARAGRAPH_STREAK && !reportedStreak) {
                findings.push({
                    id: "short_paragraph_drumbeat",
                    label: "短段鼓点",
                    detail: `第 ${streak[0].index} 段起连续 ${streak.length} 个短促单句段（例：${excerpt(streak[0].text)}）`,
                    hint: "连着几个单句段落会变成敲桌子的鼓点。检查是不是在排队喊结论；能顺着读下去的合并回去，单句成段只留给真需要停一下的地方",
                });
                reportedStreak = true;
            }
        }
        else {
            streak = [];
        }
    }
    // ④ 整章段落形状单一
    if (narration.length >= ONE_SENTENCE_MIN_PARAGRAPHS) {
        const oneSentence = narration.filter((p) => p.sentences.length <= 1).length;
        if (oneSentence / narration.length >= ONE_SENTENCE_RATIO_CEIL) {
            findings.push({
                id: "one_sentence_paragraph_flood",
                label: "段落形状单一",
                detail: "对白之外的段落绝大多数只有一句话，全章段落长度没有高低差",
                hint: "段落不必等长。一段先把眼下这一件事做完（讲动作、补背景、算一笔账、给判断），普通地方用普通句子结束",
            });
        }
    }
    // ⑤ 主干来得太晚
    const lateHits = [];
    for (const para of paragraphs) {
        for (const pattern of LATE_SUBJECT_PATTERNS) {
            for (const m of para.text.matchAll(pattern)) {
                lateHits.push({ index: para.index, sample: m[0] });
            }
        }
    }
    const lateLimit = Math.max(2, Math.floor(totalHanzi / 1200));
    if (lateHits.length > lateLimit) {
        findings.push({
            id: "late_subject",
            label: "主干来得太晚",
            detail: `长前置成分 ${lateHits.length} 处，如第 ${lateHits[0].index} 段「${excerpt(lateHits[0].sample)}」`,
            hint: "先让做事的人和动作出现，再往后接时间、原因、条件和例子。长句可以有，读者要尽早知道谁做了什么",
        });
    }
    // ⑥ 一句话四个「的」
    const heavyDe = [];
    for (const para of paragraphs) {
        for (const sentence of para.sentences) {
            if (hanziCount(sentence) >= HEAVY_DE_HANZI && (sentence.split("的").length - 1) >= HEAVY_DE_COUNT) {
                heavyDe.push({ index: para.index, sentence });
            }
        }
    }
    const heavyDeLimit = Math.max(1, Math.floor(totalHanzi / 1500));
    if (heavyDe.length > heavyDeLimit) {
        findings.push({
            id: "heavy_de_sentence",
            label: "长定语堆叠",
            detail: `${heavyDe.length} 个长句里塞了四个以上「的」，如第 ${heavyDe[0].index} 段「${excerpt(heavyDe[0].sentence)}」`,
            hint: "拆开长定语：先让人和东西出现，再补它的来历、条件和限制。读到名词时已经忘了句首就要重写",
        });
    }
    // ⑦ 三连以上同构排比。真稿实测：单处多是合法的群像扫描（「有人挎菜篮，有人牵小孩，
    // 有人假装挑东西」），成串出现才是模型在摆整齐，所以门槛设在 2 处。
    const anaphoras = anaphoraSentences(paragraphs);
    if (anaphoras.length >= ANAPHORA_MIN_HITS) {
        findings.push({
            id: "anaphora_run",
            label: "同构排比",
            detail: `${anaphoras.length} 处三连以上同构排比，如第 ${anaphoras[0].index} 段「${excerpt(anaphoras[0].sentence)}」`,
            hint: "逐处读一遍：确实在数一排东西（群像、清单）就留着；只是把同一个意思摆整齐三遍，留两项，第三项换说法或删掉",
        });
    }
    // ⑧ 段落开场重复
    const openerCounts = new Map();
    for (const para of paragraphs) {
        const head = para.text.replace(/^[“‘「『"（(]+/, "");
        for (const opener of REPEATED_OPENERS) {
            if (head.startsWith(opener)) {
                const entry = openerCounts.get(opener) ?? { count: 0, first: para.index };
                entry.count += 1;
                openerCounts.set(opener, entry);
                break;
            }
        }
    }
    const repeated = [...openerCounts.entries()].filter(([, v]) => v.count >= REPEATED_OPENER_TIMES);
    if (repeated.length > 0) {
        const detail = repeated
            .map(([opener, v]) => `「${opener}」${v.count} 次（首次第 ${v.first} 段）`)
            .join("、");
        findings.push({
            id: "repeated_opener",
            label: "段落开场重复",
            detail,
            hint: "同一个词反复起段是模型的固定开场。让后一段直接接住前一段留下的动作或问题",
        });
    }
    // ⑨ 连词密度
    if (totalHanzi >= CONJUNCTION_MIN_HANZI) {
        const counts = countTerms(paragraphs.map((p) => p.text).join("\n"), CONJUNCTIONS);
        const total = [...counts.values()].reduce((a, b) => a + b, 0);
        if ((total * 1000) / totalHanzi > CONJUNCTION_PER_KILO) {
            const samples = [...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([term, n]) => `${term} ${n} 次`)
                .join("、");
            findings.push({
                id: "conjunction_density",
                label: "连词偏密",
                detail: `全章连词 ${total} 处（${samples}）`,
                hint: "中文小句靠语序和事理相接。删掉一半连词，让前后事情自己接上",
            });
        }
    }
    return findings;
}
