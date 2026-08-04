// electron/main/novel/character-state-edit.ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getMemoryHostFor } from '../memory/index.ts'
import type { MemoryHost } from '../memory/memory-host.ts'
import { parseEngineToolResultText } from './premise-client.ts'
import { isSafeCharacterName } from './character-state.ts'
import { charactersDir } from './novel-layout.ts'

/**
 * 角色结构化状态第一档直存（A4×D2 片2b，spec §6.3）：App 不直写 memory.db 也不直写实体 json——
 * 写权限归引擎工具独占（ajv + 失效链 + 角色卡刷新都在引擎侧），App 经引擎工具确定性直调，
 * 零 LLM。拆旧刀3 起走 memory host utilityProcess 通道（同 master-outline-edit.ts）。
 *
 * 两个工具：
 * - novel_submit_authored_state：钦定/补录/纠错/作废/确认背书五 action（有意不在 agent 白名单，
 *   App 直调专用，见 sdk-runner.ts 注释与回归断言）；
 * - novel_submit_character_entity：出生证编辑（性别/年龄/别名）——覆盖式幂等，App 侧先读现档
 *   全量合并再提交，防止只传增量把未提字段抹掉。改名本片不开（artifact 导航翻新单独切片）。
 */

const AUTHORED_STATE_TOOL = 'novel_submit_authored_state'
const CHARACTER_ENTITY_TOOL = 'novel_submit_character_entity'

const ACTIONS = new Set(['set_current', 'backfill', 'correct', 'retract', 'endorse', 'mark_secret_known'] as const)
export type AuthoredStateAction = 'set_current' | 'backfill' | 'correct' | 'retract' | 'endorse' | 'mark_secret_known'

const OPERATIONS = new Set(['set', 'add', 'remove'] as const)
export type AuthoredStateOperation = 'set' | 'add' | 'remove'

/** 引擎 authored-state.json schema 的镜像子集：App 只装引擎认得的键（显式构造，不透传未知字段） */
export interface AuthoredStatePayload {
  character_uid: string
  action: AuthoredStateAction
  dimension?: string
  operation?: AuthoredStateOperation
  value?: string
  effective_chapter?: number
  target_fact_id?: string
  new_value?: string
  new_event_chapter?: number
  expected_current_value?: string
  /** mark_secret_known 专用：true=本人已知晓，false=撤销标记 */
  known?: boolean
  /** set_current/backfill 提交 secret 谓词维度时顺手声明「本人已知晓」 */
  secret_known?: boolean
}

export interface AuthoredStateEditRequest {
  projectPath: string
  payload: AuthoredStatePayload
}

function readOptionalChapter(raw: unknown, field: string): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) throw new Error(`${field} 须为不小于 0 的整数`)
  return raw
}

function readTrimmedString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * 纯函数：解析 IPC 入参，非法时抛 Error。只做「必填缺失早失败」，值域/时序/CAS 的最终门在引擎 ajv
 * 与 handler（App 报错文案给作者看，引擎报错取 errors[0].hint 透传）。
 */
export function parseAuthoredStateEditInput(input: unknown): AuthoredStateEditRequest {
  const raw = input as Record<string, unknown>
  const projectPath = readTrimmedString(raw?.projectPath)
  if (!projectPath) throw new Error('缺少项目路径')

  const rawPayload = (raw?.payload ?? {}) as Record<string, unknown>
  const characterUid = readTrimmedString(rawPayload.character_uid)
  if (!characterUid) throw new Error('缺少角色标识')
  const action = rawPayload.action
  if (typeof action !== 'string' || !ACTIONS.has(action as AuthoredStateAction)) throw new Error('不支持的编辑动作')

  const payload: AuthoredStatePayload = { character_uid: characterUid, action: action as AuthoredStateAction }

  if (action === 'set_current' || action === 'backfill') {
    const dimension = readTrimmedString(rawPayload.dimension)
    const value = readTrimmedString(rawPayload.value)
    const effectiveChapter = readOptionalChapter(rawPayload.effective_chapter, '生效章')
    if (!dimension) throw new Error('缺少状态维度')
    if (!value) throw new Error('状态值不能为空')
    if (effectiveChapter === undefined) throw new Error('缺少生效章')
    payload.dimension = dimension
    payload.value = value
    payload.effective_chapter = effectiveChapter
    if (rawPayload.operation !== undefined) {
      if (typeof rawPayload.operation !== 'string' || !OPERATIONS.has(rawPayload.operation as AuthoredStateOperation)) {
        throw new Error('不支持的维度操作')
      }
      payload.operation = rawPayload.operation as AuthoredStateOperation
    }
    if (action === 'set_current' && typeof rawPayload.expected_current_value === 'string') {
      payload.expected_current_value = rawPayload.expected_current_value
    }
    if (typeof rawPayload.secret_known === 'boolean') payload.secret_known = rawPayload.secret_known
    return { projectPath, payload }
  }

  // correct / retract / endorse / mark_secret_known：fact 锚定
  const targetFactId = readTrimmedString(rawPayload.target_fact_id)
  if (!targetFactId) throw new Error('缺少目标记录定位')
  payload.target_fact_id = targetFactId
  if (action === 'correct') {
    const newValue = readTrimmedString(rawPayload.new_value)
    const newEventChapter = readOptionalChapter(rawPayload.new_event_chapter, '发生章')
    if (!newValue && newEventChapter === undefined) throw new Error('修正需要新值或新发生章至少一项')
    if (newValue) payload.new_value = newValue
    if (newEventChapter !== undefined) payload.new_event_chapter = newEventChapter
  }
  if (action === 'mark_secret_known') {
    if (typeof rawPayload.known !== 'boolean') throw new Error('缺少知晓状态')
    payload.known = rawPayload.known
  }
  return { projectPath, payload }
}

