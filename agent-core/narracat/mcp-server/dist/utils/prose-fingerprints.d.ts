export interface ProseFingerprintFinding {
    category: string;
    label: string;
    /** positions：该 term/pattern 命中的字符偏移（0-based），最多前 10 个；超出仅截断展示，不影响 count */
    hits: Array<{
        term: string;
        count: number;
        positions: number[];
    }>;
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
export declare function scanProseFingerprints(text: string): ProseFingerprintFinding[];
