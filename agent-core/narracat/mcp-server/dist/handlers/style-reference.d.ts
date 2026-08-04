/**
 * novel_query_style_reference 工具实现
 *
 * 从 novel-style-reference 语料库中按写作手法 + 情感氛围组合检索真人写作范例。
 * 此工具不依赖小说记忆数据库，直接读取 JSON 语料文件到内存索引。
 */
import type { ToolContext } from "../types.js";
export declare function novelQueryStyleReference(args: Record<string, unknown>, _ctx: ToolContext): Promise<unknown>;
