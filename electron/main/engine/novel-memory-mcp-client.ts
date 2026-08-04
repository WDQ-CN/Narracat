import type { Tool } from '@anthropic-ai/sdk/resources/messages'

import { resolveNarraCatEngine } from './engine.ts'
import { getMemoryHost } from '../memory/index.ts'
import type { MemoryHostPaths } from '../memory/index.ts'
import type { MemoryHost } from '../memory/memory-host.ts'
import { loadMemoryToolDefinitions } from '../memory/memory-tool-definitions.ts'

/**
 * NovelMemory 只读客户端（角色聊天「唠个嗑」专用）。
 *
 * 角色要按需查截至知识边界的角色状态/关系/章节记忆，但记忆系统未来会重构（issue #242）——
 * 所以记忆访问**必须**走引擎的工具契约（引擎是 SSOT），App 绝不直读 memory.db 复刻
 * 折叠/检索逻辑。这样 #242 改记忆内部时工具契约不变，角色聊天零改动。
 *
 * 拆旧刀3（#508）：弃一次性 spawn headless node 起 stdio MCP server，改走切片⑥的
 * getMemoryHost utilityProcess 通道——工具定义主进程本地就有（memory-tool-definitions，
 * 与 pi 注册同源），listTools 零 RPC；调用走 host.callTool。聊天代理档位
 * `chat-secret-filter`（片4 秘密滤网，env 进程级语义）由 host 按（项目, 档位）双键隔离。
 *
 * 边界铁律：
 * - 只暴露 4 个**只读**工具（白名单常量），绝不暴露任何写工具。
 * - **懒启动**：worker 由 host 惰性 fork，大多数闲聊轮不触发工具即零开销。
 * - close() 幂等 no-op：worker 是每（项目, 档位）长驻进程，生命周期归 host 管。
 */

/** 角色聊天只读工具白名单（4 个 NovelMemory 读查工具）。显式定义，确保绝不暴露写工具。 */
export const NOVEL_MEMORY_READONLY_TOOL_NAMES = [
  'novel_character_state',
  'novel_relationship',
  'novel_chapter_summary',
  'novel_query',
] as const

export type NovelMemoryReadonlyToolName = (typeof NOVEL_MEMORY_READONLY_TOOL_NAMES)[number]

const READONLY_TOOL_NAME_SET = new Set<string>(NOVEL_MEMORY_READONLY_TOOL_NAMES)

/** 只读客户端接口（真实现走 memory host；测试注入假后端）。 */
export interface NovelMemoryReadonlyMcpClient {
  /** 从引擎工具定义过滤出 4 个只读工具，返回 Anthropic tools 形态（schema 直接用引擎给的）。 */
  listReadonlyTools: () => Promise<Tool[]>
  /** 转发到记忆引擎调用工具，返回文本结果（白名单外的工具调用直接拒绝）。 */
  callTool: (name: string, input: Record<string, unknown>) => Promise<string>
  /** 幂等收尾（host 通道下为 no-op，保留接口供假后端/未来实现使用）。 */
  close: () => Promise<void>
}

export interface CreateNovelMemoryMcpClientArgs {
  projectPath: string
  appRoot: string
  resourcesPath?: string
  /** userData 根目录：host worker env 注入用户能力包目录（NARRACAT_USER_PACKS_DIR）。 */
  userDataPath?: string
}

/** 工厂签名：runner 用它懒启动客户端；测试注入假工厂。 */
export type NovelMemoryMcpClientFactory = (
  args: CreateNovelMemoryMcpClientArgs,
) => NovelMemoryReadonlyMcpClient

function toHostPaths(args: CreateNovelMemoryMcpClientArgs): MemoryHostPaths {
  return {
    appRoot: args.appRoot,
    resourcesPath: args.resourcesPath,
    userDataPath: args.userDataPath,
    agentCorePath: resolveNarraCatEngine({ appRoot: args.appRoot, resourcesPath: args.resourcesPath }).agentCorePath,
  }
}

/**
 * 真实现：经 memory host（utilityProcess）调用引擎工具。第 2 参为可注入 host（测试用），
 * 缺省取进程级单例。
 */
