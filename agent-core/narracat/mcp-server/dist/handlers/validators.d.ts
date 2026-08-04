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
import type { StateVocabulary } from "./state-dimensions.js";
import type { ToolErrorItem } from "../types.js";
interface AjvErrorObject {
    keyword: string;
    instancePath: string;
    schemaPath: string;
    params: Record<string, unknown>;
    message?: string;
    data?: unknown;
}
export interface ValidationOk {
    valid: true;
    errors: null;
}
export interface ValidationFail {
    valid: false;
    errors: ToolErrorItem[];
}
export type ValidationResult = ValidationOk | ValidationFail;
/**
 * 把 ajv 错误数组转为统一 ToolErrorItem 数组。
 * hint 按 keyword 通用生成，指向 schema 的字段语义。
 */
export declare function ajvErrorsToItems(errors: AjvErrorObject[], rootData: unknown, schemaName: string): ToolErrorItem[];
export declare function validateOutlinePayload(value: unknown): ValidationResult;
export declare function validateOutlineBookPayload(value: unknown): ValidationResult;
export declare function validateChapterOutlineBatch(value: unknown): ValidationResult;
export declare function validateExtraction(value: unknown): ValidationResult;
export declare function validateReview(value: unknown): ValidationResult;
export declare function validateForeshadowingItem(value: unknown): ValidationResult;
export declare function validateCommitChapter(value: unknown): ValidationResult;
export declare function validateConsolidate(value: unknown): ValidationResult;
export declare function validatePremise(value: unknown): ValidationResult;
/** 本书状态词表（bible/state-vocabulary.json）：novel_submit_state_vocabulary 写入口 */
export declare function validateStateVocabulary(value: unknown): ValidationResult;
/** 角色结构化实体（bible/characters/<name>.json）：novel_submit_character_entity 写入口 */
export declare function validateCharacterEntity(value: unknown): ValidationResult;
/** 作者对角色结构化状态的直接修订 */
export declare function validateAuthoredState(value: unknown): ValidationResult;
/**
 * 校验 CascadeImpactReport 完整对象（级联影响分析产出）。
 * 两类变更共用本契约，ajv 之上按 change_kind 补语义约束：
 * - 公共：has_impact=true 时 affected_chapters 非空
 * - chapter_rewrite（默认）：必带 rewritten_chapter；affected_chapters[].chapter 必须 > rewritten_chapter
 * - character_added：必带 added_character 与 insertion_point；
 *     insertion_point=forward（纯前向，仅建档）时 has_impact 必须为 false
 */
export declare function validateCascadeImpactReport(value: unknown): ValidationResult;
export type StructureTier = "S" | "M" | "L" | "XL";
export interface StructureBudget {
    tier: StructureTier;
    total_chapters: number;
    total_words: number;
    /** 每卷约 60 章；可接受带宽由 40-80 章/卷推得 */
    volumes: {
        recommended: number;
        min: number;
        max: number;
    };
    /** arc 跨度（章），按 tier 伸缩 */
    arc_span: {
        min: number;
        max: number;
    };
    /** 推荐故事线条数 = clamp(floor(总字数万 / 50), 2..8) */
    storyline_budget: number;
    /** 预估 arc 总数（按 arc_span 中点折算） */
    arcs_estimate: number;
    /** major ≈ 卷数；medium ≈ arc 数；small ≈ 总章数/10 */
    foreshadowing: {
        major: number;
        medium: number;
        small: number;
    };
    iconic_scenes_per_volume: [number, number];
    turning_points_per_volume: number;
    /** 每 arc 爽点下限（S 档可 0） */
    payoff_beats_min_per_arc: number;
}
/**
 * 伏笔兑现节奏阈值（可调）：网文要求长线悬念稳定供给、近线伏笔及时兑现。
 * 集中成一个对象便于产品收紧/放宽。
 * - major_min_payoffs_per_volume：每卷至少应兑现的 major 伏笔条数（长线悬念密度下限）
 * - small 伏笔应 arc 内兑现、medium 应本卷内兑现——跨界即视为延迟兑现
 */
