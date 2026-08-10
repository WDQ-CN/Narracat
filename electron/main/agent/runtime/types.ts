import type { AppConfig } from '@shared/types/config'
import type { AgentEvent } from '@shared/types/agent'

/**
 * 一次 run 的运行时无关组装入参：现 CreateSdkOptionsArgs（sdk-runner.ts）字段平移改名。
 * runtime 专属字段（systemPrompt/canUseTool/agents）刻意留 unknown——对上层不透明，由各 adapter
 * 自己在实现内部转回具体 runtime 类型（如 Claude SDK 的 Options['systemPrompt']/CanUseTool/
 * AgentDefinition），阶段 2 的 Pi adapter 复用同一形状即可接不同的具体类型。
 */
export interface RuntimeRunConfig {
  config: AppConfig
  apiKey: string
  abortController: AbortController
  appRoot: string
  resourcesPath?: string
  /** userData 根目录：注入 NovelMemory spawn env 的 NARRACAT_USER_PACKS_DIR，由 IPC 层注入。 */
  userDataPath?: string
  loadNarraCatRuntime?: boolean
  projectPath?: string
  maxTurns?: number
  systemPrompt?: unknown
  allowedTools?: string[]
  disallowedTools?: string[]
  canUseTool?: unknown
  /**
   * 作者要求 + 散文覆盖组装出的 Agent 覆盖（assembleAgentSkills 产物）。同名整体覆盖引擎默认
   * agent 定义（非字段合并），无覆盖的 agent 不进这个 record、维持引擎默认。Skill 挂载体系已退役，
   * 这里不再有挂载相关内容。
   */
  agents?: Record<string, unknown>
  /** 续接既有 runtime 会话：传该会话此前经 readSessionId 读到的 session id（resumed-command 路径用）。 */
  resume?: string
}

export interface RuntimeSandboxRunConfig extends RuntimeRunConfig {
  /** 沙盒收窄参数（学习会话 / 向导会话同款纪律）：收紧 tools 白名单 + 单目录 additionalDirectories。 */
  sandbox: {
    tools: string[]
    workspaceDir: string
  }
}

/**
 * 运行时中立的工具权限契约：permissions/can-use-tool.ts 用它实现权限桥，claude-sdk 与 pi 两个
 * adapter 共用。字段是 SDK CanUseTool/PermissionResult 的严格子集（结构化赋值兼容，claude-sdk
 * adapter 内有编译期断言钉住），pi 侧由 tool_call guard 映射工具名后直接调用。
 */
export type RuntimePermissionDecision = 'user_temporary' | 'user_permanent' | 'user_reject'

export type RuntimePermissionResult =
  | {
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      toolUseID?: string
      decisionClassification?: RuntimePermissionDecision
    }
  | {
      behavior: 'deny'
      message: string
      toolUseID?: string
      decisionClassification?: RuntimePermissionDecision
    }

export interface RuntimeCanUseToolOptions {
  signal: AbortSignal
  toolUseID: string
}

export type RuntimeCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: RuntimeCanUseToolOptions,
) => Promise<RuntimePermissionResult>

/** runtime 原生消息 → App 归一化事件时需要的上下文（现 event-mapper 的 SdkMessageMapContext 平移）。 */
export interface RuntimeMapContext {
  runId: string
  messageId: string
  createdAt: string
  skipAssistantMessageContent?: boolean
}

/** startRun 的入参：prompt + 同一 adapter 的 createRunOptions/createSandboxedRunOptions 产物（对上层不透明）。 */
export interface RuntimeStartRunArgs {
  prompt: string | AsyncIterable<unknown>
  options: unknown
}

/**
 * 一个可插拔的 Agent 运行时（阶段 1 只有 claude-sdk 一个实现，阶段 2 追加 pi）。run-manager 等消费点
 * 只经这个接口驱动 run，不直接触碰任何具体 runtime 的 SDK 类型/包。
 */
export interface AgentRuntimeAdapter {
  readonly id: 'claude-sdk' | 'pi'
  /** 组装本 runtime 的 run 选项（对上层不透明，原样传回 startRun）。纯 Promise（非 `unknown |
   * Promise<unknown>`——那个 union 在 TS 里塌成 `unknown`，对"必须 await"零约束，调用点漏 await
   * 编译期查不出来）：claude-sdk 实现内部组装仍同步，只是包一层 async 恒定返回 Promise；pi 实现
   * 需要先异步装载 NovelMemory 工具定义（切片⑥），两个实现现在对上层是同一种契约，调用方一律 await。 */
  createRunOptions(args: RuntimeRunConfig): Promise<unknown>
  createSandboxedRunOptions(args: RuntimeSandboxRunConfig): Promise<unknown>
  /** 启动一次 run，产出 runtime 原生消息流（run-manager 现有 nextWithIdleTimeout 直接消费）。 */
  startRun(args: RuntimeStartRunArgs): AsyncIterable<unknown>
  /** runtime 原生消息 → App 归一化事件（现 event-mapper 语义整体挪入）。 */
  mapMessage(message: unknown, ctx: RuntimeMapContext): AgentEvent[]
  readSessionId(message: unknown): string | undefined
}
