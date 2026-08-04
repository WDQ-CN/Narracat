/**
 * Style Reference 语料库加载器
 *
 * 在 MCP Server 启动时从 novel-style-reference skill 的 JSON 文件中加载
 * 真人写作范例语料库到内存，提供按 technique + emotion 组合的查询接口。
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// ============================================================
// 类型定义
// ============================================================

interface RawExtract {
  id: string;
  paragraph: string;
  technique: string[];
  emotion: string[];
  annotation: string;
  usage_scenario: string;
}

interface CorpusFile {
  work_id: string;
  extracts: RawExtract[];
}

export interface StyleReferenceEntry {
  id: string;
  paragraph: string;
  technique: string[];
  emotion: string[];
  annotation: string;
  usage_scenario: string;
}

export interface StyleReferenceQuery {
  technique: string[];
  emotion?: string[];
  limit?: number;
}

// ============================================================
// 语料库加载（模块级缓存，进程内只加载一次）
// ============================================================

let corpusEntries: StyleReferenceEntry[] | null = null;

/**
 * 解析语料库目录路径（相对于编译后的 dist/）
 * dist/ → ../../skills/novel-style-reference/references/corpus/extracts/
 */
function resolveCorpusDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(
    __dirname,
    "../../skills/novel-style-reference/references/corpus/extracts",
  );
}

/**
 * 从 JSON 文件加载所有语料条目
 */
function loadAllEntries(): StyleReferenceEntry[] {
  if (corpusEntries !== null) return corpusEntries;

  const corpusDir = resolveCorpusDir();

  if (!existsSync(corpusDir)) {
    console.error(
      `[NovelMemory] Style reference corpus not found at: ${corpusDir}`,
    );
    corpusEntries = [];
    return corpusEntries;
  }

  const files = readdirSync(corpusDir).filter((f) => f.endsWith(".json"));
  const entries: StyleReferenceEntry[] = [];

  for (const file of files) {
    try {
      const data: CorpusFile = JSON.parse(
        readFileSync(path.join(corpusDir, file), "utf-8"),
      );
      for (const extract of data.extracts) {
        entries.push({
          id: extract.id,
          paragraph: extract.paragraph,
          technique: extract.technique,
          emotion: extract.emotion,
          annotation: extract.annotation,
          usage_scenario: extract.usage_scenario,
        });
      }
    } catch (err) {
      console.error(
        `[NovelMemory] Failed to load corpus file ${file}:`,
        err,
      );
    }
  }

  console.error(
    `[NovelMemory] Loaded ${entries.length} style reference entries from ${files.length} files`,
  );
  corpusEntries = entries;
  return entries;
}

/** 从记录 id（WK-031-001）取 work_id（WK-031），供「同书不重复」去重。导出供单测。 */
export function workIdOf(id: string): string {
  return id.replace(/-\d+$/, "");
}

// ============================================================
// 查询接口
// ============================================================

// ============================================================
// WritingContextPack 范例选取
// ============================================================

export interface StyleExampleForPack {
  excerpt: string;
  mechanism_note: string;
}

// 负向取向（#333，配套 ADR-0024 风格指令正向化）：机制注解若在教写手把爽点
// 「冷处理 / 留渣 / 从爽滑向闷」，就与正向化反向，不入选样。
// 词表只锁「冷处理 payoff」这一取向，刻意不含「克制 / 留白」——语料里大量
// 「克制而精准」「不煽情正是 show don't tell」是褒义 craft 观察，误删会反噬画面感目标。
const PAYOFF_COOLING_PHRASES = [
  "留渣", "滑向闷", "把爽点收", "爽点必须留", "冷处理", "纯爽则",
];

/** 机制注解是否为「把爽点收着 / 留渣」取向（应排除）。导出供单测。 */
export function isPayoffCoolingAnnotation(annotation: string): boolean {
  return PAYOFF_COOLING_PHRASES.some((p) => annotation.includes(p));
}

// 画面感 / 情绪外显取向的技法标签——选样优先返回带这些标签的范例，
// 让写手学到的是「把画面和情绪演出来」而非内省独白。
const VIVID_TECHNIQUES = new Set(["动作细节", "环境描写", "情感渲染"]);

