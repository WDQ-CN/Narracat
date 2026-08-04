import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { premiseCardsDataPath } from './novel-layout.ts'
import { submitPremiseCardsViaClient, type SubmitPremiseResult } from './premise-client.ts'
import { isFirstTierField } from '@shared/lib/premise-field-tier'

/**
 * 立项卡字段编辑（#276，ADR-0019 2026-06-15(2) 细化；ADR-0029 第一档放宽）。
 *
 * main 读盘最新 premise-cards.json（避免 renderer 持有的 artifact.data 因中途 Agent 写入
 * 而过期）→ 守边界 → 应用增量 → 经一次性 MCP client 提交完整 payload。
 *
 * 支持两类直写操作：
 * - mark-canon：纯信心转移，**暂定 → 已定**（内容不变、无下游影响）
 * - edit-content：改内容，仅限**第一档**纯描述字段（ADR-0029），改后确定度置 canon；
 *   有下游依赖的字段（第二、三档）一律经 AI 引导，不走此路径（ADR-0019 收窄边界）。
 */

export interface MarkCanonEdit {
  kind: 'mark-canon'
  cardKey: string
  /** 该卡 fields 数组内的位置（renderer 渲染时已知，比 field.key 更稳，避免同卡重名歧义） */
  fieldIndex: number
  /** 固定 'canon' */
  certainty: 'canon'
  /** 乐观锁——渲染时该字段的 key / value（已 trim）/ 确定度 */
  expectedKey: string
  expectedValue: string
  expectedCertainty: string
}

export interface EditContentEdit {
  kind: 'edit-content'
  cardKey: string
  /** 该卡 fields 数组内的位置 */
  fieldIndex: number
  /** 新内容（trim 后不能为空） */
  newValue: string
  /** 乐观锁——渲染时该字段的 key / value（已 trim）/ 确定度 */
  expectedKey: string
  expectedValue: string
  expectedCertainty: string
}

export type PremiseFieldEdit = MarkCanonEdit | EditContentEdit

interface RawField {
  key?: string
  value?: string
  certainty?: string
  note?: string
}
interface RawCard {
  card?: string
  fields?: RawField[]
}
export interface RawPremisePayload {
  cards: RawCard[]
}

export type ApplyEditOutcome =
  | { ok: true; payload: RawPremisePayload }
  | { ok: false; message: string }

/** 在 cards 中替换某卡某 index 的字段，返回新 payload（不可变）。 */
function replaceField(cards: RawCard[], card: RawCard, fieldIndex: number, nextField: RawField): RawPremisePayload {
  const nextFields = (card.fields ?? []).map((entry, index) => (index === fieldIndex ? nextField : entry))
  const nextCards = cards.map((entry) => (entry === card ? { ...card, fields: nextFields } : entry))
  return { cards: nextCards }
}

