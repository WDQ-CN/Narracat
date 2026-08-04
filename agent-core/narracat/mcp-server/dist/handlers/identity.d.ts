/**
 * 身份工具实现（1 个）
 *
 * novel_mint_character_uid —— Agent Core 为新角色铸造 canonical Character UID。
 * 角色设定由 LLM 主会话写 Markdown、prompt 内没有可靠 UUID 生成环境，
 * 故由本工具确定性铸造 lowercase UUID v4。无副作用、不入库。
 */
import type { ToolHandler } from "../types.js";
export declare const novelMintCharacterUid: ToolHandler;
