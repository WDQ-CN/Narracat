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
import type { ToolContext } from "../types.js";
/** 检测所需的 facts 投影（从 facts 表查有效行传入） */
export interface ConflictFactRow {
    id: string;
    subject: string;
    subject_character_uid: string | null;
    subject_character_b_uid: string | null;
    predicate: string;
    object: string;
    from_chapter: number;
    event_chapter: number | null;
}
export type ConflictType = "state_divergence" | "revival" | "relationship_divergence";
export interface Conflict {
    type: ConflictType;
    subject: string;
    predicate?: string;
    chapter?: number;
    detail: string;
    facts: Array<{
        id: string;
        object: string;
        chapter: number;
        from_chapter: number;
    }>;
}
/**
 * 检出有效 facts 间的潜在冲突。
 * @param opts.chapter 给定则只保留发生在该章的冲突
 */
export declare function detectConflicts(facts: ConflictFactRow[], opts?: {
    chapter?: number;
}): Conflict[];
/** 机械渲染可读冲突报告 */
export declare function renderConflictReport(conflicts: Conflict[]): string;
export declare function novelDetectConflicts(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