/** 纯函数：在 cards 上应用一次字段编辑并守开放边界，返回新 payload 或拒绝原因（便于单测）。 */
export function applyPremiseFieldEdit(payload: RawPremisePayload, edit: PremiseFieldEdit): ApplyEditOutcome {
  const cards = Array.isArray(payload?.cards) ? payload.cards : null
  if (!cards) return { ok: false, message: '立项卡数据缺失或损坏。' }

  const card = cards.find((entry) => entry?.card === edit.cardKey)
  if (!card || !Array.isArray(card.fields)) return { ok: false, message: `未找到立项卡：${edit.cardKey}。` }

  const field = card.fields[edit.fieldIndex]
  if (!field) return { ok: false, message: '未找到要编辑的条目。' }

  // 乐观锁（两类编辑共用）：读盘最新 cards 后，该位置的字段须与渲染时一致——Agent 可能在用户点击前
  // 改过同卡的顺序 / 内容 / 确定度。不符则拒绝并要求刷新，避免误改到另一条暂定项。
  const currentCertainty = (field.certainty ?? 'canon').trim() || 'canon'
  if (
    (field.key ?? '') !== edit.expectedKey ||
    (field.value ?? '').trim() !== edit.expectedValue ||
    currentCertainty !== edit.expectedCertainty
  ) {
    return { ok: false, message: '立项卡已更新，请刷新后重试。' }
  }

  if (edit.kind === 'mark-canon') {
    // App 直写仅一个安全转移：暂定 → 已定。其余一律经 AI（不走此路径）。
    if (currentCertainty !== 'tentative') {
      return { ok: false, message: '仅暂定项可标记为已定。' }
    }
    const nextField: RawField = { ...field, certainty: 'canon' }
    return { ok: true, payload: replaceField(cards, card, edit.fieldIndex, nextField) }
  }

  // edit.kind === 'edit-content'：第一档纯描述字段直改内容（放宽 ADR-0019，ADR-0029 第一档）。
  if (!isFirstTierField(edit.cardKey, field.key ?? '')) {
    return { ok: false, message: '该内容有下游影响，需经评估后修改。' }
  }
  const nextValue = edit.newValue.trim()
  if (nextValue === '') return { ok: false, message: '内容不能为空。' }
  const nextField: RawField = { ...field, value: nextValue, certainty: 'canon' }
  return { ok: true, payload: replaceField(cards, card, edit.fieldIndex, nextField) }
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}参数非法。`)
  return value
}

/** 纯函数：解析 IPC 入参为 { projectPath, edit: PremiseFieldEdit }，非法时抛 Error。 */
export function parsePremiseFieldEditInput(input: unknown): { projectPath: string; edit: PremiseFieldEdit } {
  const raw = (input ?? {}) as Record<string, unknown>
  const projectPath = asString(raw.projectPath, '项目路径')
  const cardKey = asString(raw.cardKey, '立项卡标识')
  const fieldIndex = raw.fieldIndex
  if (typeof fieldIndex !== 'number' || !Number.isInteger(fieldIndex) || fieldIndex < 0) {
    throw new Error('字段位置参数非法。')
  }
  const lock = {
    expectedKey: asString(raw.expectedKey, '字段标识'),
    expectedValue: asString(raw.expectedValue, '字段内容'),
    expectedCertainty: asString(raw.expectedCertainty, '确定度'),
  }
  const kind = raw.kind
  if (kind === 'edit-content') {
    const newValue = asString(raw.newValue, '新内容')
    if (!newValue.trim()) throw new Error('新内容不能为空。')
    return { projectPath, edit: { kind, cardKey, fieldIndex, newValue, ...lock } }
  }
  if (kind === 'mark-canon') {
    return { projectPath, edit: { kind, cardKey, fieldIndex, certainty: 'canon', ...lock } }
  }
  throw new Error('编辑类型参数非法。')
}

export interface SubmitPremiseFieldEditInput {
  appRoot: string
  resourcesPath?: string
  userDataPath?: string
  projectPath: string
  edit: PremiseFieldEdit
}

/** 读盘最新 cards → 守边界应用编辑 → 经一次性 MCP client 提交。 */
export async function submitPremiseFieldEdit(input: SubmitPremiseFieldEditInput): Promise<SubmitPremiseResult> {
  const dataPath = join(input.projectPath, premiseCardsDataPath())

  let current: RawPremisePayload
  try {
    current = JSON.parse(await readFile(dataPath, 'utf-8')) as RawPremisePayload
  } catch {
    return { ok: false, message: '读取立项卡数据契约失败，可能尚未立项。' }
  }

  const outcome = applyPremiseFieldEdit(current, input.edit)
  if (!outcome.ok) return outcome

  return submitPremiseCardsViaClient({
    appRoot: input.appRoot,
    resourcesPath: input.resourcesPath,
    userDataPath: input.userDataPath,
    projectPath: input.projectPath,
    payload: { cards: outcome.payload.cards },
  })
}
