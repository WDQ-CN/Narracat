/**
 * NovelMemory MCP Server - 工具定义
 *
 * 共 52 个工具：22 个读工具 + 22 个写工具 + 5 个状态工具（写 state.yaml，不写记忆库）+
 * 1 个身份工具 + 2 个造包中心工具（App 造包中心专用，agent 不得调用）。
 * 写工具入口 ajv + 语义校验，失败统一返回
 * { ok: false, errors: [{field, expected, actual, hint}] }，按 hint 修正后重试。
 */
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}
export declare const TOOL_DEFINITIONS: ToolDefinition[];