export const createNovelMemoryReadonlyMcpClient: NovelMemoryMcpClientFactory = (args, host?: MemoryHost) => {
  const paths = toHostPaths(args)

  return {
    async listReadonlyTools() {
      const definitions = await loadMemoryToolDefinitions(paths.agentCorePath)
      return definitions
        .filter((tool) => READONLY_TOOL_NAME_SET.has(tool.name))
        .map<Tool>((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Tool['input_schema'],
        }))
    },

    async callTool(name, input) {
      if (!READONLY_TOOL_NAME_SET.has(name)) {
        // 只读隔离硬边界：白名单外工具一律拒绝转发（绝不触达写工具）。
        throw new Error(`角色聊天禁止调用非只读工具：${name}`)
      }
      // 聊天代理档：秘密滤网 worker（未打标「本人已知晓」的 secret 事实对模型不可见，片4）。
      const result = await (host ?? getMemoryHost(paths)).callTool(args.projectPath, name, input, {
        profile: 'chat-secret-filter',
      })
      return result.text
    },

    async close() {
      // worker 归 host 管（长驻、跨调用复用），此处无连接可关。
    },
  }
}

/** `novel_character_statuses` 工具输出形态（statuses 只含有状态的 uid）。 */
interface NovelCharacterStatusesResult {
  ok?: boolean
  at_chapter?: number
  statuses?: Record<string, unknown>
}

export interface ReadCharacterStatusesViaEngineResources {
  appRoot: string
  resourcesPath?: string
  userDataPath?: string
}

/**
 * callTool `novel_character_statuses` → 文本 的最小客户端能力（真实现走 host；测试注入假后端）。
 */
export interface NovelCharacterStatusesMcpClient {
  /** 调引擎批量状态工具，返回工具文本结果。 */
  callTool: (args: Record<string, unknown>) => Promise<string>
  /** 幂等收尾（host 通道下为 no-op）。 */
  close: () => Promise<void>
}

/** 工厂签名：真实现走 host；测试注入假工厂验证回填与降级。 */
export type NovelCharacterStatusesMcpClientFactory = (
  args: CreateNovelMemoryMcpClientArgs,
) => NovelCharacterStatusesMcpClient

/** 真实现：经 memory host 直接 callTool `novel_character_statuses`（不走只读白名单转发——
 * 列表富化路径，只读 status 字段非 secret，用默认档 worker）。 */
export const createNovelCharacterStatusesMcpClient: NovelCharacterStatusesMcpClientFactory = (
  args,
  host?: MemoryHost,
) => {
  const paths = toHostPaths(args)

  return {
    async callTool(toolArgs) {
      const result = await (host ?? getMemoryHost(paths)).callTool(
        args.projectPath,
        'novel_character_statuses',
        toolArgs,
      )
      return result.text
    },
    async close() {
      // worker 归 host 管，此处无连接可关。
    },
  }
}

/**
 * 经引擎批量查多个角色截至某章的当前状态（走 NovelMemory `novel_character_statuses`）。
 *
 * 真相口径归引擎：App 不再直读 memory.db 复刻 facts/character_cards 折叠逻辑。任何失败
 * （worker / 工具 / 解析）一律降级返回**空 Map**——currentStatus 是联系人列表的可选富化字段，
 * 缺失不阻断列表渲染。
 *
 * 注意：这是**列表富化**路径，与角色聊天 runner 的只读隔离白名单无关——故意不经
 * createNovelMemoryReadonlyMcpClient 的白名单转发（该工具不在只读白名单内）。runner 路径
 * 永不调用本函数，零引擎开销、零付费。
 *
 * 第 5 参为可注入工厂（默认真 host）；测试注入假工厂验证回填与降级。
 */
export async function readCharacterStatusesViaEngine(
  projectPath: string,
  characterUids: string[],
  atChapter: number | null,
  resources: ReadCharacterStatusesViaEngineResources,
  createClient: NovelCharacterStatusesMcpClientFactory = createNovelCharacterStatusesMcpClient,
): Promise<Map<string, string>> {
  const statuses = new Map<string, string>()
  if (characterUids.length === 0) return statuses

  const client = createClient({
    projectPath,
    appRoot: resources.appRoot,
    resourcesPath: resources.resourcesPath,
    userDataPath: resources.userDataPath,
  })
  try {
    const toolArgs: Record<string, unknown> = { character_uids: characterUids }
    if (typeof atChapter === 'number' && Number.isInteger(atChapter) && atChapter >= 1) {
      toolArgs.at_chapter = atChapter
    }

    const text = await client.callTool(toolArgs)
    if (!text) return statuses

    const parsed = JSON.parse(text) as NovelCharacterStatusesResult
    const rawStatuses = parsed?.statuses
    if (rawStatuses && typeof rawStatuses === 'object') {
      for (const [uid, value] of Object.entries(rawStatuses)) {
        if (typeof value === 'string' && value.trim()) statuses.set(uid, value.trim())
      }
    }
    return statuses
  } catch {
    // worker / 工具 / 解析任何失败：降级空 Map（列表照常渲染，currentStatus 留 null）。
    return new Map<string, string>()
  } finally {
    try {
      await client.close()
    } catch {
      // ignore close failures
    }
  }
}