export declare const FORESHADOWING_PAYOFF_THRESHOLDS: {
    readonly major_min_payoffs_per_volume: 2;
    readonly major_max_span_volumes: 2;
};
export declare function computeStructureBudget(estimatedTotalChapters: number, wordsPerChapter: number): StructureBudget;
/** 爽点类型枚举（SSOT 在 outline-structure.json）：arc 级 payoff_beats 与章级 payoff_beat 共用 */
export type PayoffBeat = "face_slap" | "level_up" | "windfall" | "fame" | "reveal" | "reunion" | "counterattack" | "sweet";
/** 爽点强度枚举（SSOT 在 outline-structure.json）：章级 payoff_intensity，与 payoff_beat 同款可空语义 */
export type PayoffIntensity = "small" | "medium" | "large";
export interface OutlineArc {
    arc_id: string;
    title: string;
    chapter_start: number;
    chapter_end: number;
    core_question: string;
    irreversible_change: string;
    next_arc_seed: string;
    antagonist_agent?: string;
    payoff_beats: string[];
}
export interface OutlineVolume {
    volume_no: number;
    title: string;
    dilemma_milestone?: string;
    arc_list: OutlineArc[];
}
export interface OutlinePayload {
    central_dramatic_question: string;
    protagonist_core_desire: string;
    protagonist_core_lack: string;
    antagonistic_force: string;
    stakes_progression: string;
    storylines: Array<{
        id: string;
        name: string;
        type: string;
        priority: number;
        entry_chapter: number;
        planned_payoff_chapter?: number;
        status?: string;
        is_through_line?: boolean;
    }>;
    foreshadowing_registry: Array<{
        id: string;
        type: "small" | "medium" | "major";
        description: string;
        planted_chapter: number;
        target_reveal: string;
        theme_link?: string;
    }>;
    volumes: OutlineVolume[];
}
export interface OutlineCheckResult {
    errors: ToolErrorItem[];
    warnings: string[];
}
/**
 * target_reveal → 兑现章号：纯数字直接用；vol-VV 取该卷最后一章（从 volumeLastChapter 映射）；
 * 无法解析返回 null。供 checkOutlineSemantics（时序完整性）与 checkForeshadowingPayoffTiming（节奏）共用。
 */
export declare function resolveRevealChapter(targetReveal: string, volumeLastChapter: Map<number, number>): number | null;
/**
 * 结构语义核验：arc 区间合法、有序、不重叠、连续；卷号与 id 唯一；伏笔兑现晚于埋设。
 */
export declare function checkOutlineSemantics(payload: OutlinePayload): OutlineCheckResult;
/**
 * 预算下限核验：用 computeStructureBudget 的数字作 validator 下限。
 * 下限按已提交章数等比折算——超长篇允许先交书级骨架+第一卷。
 */
export declare function checkOutlineBudget(payload: OutlinePayload, budget: StructureBudget): OutlineCheckResult;
/**
 * 困境里程碑核验（全书里程碑制）：
 * - 声明的里程碑随卷序单调不降（ability→choice→value→identity→existential）
 * - 覆盖全书 50% 处的卷（如声明）须达 value 及以上
 * - 末卷（chapter_end ≥ 全书总章数，如声明）须达 identity / existential
 */
export declare function checkDilemmaMilestones(payload: OutlinePayload, totalChapters: number | null): OutlineCheckResult;
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
export declare function checkForeshadowingPayoffTiming(payload: OutlinePayload): OutlineCheckResult;
/**
 * 结构节奏反退化门控阈值（可调）：只拦明显机械的退化产出，不规定具体长短/章号。
 * 集中成一个对象便于产品收紧/放宽，仿 FORESHADOWING_PAYOFF_THRESHOLDS。
 */
export declare const STRUCTURE_RHYTHM_THRESHOLDS: {
    readonly arc_rhythm_min_arcs: 6;
    readonly arc_mode_share_max: 0.6;
    readonly storyline_min_for_stagger: 3;
    readonly storyline_min_for_midpoint: 4;
    readonly midpoint_payoff_window: {
        readonly start: 0.1;
        readonly end: 0.85;
    };
    readonly small_span_error_multiple: 2;
    readonly small_span_warn_multiple: 1;
    readonly major_early_plant_ratio: 0.05;
};
/**
 * 开局留存门控阈值（可调）：只抬开局爽点前置的硬下限，不规定爽点类型/具体章号。
 * 集中成对象便于产品收紧/放宽，仿 STRUCTURE_RHYTHM_THRESHOLDS。
 */