/** App 直调面共用的 host 调用路径类型（拆旧刀3：userDataPath 供 worker env 注入用户能力包目录）。 */
export interface EngineToolPaths {
  appRoot: string
  resourcesPath?: string
  userDataPath?: string
}

/** 经 memory host 直调引擎写工具，零 LLM（供本文件与 planned-state-edit.ts 复用）。
 * 末参为可注入 host（测试用），缺省取进程级单例。 */
export async function callEngineTool(
  projectPath: string,
  toolName: string,
  payload: Record<string, unknown>,
  paths: EngineToolPaths,
  host?: MemoryHost,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const resolvedHost = host ?? getMemoryHostFor(paths)
    const raw = await resolvedHost.callTool(projectPath, toolName, { payload })
    const result = parseEngineToolResultText(raw.text)
    return result.ok
      ? { ok: true }
      : { ok: false, message: result.errors?.[0]?.hint ?? result.message ?? '保存失败。' }
  } catch (error) {
    console.error(`角色状态写入失败（${toolName}）`, error)
    return { ok: false, message: '保存失败，请稍后重试。' }
  }
}

/**
 * 引擎已明确给出校验/执行失败原因的「预期内」拒绝（isError / ok:false 语义路径）——message 已是
 * 较人话的文案（ajv hint / handler message），外层 catch 识别到这个类型后原样透传、不再套壳。
 */
class EngineToolRejectedError extends Error {}

/**
 * 经 memory host 直调只读/预演类引擎工具（造包中心 novel_pack_authoring_vocab/preview），
 * 返回原始解析结果——这两个工具是读工具，响应形状是工具自定义 payload（无 {ok,...} 写工具契约），
 * 故不复用 parseEngineToolResultText，也不把 arguments 包一层 {payload}（这两个工具的 handler 直接
 * 读顶层 args，与 payload 包裹类写工具不同约定）。
 * 任何失败一律抛人话 Error：isError/ok:false（引擎已给出的拒绝原因）原样透传；worker 故障/响应格式
 * 异常/JSON 解析失败这类「非预期」异常先 console.error 留痕原始错误（供真机踩坑排查），
 * 再抛通用人话文案——不能把进程级技术错误原样冒泡到 UI。
 */
export async function callEngineToolRaw(
  projectPath: string,
  toolName: string,
  args: Record<string, unknown>,
  paths: EngineToolPaths,
  host?: MemoryHost,
): Promise<unknown> {
  try {
    const resolvedHost = host ?? getMemoryHostFor(paths)
    const raw = await resolvedHost.callTool(projectPath, toolName, args)
    if (typeof raw.text !== 'string' || !raw.text) throw new Error(`${toolName} 未返回可解析结果。`)
    const parsed = JSON.parse(raw.text) as unknown
    const record = parsed as { ok?: unknown; message?: unknown; errors?: Array<{ hint?: string }> }
    if (raw.isError === true || record?.ok === false) {
      throw new EngineToolRejectedError(
        record?.errors?.[0]?.hint ?? (typeof record?.message === 'string' ? record.message : `${toolName} 执行失败。`),
      )
    }
    return parsed
  } catch (error) {
    if (error instanceof EngineToolRejectedError) throw error
    console.error(`造包中心引擎工具调用失败（${toolName}）`, error)
    throw new Error(`${toolName} 调用失败，请稍后重试。`)
  }
}

