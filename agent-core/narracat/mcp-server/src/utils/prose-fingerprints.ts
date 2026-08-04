// ============================================================
// 洁净词库 v1：正文指纹扫描器（finding-only，spec §4.4）
// ============================================================
//
// 与硬密度门（handlers/validators.ts 里的破折号 / 「不是…是…」对仗）不同，本扫描器
// 只报「发现」，不产生 ToolErrorItem、不影响任何 ok 判定——纯粹给冷 pass 一份具名的
// AI 味词清单 + 改写方向。词库数据见 data/prose-hygiene-lexicon.ts；由
// novelCheckProseHygiene 调用，随 fingerprint_findings 字段附带返回（finding-only，
// 不阻断）。

import { PROSE_FINGERPRINT_LEXICON } from "../data/prose-hygiene-lexicon.js";

const MANUSCRIPT_HANZI_RE = /[一-鿿]/g;

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/** 正则元字符转义：term 模式下 term 理论上可能含正则特殊字符，v1 词全是汉字但仍需防呆 */
function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 单条 hits 记录最多保留的命中偏移数（超出截断，count 仍是全量，PR#502 人审 R4） */
const FINGERPRINT_HIT_POSITIONS_LIMIT = 10;

export interface ProseFingerprintFinding {
  category: string;
  label: string;
  /** positions：该 term/pattern 命中的字符偏移（0-based），最多前 10 个；超出仅截断展示，不影响 count */
  hits: Array<{ term: string; count: number; positions: number[] }>;
  total: number;
  per_kilo: number;
  replace_hint: string;
}

/**
 * 扫描正文里的洁净词库命中项。每个类目只要 total > 0 即返回，按 per_kilo 降序排列。
 * term 模式逐词计数（重叠计数允许，如「淡淡道」同时命中「淡淡」与整词「淡淡道」）；
 * regex 模式按 pattern 全局匹配计数，命中原文去重后填入 hits。
 * 两种模式都用 matchAll 取 index，随手附上命中位置（PR#502 人审 R4：光有计数找不到人，
 * 消费端要定位到具体命中处才能针对性改写，不然只能通读全文靠肉眼找）。
 */
export function scanProseFingerprints(text: string): ProseFingerprintFinding[] {
  const hanzi = countMatches(text, MANUSCRIPT_HANZI_RE);
  const kilo = hanzi / 1000;
  const findings: ProseFingerprintFinding[] = [];

  for (const category of PROSE_FINGERPRINT_LEXICON) {
    const hits: Array<{ term: string; count: number; positions: number[] }> = [];
    let total = 0;

    if (category.mode === "term") {
      for (const term of category.terms ?? []) {
        const matches = [...text.matchAll(new RegExp(escapeRegExpLiteral(term), "g"))];
        if (matches.length > 0) {
          hits.push({
            term,
            count: matches.length,
            positions: matches.slice(0, FINGERPRINT_HIT_POSITIONS_LIMIT).map((m) => m.index ?? 0),
          });
          total += matches.length;
        }
      }
    } else if (category.mode === "regex" && category.pattern) {
      const matches = [...text.matchAll(new RegExp(category.pattern, "g"))];
      total = matches.length;
      const byTerm = new Map<string, { count: number; positions: number[] }>();
      for (const m of matches) {
        const entry = byTerm.get(m[0]) ?? { count: 0, positions: [] };
        entry.count += 1;
        if (entry.positions.length < FINGERPRINT_HIT_POSITIONS_LIMIT) entry.positions.push(m.index ?? 0);
        byTerm.set(m[0], entry);
      }
      for (const [term, entry] of byTerm) hits.push({ term, count: entry.count, positions: entry.positions });
    }

    if (total > 0) {
      findings.push({
        category: category.id,
        label: category.label,
        hits,
        total,
        per_kilo: kilo > 0 ? total / kilo : total,
        replace_hint: category.replace_hint,
      });
    }
  }

  findings.sort((a, b) => b.per_kilo - a.per_kilo);
  return findings;
}
