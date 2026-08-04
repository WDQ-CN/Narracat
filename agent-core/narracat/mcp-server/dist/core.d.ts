import type { SqliteDriver } from "./database.js";
import type { ToolHandler, ToolContext } from "./types.js";
export { TOOL_DEFINITIONS } from "./tools.js";
export type { ToolDefinition } from "./tools.js";
export type { SqliteDriver } from "./database.js";
export declare const TOOL_HANDLERS: Record<string, ToolHandler>;
/**
 * 统一错误码体系
 * 所有结构化错误响应均附带 error_code 供日志分析和故障排查
 */
export declare const ERROR_CODES: {
    readonly UNKNOWN_TOOL: "ERR_TOOL_001";
    readonly CONFIG_LOAD_FAIL: "ERR_DB_001";
    readonly HANDLER_ERROR: "ERR_TOOL_002";
    readonly STARTUP_FAIL: "ERR_DB_002";
};
export interface CreateToolContextOptions {
    /** config.yaml 路径；缺省沿用 env NOVEL_CONFIG_PATH（stdio 壳既有语义） */
    configPath?: string;
    /** 聊天只读滤网；缺省沿用 env NARRACAT_CHAT_SECRET_FILTER（stdio 壳既有语义） */
    secretFilter?: boolean;
    /** sqlite 驱动注入：utilityProcess 传 Electron-ABI 构建；缺省用本包 node_modules 的 node-ABI 构建 */
    sqliteDriver?: SqliteDriver;
}
/** 读配置 + 打开数据库，组装工具上下文（原 index.ts buildToolContext 的参数化版）。 */
export declare function createToolContext(options?: CreateToolContextOptions): Promise<ToolContext>;
export interface RunToolResult {
    /** 面向模型的 JSON 文本（成功 = 结果原文；失败 = {status:"error",…} 信封），两个壳原样投递 */
    text: string;
    isError: boolean;
}
export type RunToolLogger = (line: string) => void;
/** 统一调用信封：未知工具 / 配置加载失败 / 处理器异常 / 成功四分支，与原 index.ts CallTool handler 逐分支对齐（含结构化日志字段）。 */
export declare function runTool(name: string, args: Record<string, unknown>, getContext: () => Promise<ToolContext>, log?: RunToolLogger): Promise<RunToolResult>;
export interface CreateLazyToolRunnerOptions {
    createContext: () => Promise<ToolContext>;
    log?: RunToolLogger;
}
/** 惰性上下文 runner：首调构建 ToolContext 并 memoize，失败不缓存（下次重试，对齐原 index.ts toolContext 变量语义）。 */
export declare function createLazyToolRunner(options: CreateLazyToolRunnerOptions): {
    runTool(name: string, args: Record<string, unknown>): Promise<RunToolResult>;
    getContext(): Promise<ToolContext>;
};
/** 启动期契约 backfill：三个文件契约逐个 try/catch（原 index.ts main() 语义），向量 backfill 后台跑不 await。 */
export declare function runStartupBackfills(ctx: ToolContext, log?: RunToolLogger): Promise<void>;
