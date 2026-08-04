#!/usr/bin/env node
/**
 * NovelMemory MCP Server
 *
 * 嵌入式 SQLite 引擎，专为中文长篇小说记忆管理设计。
 * 对上暴露 52 个小说专用 MCP 工具（SSOT 见 tools.ts），
 * 对下使用 better-sqlite3 进程内存储。
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { createLazyToolRunner, createToolContext, runStartupBackfills, TOOL_DEFINITIONS } from "./core.js";
const server = new Server({
    name: "novel-memory",
    version: "4.0.7",
}, {
    capabilities: {
        tools: {},
    },
});
const runner = createLazyToolRunner({ createContext: () => createToolContext() });
/**
 * tools/list handler —— 返回所有工具定义（TOOL_DEFINITIONS 即 SSOT，数量以其为准）
 */
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));
/**
 * tools/call handler —— 交由 core.ts runTool 统一信封分发
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const { text, isError } = await runner.runTool(name, args ?? {});
    return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
});
/**
 * 启动 MCP Server，使用 stdio 传输
 */
async function main() {
    // 1. 加载项目配置、初始化数据库并跑启动期契约 backfill
    try {
        const ctx = await runner.getContext();
        await runStartupBackfills(ctx);
        console.error(`[NovelMemory] MCP Server 就绪 (novel_id: ${ctx.novelId})`);
    }
    catch (error) {
        // 配置加载失败不阻止启动（可能 init 尚未运行），工具调用时再报错
        console.error(`[NovelMemory] MCP Server 已启动（警告: ${error instanceof Error ? error.message : String(error)}）`);
    }
    // 2. 连接 stdio 传输
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error("NovelMemory MCP Server 启动失败:", error);
    process.exit(1);
});
