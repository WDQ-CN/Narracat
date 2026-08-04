/**
 * 配置读取模块
 *
 * 从环境变量和项目 config.yaml 读取 NovelMemory 运行所需的配置。
 * 使用正则从 YAML 提取字段，避免引入 YAML 解析器依赖。
 *
 * config.yaml 字段（init 创建，setup 填充）：
 *   novel_id / title / genre / language / automation_level /
 *   estimated_total_chapters / words_per_chapter / style_profile / genre /
 *   voltage_bestof / style_anchor_auto_fallback
 */
export interface NovelConfig {
    novelId: string;
    dbPath: string;
    projectRoot: string;
    /** 预估总章数（结构预算入参；setup 前为 null） */
    estimatedTotalChapters: number | null;
    /** 每章目标字数（结构预算与字数区间入参；setup 前为 null） */
    wordsPerChapter: number | null;
    /** 风格档位：web_fast / web_standard / literary（setup 前为 null） */
    styleProfile: string | null;
    /** 无作者样章时是否自动取最近一章开场段当声音参考；缺省或非 "false" 均视为开 */
    styleAnchorAutoFallback: boolean;
    /** 题材自由文本（如「东方修仙·升级流」）；setup 前为 null。仅供 resolveDriveBucket 关键词兜底判定用 */
    genre: string | null;
    /**
     * config.yaml 原文里是否出现过 voltage_bestof 字段（电压点判优已下线，此键本身无消费方，
     * 仅用于对存量项目的旧配置行给一次性忽略提示；不折叠成布尔开关，避免对所有项目无差别刷提示）。
     */
    voltageBestofPresentInConfig: boolean;
}
export declare function loadConfig(configPathOverride?: string): Promise<NovelConfig>;