/** 范例技法是否偏画面感 / 情绪外显（应优先）。导出供单测。 */
export function hasVividTechnique(technique: string[]): boolean {
  return technique.some((t) => VIVID_TECHNIQUES.has(t));
}

// 克制类词汇（与风格指令正向化 4.0.41/ADR-0024 同一词表）。注解即便取向正向，
// 这些词本身也会被弱模型误读为「写冷」——机制注解是喂给写手的生成端文本，故在
// 同等画面感候选里，注解不含这些词的优先于含的（降级而非剔除：正向池干净注解
// 充足，带克制词的实际几乎不会被选中，但语料萎缩时仍可兜底）。
const RESTRAINT_VOCAB = [
  "克制", "留白", "不煽情", "收敛", "含蓄", "内敛", "节制",
];

/** 机制注解是否夹带克制类词汇（应在同档内降级）。导出供单测。 */
export function annotationCarriesRestraintVocab(annotation: string): boolean {
  return RESTRAINT_VOCAB.some((w) => annotation.includes(w));
}

// 8 情感的章纲探测线索（扩展近义词 + 事件型词，覆盖章纲常见表述）。值域与 corpus
// emotion tag 同源（tools.ts novel_query_style_reference）。仅作「本章想要什么情绪」的
// 弱信号探测——是选样的档内偏好、非硬过滤；探不到/探错最坏丢掉情绪加权、绝不破坏画面感底线。
export const EMOTION_CUES: Record<string, string[]> = {
  紧张: ["紧张", "危机", "对峙", "凶险", "逼近", "威胁", "追杀", "生死", "绝境", "厮杀", "险境", "千钧", "压迫"],
  悲伤: ["悲伤", "悲痛", "哀伤", "泪", "痛哭", "离别", "失去", "诀别", "绝望", "牺牲", "孤独", "亡故"],
  愤怒: ["愤怒", "怒火", "仇恨", "报复", "复仇", "质问", "咬牙", "杀意", "不甘", "震怒"],
  暧昧: ["暧昧", "心动", "脸红", "亲密", "试探", "情愫", "心跳", "旖旎", "情意", "缠绵"],
  幽默: ["幽默", "调侃", "吐槽", "搞笑", "滑稽", "诙谐", "插科", "反差萌", "逗趣"],
  温暖: ["温暖", "温情", "治愈", "陪伴", "归家", "守护", "相依", "团圆", "暖意", "和睦"],
  释然: ["释然", "放下", "和解", "解脱", "释怀", "顿悟", "了结", "平静"],
  震撼: ["震撼", "反转", "真相", "揭露", "冲击", "逆转", "碾压", "爆发", "惊变", "颠覆"],
};

/**
 * 从本章章纲文本探测目标情绪：取命中线索数最多的前 3 类，无命中返回空数组。
 * 用于 selectStyleExamples 的档内情绪偏好（Layer B）。导出供单测。
 */