export declare const OPENING_RETENTION_THRESHOLDS: {
    readonly golden_chapters: 3;
    readonly min_opening_payoff_beats: 1;
    readonly max_opening_payoff_gap_warn: 4;
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
export declare function checkStructureRhythm(payload: OutlinePayload, budget: StructureBudget): OutlineCheckResult;
/** 跨契约角色引用最小形状（ADR-0012）。character_uid 机器主键、name 人读冗余 */
export interface CharacterReference {
    character_uid: string;
    name: string;
}
/** 章级计划状态变更条目（schema $defs/chapter_outline.state_changes；operation 缺省由维度 cardinality 定） */
export interface StateChangeItem {
    character: CharacterReference;
    dimension: string;
    operation?: "set" | "add" | "remove";
    value: string;
    reason?: string;
}
export interface ChapterOutlineItem {
    chapter: number;
    title: string;
    positioning: string;
    beats: string[];
    must_deliver?: string[];
    payoff_beat?: PayoffBeat;
    payoff_intensity?: PayoffIntensity;
    end_hook?: "suspense" | "danger" | "emotional" | "none";
    storyline_focus: string[];
    characters: CharacterReference[];
    pov_character: CharacterReference;
    foreshadowing_touch?: Array<{
        id: string;
        action: "plant" | "develop" | "reveal";
    }>;
    state_changes?: StateChangeItem[];
}
export interface ChapterBatchCheckInput {
    /** chapter → {arcId, volumeNo}，由 arc_meta 表展开 */
    chapterArcIndex: Map<number, {
        arcId: string;
        volumeNo: number;
    }>;
    storylineIds: Set<string>;
    foreshadowingIds: Set<string>;
}
export interface ChapterBatchCheckResult {
    errors: ToolErrorItem[];
    warnings: string[];
    arcsCovered: string[];
}
/**
 * 大纲散文洁净门：positioning / beats / must_deliver 是给作者读的人话，命中机器 token
 * （编号 / snake_case / 英文枚举）或破折号 —— 即 ERROR 打回自修正。机器语义已在结构化字段
 * （payoff_beat / foreshadowing_touch / storyline_focus），散文里再写既冗余又让作者读不懂。
 */
export declare function checkChapterProseHygiene(chapters: ChapterOutlineItem[]): ToolErrorItem[];
/**
 * state_changes 语义门：维度必须在本书状态词表内、enum 维度值必须落值域、
 * operation 与维度 cardinality 匹配（one 恒 set 可省略；many 缺省 add、显式 set 拒——
 * 与作者编辑入口 novel_submit_authored_state 同一套规则，两处语义保持镜像）、
 * 值按 attributeFact 归属规则必须落回计划维度（enum 值域优先、free 兜底——否则该计划
 * 在事实账上永远兑现不了，兑现门只会空报警）。
 * 词表缺失时携带非空 state_changes 一律拒绝（引导先建词表，不做无词表的裸计划）。
 */
export declare function checkStateChanges(chapters: ChapterOutlineItem[], vocab: StateVocabulary | null): ToolErrorItem[];
export interface ManuscriptHygieneStats {
    hanzi: number;
    emDashCount: number;
    emDashPerKilo: number;
    antithesisCount: number;
    antithesisPerKilo: number;
    /** 单段内「不是X是Y」最多出现次数（连排信号，≥2 即刺眼堆叠） */
    maxAntithesisInParagraph: number;
}
/**
 * 正文散文洁净门纯扫描：返回命中项（errors[]+hint，与账房层自修正回路同构）与密度统计。
 * errors 为空 = 通过。密度超阈或对仗同段连排即命中。只度量确定的机械马脚，不碰主观质量。
 */
export declare function scanManuscriptProseHygiene(text: string): {
    errors: ToolErrorItem[];
    stats: ManuscriptHygieneStats;
};
/** 单批章纲覆盖的 arc 数上限 */
export declare const CHAPTER_BATCH_MAX_ARCS = 4;
export declare function checkChapterBatch(chapters: ChapterOutlineItem[], refs: ChapterBatchCheckInput): ChapterBatchCheckResult;
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
export declare function checkPayoffIntensityConsistency(chapters: ChapterOutlineItem[]): {
    warnings: string[];
};
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
export declare function checkOpeningRetention(chapters: ChapterOutlineItem[]): OutlineCheckResult;
/**
 * 章末钩节奏门阈值（可调）：只警成片无钩死区，不规定钩子类型。仿 OPENING_RETENTION_THRESHOLDS。
 */
export declare const HOOK_CADENCE_THRESHOLDS: {
    readonly consecutive_none_warn: 3;
    readonly window_pad: 2;
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
export declare function checkHookCadence(merged: Array<Pick<ChapterOutlineItem, "chapter" | "end_hook">>, batchChapters: Set<number>): {
    warnings: string[];
};
/**
 * 开局 arc 爽点底线（确定性、阶段一，书级提交时调用）：覆盖第 1 章的 arc（开局 arc）
 * 必须至少 min_opening_payoff_beats 个书级 payoff_beats——否则阶段二章级 D-open-1 会逼出
 * 一个无 arc 出处的章级爽点，与「章级 payoff_beat 从 arc payoff_beats 落下」契约冲突
 * （S 档 payoff_beats_min_per_arc=0 对开局 arc 不适用；其它 arc 仍可遵 S 档 0）。
 * 补卷/不含开局 arc（无 chapter_start===1）的提交 → no-op。
 */
export declare function checkOpeningArcPayoff(payload: OutlinePayload): OutlineCheckResult;
export type PremiseCertainty = "canon" | "tentative" | "open";
export type PremiseCardKey = "genre_contract" | "core_hook" | "golden_finger" | "protagonist_desire" | "antagonistic_force" | "central_dramatic_question" | "world_rules" | "narrator_voice";
export interface PremiseField {
    key: string;
    value: string;
    certainty?: PremiseCertainty;
    note?: string;
}
export interface PremiseCard {
    card: PremiseCardKey;
    fields: PremiseField[];
}
export interface PremiseCardsPayload {
    cards: PremiseCard[];
}
/**
 * 立项卡语义核验：同一 card 不得重复提交（ajv 数组无法表达唯一性）。
 * 卡内 field.key 允许重复（如 narrator_voice 的多条 reference_example）。
 */
export declare function checkPremiseSemantics(payload: PremiseCardsPayload): ToolErrorItem[];
/**
 * 叙述人称受控校验。两层要求分开处理，防止「值域受控」被任何写入路径架空：
 *  - 值域合法性【无条件】：只要提交的 narrator_voice 卡含 address，其 value 必须属受控值域
 *    NARRATOR_ADDRESS_VALUES（certainty='open' 有意留白除外）——定点修订（merge_cards）也不许
 *    写自由文本（如 "第三人称"）。修订正是改人称的预期路径，绝不能成为绕过受控值域的口子。
 *  - 存在性【仅 requirePresence】：narrator_voice 卡 + address 字段必须存在。全量立项
 *    （novel_submit_premise 的 merge_cards !== true）要求；定点修订只提交目标卡、payload 不带
 *    narrator_voice 属正常 → 豁免，不惩罚存量未填人称的小说（#297 方案 E）。
 */
export declare function checkNarratorAddress(payload: PremiseCardsPayload, opts?: {
    requirePresence?: boolean;
}): ToolErrorItem[];
/**
 * 校验 DialogueSamples（台词语料提交参数）。
 * 对应 novel_submit_dialogue_samples 工具入口；schema 在 schemas/dialogue-samples.json。
 */
export declare function validateDialogueSamples(value: unknown): ValidationResult;
interface StateVocabularyDimensionPayload {
    key: string;
    predicate: string;
    display_name: string;
    cardinality: "one" | "many";
    value_type: "enum" | "free";
    values?: string[];
}
interface StateVocabularyPayload {
    dimensions: StateVocabularyDimensionPayload[];
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
export declare function checkStateVocabularySemantics(payload: StateVocabularyPayload): ToolErrorItem[];
/** 成稿字数告警线：实际字数低于目标的该比例即告警 */
export declare const WORD_COUNT_WARN_RATIO = 0.7;
export interface WordCountShortfall {
    actual: number;
    target: number;
    /** actual / target，展示层自行取整 */
    ratio: number;
}
/** 无目标（缺失 / null / 非正数）或达线返回 null；低于告警线返回缺口数据 */
export declare function checkChapterWordCount(actual: number, target: number | null | undefined): WordCountShortfall | null;
export {};
