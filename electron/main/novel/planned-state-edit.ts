// electron/main/novel/planned-state-edit.ts
import { callEngineTool, type EngineToolPaths } from './character-state-edit.ts'

/**
 * 计划账写通道（A4×D2 片3b）：App 经一次性 MCP client 确定性直调引擎两个工具，零 LLM——
 * 写权限归引擎工具独占（CAS/语义门/json+md+计划表协调写入都在引擎侧），一次性 client 模式同
 * character-state-edit.ts。
 *
 * 两个工具：
 * - novel_resolve_planned_state：兑现报告卡四动作 defer/cancel/acknowledge/mark_delivered（有意
 *   不在 agent 白名单，处置权归作者，见 sdk-runner.ts 注释与回归断言）；
 * - novel_update_chapter_state_changes：章纲卡 state_changes 整段替换（CAS 防并发），条目字段级
 *   校验（uid/name/dimension/value 非空、值域、cardinality）交给引擎侧语义门，App 侧只做形状早失败。
 */

const RESOLVE_PLANNED_STATE_TOOL = 'novel_resolve_planned_state'
const UPDATE_CHAPTER_STATE_CHANGES_TOOL = 'novel_update_chapter_state_changes'

const RESOLVE_ACTIONS = new Set(['defer', 'cancel', 'acknowledge', 'mark_delivered'] as const)
export type ResolvePlannedStateAction = 'defer' | 'cancel' | 'acknowledge' | 'mark_delivered'

const STATE_CHANGES_MAX = 8

export interface ResolvePlannedStatePayload {
  id: string
  action: ResolvePlannedStateAction
  to_chapter?: number
}

export interface ResolvePlannedStateRequest {
  projectPath: string
  payload: ResolvePlannedStatePayload
}

/** 引擎工具的 state_changes 条目形状镜像（字段级值域校验交给引擎语义门，此处只做类型标注）。 */
export interface PlannedStateChangeEntry {
  character: { character_uid: string; name: string }
  dimension: string
  operation?: 'set' | 'add' | 'remove'
  value: string
  reason?: string
}

export interface UpdateChapterStateChangesPayload {
  chapter: number
  state_changes: PlannedStateChangeEntry[]
  expected_state_changes: unknown[]
}

export interface UpdateChapterStateChangesRequest {
  projectPath: string
  payload: UpdateChapterStateChangesPayload
}

function readTrimmedString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * 纯函数：解析计划处置 IPC 入参，非法时抛人话 Error。defer 必带合法 to_chapter，其余 action
 * 不读取该字段（App 不会向引擎发送冗余键）；值域/时序终门在引擎侧（同一计划行只受理一次处置）。
 */
export function parseResolvePlannedStateInput(input: unknown): ResolvePlannedStateRequest {
  const raw = input as Record<string, unknown>
  const projectPath = readTrimmedString(raw?.projectPath)
  if (!projectPath) throw new Error('缺少项目路径')

  const rawPayload = (raw?.payload ?? {}) as Record<string, unknown>
  const id = readTrimmedString(rawPayload.id)
  if (!id) throw new Error('缺少计划行标识')
  const action = rawPayload.action
  if (typeof action !== 'string' || !RESOLVE_ACTIONS.has(action as ResolvePlannedStateAction)) {
    throw new Error('不支持的处置动作')
  }

  const payload: ResolvePlannedStatePayload = { id, action: action as ResolvePlannedStateAction }
  if (action === 'defer') {
    const toChapter = rawPayload.to_chapter
    if (typeof toChapter !== 'number' || !Number.isInteger(toChapter) || toChapter < 1) {
      throw new Error('目标章须为不小于 1 的整数')
    }
    payload.to_chapter = toChapter
  }
  return { projectPath, payload }
}

/**
 * 纯函数：解析章纲计划状态变更整段替换 IPC 入参，非法时抛人话 Error。只做形状早失败（章号/
 * 数组/条数上限/CAS 快照存在）；条目字段级校验（角色 uid/名字/维度/值非空、值域、operation
 * cardinality）交给引擎侧语义门，此处不重复实现——避免两把尺子漂移。
 */
export function parseUpdateChapterStateChangesInput(input: unknown): UpdateChapterStateChangesRequest {
  const raw = input as Record<string, unknown>
  const projectPath = readTrimmedString(raw?.projectPath)
  if (!projectPath) throw new Error('缺少项目路径')

  const rawPayload = (raw?.payload ?? {}) as Record<string, unknown>
  const chapter = rawPayload.chapter
  if (typeof chapter !== 'number' || !Number.isInteger(chapter) || chapter < 1) {
    throw new Error('章号须为不小于 1 的整数')
  }
  const stateChanges = rawPayload.state_changes
  if (!Array.isArray(stateChanges)) throw new Error('计划状态变更须为数组')
  if (stateChanges.length > STATE_CHANGES_MAX) throw new Error(`计划状态变更最多 ${STATE_CHANGES_MAX} 条`)
  const expected = rawPayload.expected_state_changes
  if (!Array.isArray(expected)) throw new Error('缺少读取时快照（CAS 基线）')

  return {
    projectPath,
    payload: {
      chapter,
      state_changes: stateChanges as PlannedStateChangeEntry[],
      expected_state_changes: expected,
    },
  }
}

/** 经一次性 MCP client 调 novel_resolve_planned_state（处置动作三态迁移归引擎）。 */
export async function submitResolvePlannedState(
  request: ResolvePlannedStateRequest,
  paths: EngineToolPaths,
): Promise<{ ok: boolean; message?: string }> {
  return callEngineTool(request.projectPath, RESOLVE_PLANNED_STATE_TOOL, { ...request.payload }, paths)
}

/** 经一次性 MCP client 调 novel_update_chapter_state_changes（json+md+计划表协调写入、CAS 归引擎）。 */
export async function submitUpdateChapterStateChanges(
  request: UpdateChapterStateChangesRequest,
  paths: EngineToolPaths,
): Promise<{ ok: boolean; message?: string }> {
  return callEngineTool(request.projectPath, UPDATE_CHAPTER_STATE_CHANGES_TOOL, { ...request.payload }, paths)
}
