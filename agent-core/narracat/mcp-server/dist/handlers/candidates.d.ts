/**
 * 候选角色池工具实现（2 个）
 *
 * ADR-0015 渐进生长「内容实例层」：plan/write 期引入未建档角色时，作者可选「留作候选」，
 * 角色进候选角色池——不强制完整设定、不打断创作流。落盘即铸定 character_uid
 * （CharacterReference 契约），将来正式建档（/world）时复用同一 UID。
 *
 * - novel_register_candidate_character（写）：入候选池 / 标记已建档（promote）
 * - novel_list_candidate_characters（读）：列候选清单（供主会话识别新角色、App 渲染）
 *
 * 候选角色不入 facts / character_cards（无设定可入），与已出场角色的记忆体系隔离。
 */
import type { ToolContext } from "../types.js";
/**
 * novel_register_candidate_character —— 入候选池或标记已建档。
 *
 * name 必填；character_uid 可选（缺省自动铸造 lowercase UUID v4，与 novel_mint_character_uid 一致），
 * 便于建档时按 UID 复用同一身份。重复 UID upsert：更新 name/note/proposed_chapter/status。
 * status='promoted' 表示该候选已转为正式角色档案（/world 建档后回写），从候选清单淡出。
 */
export declare function novelRegisterCandidateCharacter(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
/**
 * novel_list_candidate_characters —— 列候选角色清单。
 *
 * 默认只列 status='candidate'（待出场）；status='promoted' 列已建档的；status='all' 列全部。
 * 供主会话在 plan/write 期识别「这名字是不是已留过候选/别名」，供 App 渲染候选池入口。
 */
export declare function novelListCandidateCharacters(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
