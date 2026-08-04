/**
 * NovelMemory utilityProcess RPC 契约（主进程 host ↔ memory worker）。
 * 工具 I/O 本就是 JSON 契约（引擎 tools.ts SSOT），此处只定义信封，不为 52 个工具逐个建 I/O 类型。
 */

/** 单次工具调用结果：text = 面向模型的 JSON 文本（引擎 runTool 信封原文），两条 runtime 同构投递。 */
export interface MemoryToolCallResult {
  text: string
  isError: boolean
}

export interface MemoryToolCallRequest {
  type: 'tool-call'
  id: number
  /** 引擎工具名（novel_* 裸名，不带 mcp__ 前缀） */
  tool: string
  args: Record<string, unknown>
}

export type MemoryWorkerInbound = MemoryToolCallRequest

/** worker 级伪工具（拆旧刀5 前置）：不进引擎工具表，由 memory-worker 入口拦截——进程内直调引擎
 * embedding 自检（sqlite 注入式），复用 tool-call 信道零协议改动；text=EmbeddingSelfTestReport JSON。 */
export const MEMORY_EMBEDDING_SELFTEST_TOOL = '__embedding_selftest__'

export type MemoryWorkerOutbound =
  | { type: 'ready' }
  /** worker 启动期致命错误（core 加载失败等）：host 收到后废弃该进程 */
  | { type: 'fatal'; error: string }
  | { type: 'tool-result'; id: number; text: string; isError: boolean }
  /** RPC 层故障（runTool promise 意外 reject；工具语义错误走 tool-result.isError） */
  | { type: 'tool-failure'; id: number; error: string }
