/**
 * 测试专用 SDK-like runtime adapter fixture（拆旧刀5，仅 run-manager.test.ts 消费，不进生产路径）。
 *
 * claude-sdk adapter 已整体删除（pi 成为唯一生产 runtime），但 run-manager 的测试基座建立在
 * 「假消息流用 SDK 原始形状（system/assistant/result…）」之上——run-manager 本体只经
 * AgentRuntimeAdapter 接口消费（startRun→mapMessage→AgentEvent），测试验证的是编排行为而非 SDK。
 * 本文件自包含地复刻旧 claude-sdk adapter 中「测试实际用到的那部分」行为，逐字段一致，参考：
 *   git show last-claude-sdk:electron/main/agent/runtime/adapters/claude-sdk/event-mapper.ts
 *   git show last-claude-sdk:electron/main/agent/runtime/adapters/claude-sdk/sdk-runner.ts
 *   git show last-claude-sdk:electron/main/agent/runtime/adapters/claude-sdk/headless-agent-runtime.ts
 *   git show last-claude-sdk:electron/main/agent/runtime/adapters/claude-sdk/index.ts
 *
 * 刻意不复刻的部分（测试假流不产生这些形状）：tool_use/tool_result/tool_progress/tool_use_summary
 * 映射、thinking/reasoning 映射、TodoWrite task-plan、打包档 headless runtime 解析（测试从不传
 * resourcesPath）、env 组装中 NOVEL_CONFIG_PATH 以外的字段（断言用 toMatchObject 只看该字段）。
 */
import { existsSync } from 'node:fs'
import { basename, delimiter, join } from 'node:path'
import { resolvePrimaryModel } from '@shared/lib/model-slots'
import type { AgentEvent, AgentTokenUsage } from '@shared/types/agent'
import type {
  AgentRuntimeAdapter,
  RuntimeMapContext,
  RuntimeRunConfig,
  RuntimeSandboxRunConfig,
} from '../runtime/types'
import { DEFAULT_ALLOWED_TOOLS, NARRACAT_NOVEL_MEMORY_MCP_SERVER_NAME } from '../runtime/allowed-tools'
import { resolveNarraCatEngine } from '../../engine/engine'

const DEFAULT_MAX_TURNS = 12

type UnknownRecord = Record<string, unknown>
type FileExists = (path: string) => boolean

// ---------------------------------------------------------------------------
// 类型：旧测试经 SDK Options 访问的字段面（RunClaudeAgentQueryArgs 的本地等价物）
// ---------------------------------------------------------------------------

export interface SdkLikeToolPermissionContext {
  signal: AbortSignal
  toolUseID: string
  /** 旧 SDK CanUseTool 的 options 含 title；run-manager 的权限桥忽略它，测试沿用旧调用形状。 */
  title?: string
}

export type SdkLikeCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  context: SdkLikeToolPermissionContext,
) => Promise<unknown>

export interface SdkLikeMcpServerConfig {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

/** 旧 createSdkOptions 产物中被测试断言触及的字段子集（形状与旧 SDK Options 逐字段一致）。 */
export interface SdkLikeRunOptions {
  abortController: AbortController
  additionalDirectories: string[]
  allowedTools: string[]
  cwd: string
  maxTurns: number
  model: string
  persistSession: boolean
  /** 沙盒收窄专用（createSandboxedRunOptions 覆盖），run-manager.test 不触及。 */
  tools?: string[]
  plugins?: Array<{ type: 'local'; path: string }>
  mcpServers?: Record<string, SdkLikeMcpServerConfig>
  systemPrompt?: unknown
  disallowedTools?: string[]
  canUseTool?: SdkLikeCanUseTool
  agents?: Record<string, unknown>
  resume?: string
}

/** 旧 RunClaudeAgentQueryArgs 的本地等价物（prompt 形状同 RuntimeStartRunArgs）。 */
export interface SdkLikeStartRunArgs {
  prompt: string | AsyncIterable<unknown>
  options: SdkLikeRunOptions
}

// ---------------------------------------------------------------------------
// 旧 headless-agent-runtime.ts：dev 档 node 可执行文件解析（逐行复刻，测试从不走打包档）
// ---------------------------------------------------------------------------

function isNodeExecutablePath(path: string): boolean {
  return basename(path).toLowerCase() === 'node'
}

export function resolveDevelopmentHeadlessAgentRuntimeExecutablePath({
  env = process.env,
  fileExists = existsSync,
  processExecutablePath = process.execPath,
}: {
  env?: NodeJS.ProcessEnv
  fileExists?: FileExists
  processExecutablePath?: string
} = {}): string {
  const candidates = [env.NARRACAT_AGENT_RUNTIME_NODE, env.npm_node_execpath, processExecutablePath]
  const explicitNodeCandidate = candidates.find((candidate): candidate is string => {
    if (!candidate?.trim()) return false
    return isNodeExecutablePath(candidate)
  })
  if (explicitNodeCandidate) return explicitNodeCandidate

  const pathNodeCandidate = env.PATH?.split(delimiter)
    .filter((pathSegment) => pathSegment.trim())
    .map((pathSegment) => join(pathSegment, 'node'))
    .find((candidate) => fileExists(candidate))
  return pathNodeCandidate ?? processExecutablePath
}

// ---------------------------------------------------------------------------
// 旧 sdk-runner.ts createSdkOptions / createSandboxedSdkOptions：被断言触及的字段子集
// ---------------------------------------------------------------------------

function uniqueNonEmptyPaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path?.trim())))]
}

