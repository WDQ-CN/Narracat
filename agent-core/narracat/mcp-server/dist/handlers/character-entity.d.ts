/**
 * 角色实体与状态词表写入口（world-curator 持有）
 *
 * novel_submit_state_vocabulary：ajv 校验 → 写 bible/state-vocabulary.json（每书一份，覆盖式）。
 * novel_submit_character_entity：ajv + 词表值域校验 → 写 bible/characters/<name>.json（出生证）；
 *   机械同步 md 顶部 character_identity 注释与「别名:」行；initial_states 入 source=authored facts；
 *   候选池 uid 命中回写 promoted；刷新该角色状态卡。
 * novel_submit_authored_state：作者对角色结构化状态的直接修订（App 确定性直调，不进 agent 工具面）。
 *   五 action：set_current 钦定当前值 / backfill 补录历史 / correct 纠错改历史（失效链审计）/
 *   retract 作废记录 / endorse 把抽取记录背书为作者确认。
 * 文件即真相：json 是可导出受控数据；逐章演变仍走 facts。
 */
import type { ToolContext } from "../types.js";
export declare function novelSubmitStateVocabulary(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelSubmitCharacterEntity(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
export declare function novelSubmitAuthoredState(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