export function detectChapterEmotions(text: string): string[] {
  if (!text) return [];
  const scored: Array<[string, number]> = [];
  for (const [emo, cues] of Object.entries(EMOTION_CUES)) {
    let n = 0;
    for (const c of cues) if (text.includes(c)) n += 1;
    if (n > 0) scored.push([emo, n]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, 3).map(([emo]) => emo);
}

/**
 * 为 WritingContextPack 机械选取 2-3 段真人范例（带机制注解）。
 *
 * 选样口径：先过滤「冷处理 payoff / 留渣」负向范例；再分三档——① 画面感+干净注解
 * → ② 画面感+夹带克制词 → ③ 其余，高档不足才落下档（防冷底线，#333/#335）。
 * **每档内先选情绪匹配本章的（Layer B，chapterEmotions 非空时），再补其余**；档内按
 * 章号确定性轮换、优先不同作品。情绪匹配是档内偏好非硬过滤——探不到/探错最坏丢掉情绪
 * 加权、绝不破坏画面感底线；chapterEmotions 为空时行为与历史完全一致。无语料返回空数组。
 */
export function selectStyleExamples(
  chapter: number,
  limit = 3,
  chapterEmotions: string[] = [],
): StyleExampleForPack[] {
  const entries = loadAllEntries();
  const filtered = entries.filter(
    (e) => !isPayoffCoolingAnnotation(e.annotation),
  );
  if (filtered.length === 0) return [];

  const sorted = [...filtered].sort((a, b) => a.id.localeCompare(b.id));
  const count = Math.min(Math.max(1, limit), sorted.length);
  const vivid = sorted.filter((e) => hasVividTechnique(e.technique));
  const vividClean = vivid.filter(
    (e) => !annotationCarriesRestraintVocab(e.annotation),
  );
  const vividRestraint = vivid.filter((e) =>
    annotationCarriesRestraintVocab(e.annotation),
  );
  const rest = sorted.filter((e) => !hasVividTechnique(e.technique));

  const emoSet = new Set(chapterEmotions);
  const matchesEmotion = (e: StyleReferenceEntry): boolean =>
    emoSet.size > 0 && e.emotion.some((x) => emoSet.has(x));

  const picked: StyleReferenceEntry[] = [];
  const usedWorkIds = new Set<string>();
  // 档内取段：按章号确定性轮换 + 优先不同作品（这就是「同情绪多条」时的取舍规则）
  const rotatePick = (group: StyleReferenceEntry[]): void => {
    if (group.length === 0) return;
    const start = ((Math.max(1, chapter) - 1) * count) % group.length;
    // 第一轮：从起点扫描，优先不同作品
    for (let i = 0; i < group.length && picked.length < count; i += 1) {
      const entry = group[(start + i) % group.length];
      if (picked.includes(entry) || usedWorkIds.has(workIdOf(entry.id))) continue;
      picked.push(entry);
      usedWorkIds.add(workIdOf(entry.id));
    }
    // 第二轮：作品数不足时放开限制补齐
    for (let i = 0; i < group.length && picked.length < count; i += 1) {
      const entry = group[(start + i) % group.length];
      if (picked.includes(entry)) continue;
      picked.push(entry);
    }
  };
  // 每档内：先情绪匹配本章的，再补其余（Layer B 档内偏好）。
  // emoSet 为空时 matched 恒空、others 即整档 → 退回历史行为，完全向后兼容。
  const pickTier = (tier: StyleReferenceEntry[]): void => {
    rotatePick(tier.filter(matchesEmotion));
    rotatePick(tier.filter((e) => !matchesEmotion(e)));
  };
  pickTier(vividClean);
  pickTier(vividRestraint);
  pickTier(rest);

  return picked.map((entry) => ({
    excerpt: entry.paragraph,
    mechanism_note: entry.annotation,
  }));
}

/**
 * 按 technique + emotion 组合查询真人写作范例
 */
export function queryStyleReference(
  query: StyleReferenceQuery,
): { results: StyleReferenceEntry[]; total_matches: number } {
  const entries = loadAllEntries();
  const limit = query.limit ?? 3;
  const effectiveLimit = Math.min(Math.max(1, limit), 8);

  const techniqueSet = new Set(query.technique.map((t) => t.trim()));
  const emotionSet = query.emotion
    ? new Set(query.emotion.map((e) => e.trim()))
    : null;

  // 为每个条目计算匹配得分
  const scored = entries
    .map((entry) => {
      let score = 0;

      // 手法匹配（至少匹配一个手法，否则排除）
      const matchedTechniques = entry.technique.filter((t) =>
        techniqueSet.has(t),
      );
      if (matchedTechniques.length === 0) return null;
      score += matchedTechniques.length * 10;

      // 情感匹配（可选加分）
      if (emotionSet) {
        const matchedEmotions = entry.emotion.filter((e) =>
          emotionSet.has(e),
        );
        score += matchedEmotions.length * 5;
      }

      return { entry, score };
    })
    .filter(Boolean) as Array<{
      entry: StyleReferenceEntry;
      score: number;
    }>;

  // 按得分降序排列
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.id.localeCompare(b.entry.id);
  });

  const totalMatches = scored.length;
  const topResults = scored.slice(0, effectiveLimit).map((s) => s.entry);

  return {
    results: topResults,
    total_matches: totalMatches,
  };
}