function buildSdkLikeRunOptions(args: RuntimeRunConfig): SdkLikeRunOptions {
  const {
    config,
    abortController,
    appRoot,
    resourcesPath,
    loadNarraCatRuntime = true,
    projectPath,
    maxTurns = DEFAULT_MAX_TURNS,
    systemPrompt,
    allowedTools = DEFAULT_ALLOWED_TOOLS,
    disallowedTools,
    canUseTool,
    agents,
    resume,
  } = args

  const agentCorePath = resolveNarraCatEngine({ appRoot, resourcesPath }).agentCorePath
  const options: SdkLikeRunOptions = {
    abortController,
    additionalDirectories: uniqueNonEmptyPaths([agentCorePath, config.novelRootDir, projectPath]),
    allowedTools,
    cwd: projectPath ?? appRoot,
    maxTurns,
    model: resolvePrimaryModel(config)?.modelId ?? '',
    persistSession: true,
  }

  if (loadNarraCatRuntime) {
    options.plugins = [{ type: 'local', path: agentCorePath }]
    if (projectPath) {
      options.mcpServers = {
        [NARRACAT_NOVEL_MEMORY_MCP_SERVER_NAME]: {
          type: 'stdio',
          command: resolveDevelopmentHeadlessAgentRuntimeExecutablePath(),
          args: [join(agentCorePath, 'mcp-server', 'dist', 'index.js')],
          env: { NOVEL_CONFIG_PATH: join(projectPath, '.narracat', 'config.yaml') },
        },
      }
    }
  }

  if (systemPrompt) options.systemPrompt = systemPrompt
  if (disallowedTools && disallowedTools.length > 0) options.disallowedTools = disallowedTools
  if (canUseTool) options.canUseTool = canUseTool as SdkLikeCanUseTool
  if (agents && Object.keys(agents).length > 0) options.agents = agents
  if (resume) options.resume = resume

  return options
}

// ---------------------------------------------------------------------------
// 旧 event-mapper.ts：测试假流用到的消息形状 → AgentEvent（相关分支逐字段复刻）
// ---------------------------------------------------------------------------

const SDK_RESULT_ERROR_SUBTYPES = new Set([
  'error_during_execution',
  'error_max_turns',
  'error_max_budget_usd',
  'error_max_structured_output_retries',
])

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function readNumber(record: UnknownRecord, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

function mapTokenUsage(value: unknown): AgentTokenUsage | undefined {
  if (!isRecord(value)) return undefined

  const usage: AgentTokenUsage = {}
  const inputTokens = readNumber(value, 'input_tokens')
  const outputTokens = readNumber(value, 'output_tokens')
  const cacheReadTokens = readNumber(value, 'cache_read_input_tokens')
  const cacheCreationTokens = readNumber(value, 'cache_creation_input_tokens')

  if (inputTokens !== undefined) usage.inputTokens = inputTokens
  if (outputTokens !== undefined) usage.outputTokens = outputTokens
  if (cacheReadTokens !== undefined) usage.cacheReadTokens = cacheReadTokens
  if (cacheCreationTokens !== undefined) usage.cacheCreationTokens = cacheCreationTokens

  return Object.keys(usage).length > 0 ? usage : undefined
}

function readResultError(message: UnknownRecord): string {
  if (message.subtype === 'error_max_turns') {
    return 'Agent 本次运行达到回合上限，请稍后重试或提高运行上限。'
  }

  if (typeof message.error === 'string' && message.error.trim()) return message.error

  if (Array.isArray(message.errors)) {
    const firstError = message.errors.find((error): error is string => typeof error === 'string' && Boolean(error.trim()))
    if (firstError) return firstError
  }

  return 'Claude SDK run failed.'
}

function mapAssistantMessage(context: RuntimeMapContext, message: UnknownRecord): AgentEvent[] {
  const sdkMessage = message.message
  if (!isRecord(sdkMessage) || !Array.isArray(sdkMessage.content)) return []

  return sdkMessage.content.flatMap((contentBlock): AgentEvent[] => {
    if (!isRecord(contentBlock)) return []

    if (!context.skipAssistantMessageContent && contentBlock.type === 'text' && typeof contentBlock.text === 'string') {
      return [
        {
          type: 'message.delta',
          runId: context.runId,
          messageId: context.messageId,
          text: contentBlock.text,
          createdAt: context.createdAt,
        },
      ]
    }

    return []
  })
}

function mapStreamEventMessage(context: RuntimeMapContext, message: UnknownRecord): AgentEvent[] {
  const event = message.event
  if (!isRecord(event)) return []

  if (event.type === 'content_block_delta' && isRecord(event.delta)) {
    const delta = event.delta
    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      return [
        {
          type: 'message.delta',
          runId: context.runId,
          messageId: context.messageId,
          text: delta.text,
          createdAt: context.createdAt,
        },
      ]
    }
  }

  return []
}