/** 经一次性 MCP client 调 novel_submit_authored_state（失效链/CAS/角色卡刷新归引擎）。 */
export async function submitAuthoredStateEdit(
  request: AuthoredStateEditRequest,
  paths: EngineToolPaths,
): Promise<{ ok: boolean; message?: string }> {
  return callEngineTool(request.projectPath, AUTHORED_STATE_TOOL, { ...request.payload }, paths)
}

// ---------------------------------------------------------------------------
// 出生证编辑（性别/年龄/别名）
// ---------------------------------------------------------------------------

export interface CharacterIdentityEditRequest {
  projectPath: string
  characterUid: string
  characterName: string
  /** 空串 = 清除该字段（提交时省略键） */
  gender: string
  age: string
  aliases: string[]
}

/** 纯函数：解析出生证编辑入参，非法时抛 Error。长度上限镜像引擎 character-entity.json。 */
export function parseCharacterIdentityEditInput(input: unknown): CharacterIdentityEditRequest {
  const raw = input as Record<string, unknown>
  const projectPath = readTrimmedString(raw?.projectPath)
  const characterUid = readTrimmedString(raw?.characterUid)
  const characterName = readTrimmedString(raw?.characterName)
  if (!projectPath) throw new Error('缺少项目路径')
  if (!characterUid) throw new Error('缺少角色标识')
  if (!isSafeCharacterName(characterName)) throw new Error('角色名不合法')

  const gender = readTrimmedString(raw?.gender)
  const age = readTrimmedString(raw?.age)
  if (gender.length > 8) throw new Error('性别最长 8 字')
  if (age.length > 20) throw new Error('年龄描述最长 20 字')

  const rawAliases = Array.isArray(raw?.aliases) ? raw.aliases : []
  const aliases = rawAliases.map((item) => readTrimmedString(item)).filter((item) => item.length > 0)
  if (aliases.length > 12) throw new Error('别名最多 12 个')
  if (aliases.some((item) => item.length > 20)) throw new Error('单个别名最长 20 字')

  return { projectPath, characterUid, characterName, gender, age, aliases }
}

/** 实体 json 里允许合并透传的键（引擎 schema additionalProperties:false，未知键会被 ajv 拒） */
const ENTITY_PASSTHROUGH_KEYS = ['effective_chapter', 'initial_states'] as const

/**
 * 纯函数：现档 + 编辑请求 → 覆盖式重提交 payload。身份三字段整体替换（空值省略键=清除），
 * 其余字段原样透传；uid 不匹配/档案不成形一律拒绝——出生证编辑不负责建档（建档归 world 流程）。
 */
export function mergeCharacterIdentityPayload(
  entity: unknown,
  request: CharacterIdentityEditRequest,
): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
    return { ok: false, message: '角色出生证档案缺失或损坏，无法编辑身份字段。' }
  }
  const record = entity as Record<string, unknown>
  if (record.character_uid !== request.characterUid) {
    return { ok: false, message: '档案身份不匹配，请刷新后重试。' }
  }

  const payload: Record<string, unknown> = {
    character_uid: request.characterUid,
    name: typeof record.name === 'string' && record.name ? record.name : request.characterName,
  }
  for (const key of ENTITY_PASSTHROUGH_KEYS) {
    if (record[key] !== undefined) payload[key] = record[key]
  }
  if (request.gender) payload.gender = request.gender
  if (request.age) payload.age = request.age
  if (request.aliases.length > 0) payload.aliases = request.aliases
  return { ok: true, payload }
}

/**
 * 出生证编辑：读现档 → 全量合并 → 经引擎覆盖式重提交（md 身份行由引擎机械同步）。
 * initial_states 随全量重提，引擎 dup 门会跳过已入账事实（world 整实体重提交语义）。
 */
export async function submitCharacterIdentityEdit(
  request: CharacterIdentityEditRequest,
  paths: EngineToolPaths,
): Promise<{ ok: boolean; message?: string }> {
  let entity: unknown = null
  try {
    entity = JSON.parse(
      await readFile(join(request.projectPath, charactersDir(), `${request.characterName}.json`), 'utf8'),
    )
  } catch {
    entity = null
  }
  const merged = mergeCharacterIdentityPayload(entity, request)
  if (!merged.ok) return { ok: false, message: merged.message }
  return callEngineTool(request.projectPath, CHARACTER_ENTITY_TOOL, merged.payload, paths)
}
