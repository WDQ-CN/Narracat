import { getMemoryHostFor } from '../memory/index.ts'
import type { MemoryHost } from '../memory/memory-host.ts'

/**
 * 立项卡轻量写回（#276，ADR-0019 2026-06-15 细化）。
 *
 * App 主进程无 LLM 程序化调用 novel_submit_premise。确定度切换 / open 项补白这类无下游
 * 影响字段，App 已持有确定 payload，无需 LLM 中转——经引擎工具写入（保 ajv 校验 +
 * premise_cards 真相 + premise.md/json 机械渲染原子同步），符合 ADR-0014 写权限模型与
 * MEMORY_MCP_GUARD，不直碰 DB、不 fork 渲染。
 *
 * 拆旧刀3（#508）：弃一次性 spawn headless node 起 stdio MCP server，改走切片⑥的
 * getMemoryHost utilityProcess 通道（worker env 已含离线 embedding 模型 + 用户能力包目录）。
 * 不调 Anthropic API（引擎工具是本地 SQLite + 文件操作），故无需 apiKey / model。
 */

const NOVEL_SUBMIT_PREMISE_TOOL = 'novel_submit_premise'

/** PremiseCards 顶层 payload；main 只透传，不解释结构（结构归 schemas/premise-cards.json）。 */
export interface PremiseCardsPayload {
  cards: unknown[]
}

export interface SubmitPremiseInput {
  appRoot: string
  resourcesPath?: string
  userDataPath?: string
  projectPath: string
  payload: PremiseCardsPayload
}

export interface PremiseToolError {
  field?: string
  expected?: string
  actual?: string
  hint?: string
}

export interface SubmitPremiseResult {
  ok: boolean
  /** 工具 ajv / 语义校验失败时的结构化 errors（供 UI 反馈，遵 errors[].hint 自修） */
  errors?: PremiseToolError[]
  message?: string
}

/**
 * 解析引擎工具返回的文本信封（引擎 runTool 把 handler 返回值 JSON.stringify 成 text）：
 * - 成功：{ ok:true, ... }
 * - 校验失败：handler 正常 return errorResponse → { ok:false, errors }
 * - server 层异常：text 为错误对象/非 JSON 文本
 * 纯函数，便于单测。
 */
export function parseEngineToolResultText(text: string | undefined): SubmitPremiseResult {
  if (typeof text !== 'string' || !text) {
    return { ok: false, message: '立项卡写入未返回可解析结果。' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, message: text }
  }

  const record = parsed as { ok?: unknown; errors?: unknown; message?: unknown; error?: unknown }
  if (record?.ok === true) {
    return { ok: true, message: typeof record.message === 'string' ? record.message : undefined }
  }

  return {
    ok: false,
    errors: Array.isArray(record?.errors) ? (record.errors as PremiseToolError[]) : undefined,
    message:
      typeof record?.message === 'string'
        ? record.message
        : typeof record?.error === 'string'
          ? record.error
          : '立项卡写入失败。',
  }
}

/**
 * 兼容壳：解析 MCP stdio 形态的响应 `{ content:[{type:'text',text}], isError? }`。
 * 拆旧刀3 后生产路径直接吃 host RPC 的 text（parseEngineToolResultText）；本壳保留给
 * 既有测试与历史形态兼容。
 */
export function parsePremiseToolResult(raw: unknown): SubmitPremiseResult {
  const content = (raw as { content?: unknown })?.content
  const text =
    Array.isArray(content) &&
    content.find((part): part is { type: string; text: string } => {
      const candidate = part as { type?: unknown; text?: unknown }
      return candidate?.type === 'text' && typeof candidate?.text === 'string'
    })?.text

  return parseEngineToolResultText(typeof text === 'string' ? text : undefined)
}

/**
 * 经 memory host 程序化提交立项卡 payload（拆旧刀3：utilityProcess 通道，无子进程起落）。
 * 第 2 参为可注入 host（测试用），缺省取进程级单例。
 */
export async function submitPremiseCardsViaClient(
  input: SubmitPremiseInput,
  host?: MemoryHost,
): Promise<SubmitPremiseResult> {
  const resolvedHost =
    host ??
    getMemoryHostFor({ appRoot: input.appRoot, resourcesPath: input.resourcesPath, userDataPath: input.userDataPath })
  const result = await resolvedHost.callTool(input.projectPath, NOVEL_SUBMIT_PREMISE_TOOL, {
    // merge_cards=true：App 程序化写入只做定点信心标记 / 补白（非全新立项），按 card key
    // 并入现有真相、不丢卡；同时豁免「全量立项才强制」的叙述人称校验，避免存量未填人称的
    // 小说在标记其它卡确定度时被误拦（#297 方案 E）。
    payload: input.payload,
    merge_cards: true,
  })
  return parseEngineToolResultText(result.text)
}