function mapSystemMessage(context: RuntimeMapContext, message: UnknownRecord): AgentEvent[] {
  if (message.subtype !== 'local_command_output') return []

  const content = readString(message, 'content')?.trim()
  if (!content) return []

  return [
    {
      type: 'message.delta',
      runId: context.runId,
      messageId: context.messageId,
      text: content,
      createdAt: context.createdAt,
    },
  ]
}

function mapResultMessage(context: RuntimeMapContext, message: UnknownRecord): AgentEvent[] {
  if (message.subtype === 'success') {
    const usage = mapTokenUsage(message.usage)
    const events: AgentEvent[] = []
    const finalText = readString(message, 'result')?.trim()

    if (finalText && !context.skipAssistantMessageContent) {
      events.push({
        type: 'message.delta',
        runId: context.runId,
        messageId: context.messageId,
        text: finalText,
        createdAt: context.createdAt,
      })
    }

    const completedEvent: AgentEvent = {
      type: 'run.completed',
      runId: context.runId,
      createdAt: context.createdAt,
    }

    if (usage) completedEvent.usage = usage
    events.push(completedEvent)
    return events
  }

  if (typeof message.subtype === 'string' && SDK_RESULT_ERROR_SUBTYPES.has(message.subtype)) {
    return [
      {
        type: 'run.failed',
        runId: context.runId,
        error: readResultError(message),
        // 机器可读终态（拆旧刀2）：回合上限截断不是死刑，消费方靠它分流。
        ...(message.subtype === 'error_max_turns' ? { reason: 'max-turns' as const } : {}),
        createdAt: context.createdAt,
      },
    ]
  }

  return []
}

function mapSdkLikeMessageToAgentEvents(context: RuntimeMapContext, message: unknown): AgentEvent[] {
  if (!isRecord(message)) return []

  if (message.type === 'assistant') return mapAssistantMessage(context, message)
  if (message.type === 'stream_event') return mapStreamEventMessage(context, message)
  if (message.type === 'system') return mapSystemMessage(context, message)
  if (message.type === 'result') return mapResultMessage(context, message)

  return []
}

// ---------------------------------------------------------------------------
// adapter 组装（旧 index.ts createClaudeSdkAdapter 的测试等价物）
// ---------------------------------------------------------------------------

/** 从 runtime 原生消息读 session_id：旧 readSdkSessionId 逐行复刻。 */
function readSdkLikeSessionId(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined
  return typeof message.session_id === 'string' && message.session_id ? message.session_id : undefined
}

export function createSdkLikeTestAdapter(): AgentRuntimeAdapter {
  return {
    id: 'claude-sdk',
    async createRunOptions(args: RuntimeRunConfig): Promise<unknown> {
      return buildSdkLikeRunOptions(args)
    },
    async createSandboxedRunOptions(args: RuntimeSandboxRunConfig): Promise<unknown> {
      // 旧 createSandboxedSdkOptions：其余字段与 createRunOptions 逐字等价，只收窄两项。
      const { sandbox, ...rest } = args
      const options = buildSdkLikeRunOptions(rest)
      options.tools = sandbox.tools
      options.additionalDirectories = [sandbox.workspaceDir]
      return options
    },
    startRun(): AsyncIterable<unknown> {
      throw new Error('createSdkLikeTestAdapter 的 startRun 必须由测试替身覆盖（见 fakeRuntime）')
    },
    mapMessage(message: unknown, ctx: RuntimeMapContext): AgentEvent[] {
      return mapSdkLikeMessageToAgentEvents(ctx, message)
    },
    readSessionId(message: unknown): string | undefined {
      return readSdkLikeSessionId(message)
    },
  }
}
