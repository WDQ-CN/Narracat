/**
 * 引擎 core dist（agent-core/narracat/mcp-server/dist/core.js）的动态 import 类型面。
 * 引擎侧 SSOT 是 mcp-server/src/core.ts——那边改导出签名，这里必须同步（App 与引擎无编译期共链，
 * 靠 Task 2 的契约 + memory-smoke 真打钉住）。
 */
export interface ToolContext {
  novelId: string
  projectRoot: string
}

export interface MemoryCoreRunToolResult {
  text: string
  isError: boolean
}

export interface MemoryCoreModule {
  createToolContext(options: { configPath: string; sqliteDriver: unknown; secretFilter?: boolean }): Promise<ToolContext>
  createLazyToolRunner(options: { createContext(): Promise<ToolContext> }): {
    runTool(name: string, args: Record<string, unknown>): Promise<MemoryCoreRunToolResult>
    getContext(): Promise<ToolContext>
  }
  /** 统一调用信封（core.ts runTool）：worker 侧配 config-mtime 失效的自管 getContext 使用 */
  runTool(
    name: string,
    args: Record<string, unknown>,
    getContext: () => Promise<ToolContext>,
  ): Promise<MemoryCoreRunToolResult>
  runStartupBackfills(ctx: ToolContext): Promise<void>
}
