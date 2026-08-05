/**
 * Style Reference 语料库加载器
 *
 * 在 MCP Server 启动时从 novel-style-reference skill 的 JSON 文件中加载
 * 真人写作范例语料库到内存，提供按 technique + emotion 组合的查询接口。
 */
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
/** 从记录 id（WK-031-001）取 work_id（WK-031），供「同书不重复」去重。导出供单测。 */
export declare function workIdOf(id: string): string;
export interface StyleExampleForPack {
    excerpt: string;
    mechanism_note: string;
}
/** 机制注解是否为「把爽点收着 / 留渣」取向（应排除）。导出供单测。 */
export declare function isPayoffCoolingAnnotation(annotation: string): boolean;
/** 范例技法是否偏画面感 / 情绪外显（应优先）。导出供单测。 */
export declare function hasVividTechnique(technique: string[]): boolean;
/** 机制注解是否夹带克制类词汇（应在同档内降级）。导出供单测。 */
export declare function annotationCarriesRestraintVocab(annotation: string): boolean;
export declare const EMOTION_CUES: Record<string, string[]>;
/**
 * 从本章章纲文本探测目标情绪：取命中线索数最多的前 3 类，无命中返回空数组。
 * 用于 selectStyleExamples 的档内情绪偏好（Layer B）。导出供单测。
 */
export declare function detectChapterEmotions(text: string): string[];
/**
 * 为 WritingContextPack 机械选取 2-3 段真人范例（带机制注解）。
 *
 * 选样口径：先过滤「冷处理 payoff / 留渣」负向范例；再分三档——① 画面感+干净注解
 * → ② 画面感+夹带克制词 → ③ 其余，高档不足才落下档（防冷底线，#333/#335）。
 * **每档内先选情绪匹配本章的（Layer B，chapterEmotions 非空时），再补其余**；档内按
 * 章号确定性轮换、优先不同作品。情绪匹配是档内偏好非硬过滤——探不到/探错最坏丢掉情绪
 * 加权、绝不破坏画面感底线；chapterEmotions 为空时行为与历史完全一致。无语料返回空数组。
 */
export declare function selectStyleExamplesFrom(entries: StyleReferenceEntry[], chapter: number, limit?: number, chapterEmotions?: string[]): StyleExampleForPack[];
/**
 * 按 technique + emotion 组合查询真人写作范例
 */
export declare function queryStyleReferenceFrom(entries: StyleReferenceEntry[], query: StyleReferenceQuery): {
    results: StyleReferenceEntry[];
    total_matches: number;
};
export type CorpusSource = {
    mode: "local";
    dir: string;
} | {
    mode: "remote";
    url: string;
    token: string;
} | {
    mode: "disabled";
};
/**
 * 判定本次语料源：本地目录（dev/内部）> 远程服务（NARRACAT_CORPUS_TOKEN）> disabled（fork 默认态）。
 */
export declare function resolveCorpusSource(env?: NodeJS.ProcessEnv): CorpusSource;
/** 测试专用：清空目录加载缓存与远程结果缓存，隔离用例。 */
export declare function __resetCorpusCachesForTest(): void;
/**
 * 为 WritingContextPack 机械选取 2-3 段真人范例（带机制注解）。选样口径见
 * `selectStyleExamplesFrom`；此处只负责三态源路由与远程缓存。
 */
export declare function selectStyleExamples(chapter: number, limit?: number, chapterEmotions?: string[]): Promise<StyleExampleForPack[]>;
export interface StyleReferenceQueryResult {
    results: StyleReferenceEntry[];
    total_matches: number;
    unavailable?: boolean;
}
/**
 * 按 technique + emotion 组合查询真人写作范例；三态源路由，远程失败/disabled
 * 时返回 `unavailable: true`（供调用方区分"零匹配"与"服务不可用"）。
 */
export declare function queryStyleReference(query: StyleReferenceQuery): Promise<StyleReferenceQueryResult>;
