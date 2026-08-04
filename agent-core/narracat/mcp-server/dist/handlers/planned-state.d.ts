/**
 * 章级计划状态变更：兑现比对 + 作者处置（A4×D2 片3 软兑现门）
 *
 * 账本分离：planned_state_changes 是计划账，facts 是事实账，两账无直接冲突面——
 * 兑现比对只做机械匹配（uid + 维度谓词 + 值精确 + 章号），不自动顺延不打回：
 * 挪后半章可能是合理节奏，未兑现只出报告卡交作者处置（软门，dogfood 攒误报率后再议硬化）。
 *
 * 两个工具：
 * - novel_check_state_delivery（主会话，write 收尾）：本章 planned 行逐条比对已落库 facts，
 *   命中机械落 delivered，未命中返回报告；
 * - novel_resolve_planned_state（App 确定性直调，不进 agent 工具面）：报告卡四动作落账
 *   defer（原行留审计+目标章新行）/ cancel / acknowledge / mark_delivered。
 */
import type { ToolContext } from "../types.js";
export interface MirrorEntry {
    character_uid: string;
    character_name: string;
    dimension: string;
    operation: "set" | "add" | "remove";
    value: string;
    reason: string | null;
}
/**
 * #448 镜像纪律（writers 提交与 App 编辑共用）：只清 planned 保处置历史。
 *
 * `dedupe` 无缺省值，两个调用点显式传，语义不同（PR#456 评审 F3 先例 + 终审 Fix 3a）：
 * - `'any-status'`——架构师重提交（writers.ts 提交路径）：同键任意状态既有行都跳过插入，
 *   防止重排把已处置（delivered/cancelled/…）的历史行悄悄复活成新 planned 行。
 * - `'planned-only'`——作者在账本区显式重加同键计划（novel_update_chapter_state_changes）：
 *   只看同键是否已有 planned 行去重，同键终态行（如 cancelled）不拦——那是历史账，
 *   作者这次显式意图应当成功入账，否则会出现 ok:true 却计划表无 planned 行的假成功。
 */
export declare function mirrorChapterPlannedState(db: ToolContext["db"], novelId: string, chapter: number, entries: MirrorEntry[], dedupe: "any-status" | "planned-only"): void;
/** 遍历 outline 下各 vol-NN 目录定位 ch-NNN.json（不依赖卷号入参；命名对齐 writers 写入侧）。 */
export declare function locateChapterOutlineFile(projectRoot: string, chapter: number): Promise<{
    jsonPath: string;
    mdPath: string;
} | null>;
/** 渲染上下文（同 writers 提交路径的两条查询）。 */
export declare function buildChapterRenderContext(ctx: ToolContext): {
    storylineNames: Map<string, string>;
    foreshadowingDescriptions: Map<string, string>;
};
export declare function novelCheckStateDelivery(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelResolvePlannedState(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
/**
 * 章纲计划状态变更整段替换（App 确定性直调，不进 agent 工具面）：作者在章纲卡编辑本章
 * state_changes——语义门与提交侧 checkStateChanges 同规，json+md+计划表由本工具协调写入
 * （文件先行+失败补偿，见 replaceOutlineFilesThenDb），CAS 防并发覆盖他人改动。
 */
export declare function novelUpdateChapterStateChanges(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
