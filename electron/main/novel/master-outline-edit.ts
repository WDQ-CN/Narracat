// electron/main/novel/master-outline-edit.ts
import { getMemoryHostFor } from '../memory/index.ts'
import type { MemoryHost } from '../memory/memory-host.ts'
import { parseEngineToolResultText } from './premise-client.ts'

/**
 * 书级大纲第一档直存（spec 2026-07-12 §3.2）：App 不直写文件也不直碰 DB——
 * 书级字段在记忆库有 DB 孪生（WCP 贯穿线常驻层从 DB 读），同步纪律锁在引擎的
 * novel_update_outline_book_field 里（CAS + 三写原子）。拆旧刀3 起走 memory host
 * utilityProcess 通道（同 premise-client.ts）。
 */
const UPDATE_TOOL = 'novel_update_outline_book_field'
const TARGETS = new Set(['stakes_progression', 'storyline_name', 'foreshadowing_description'])

export interface MasterOutlineEditRequest {
  projectPath: string
  target: string
  id?: string
  newValue: string
  expectedOldValue: string
}

/** 纯函数：解析 IPC 入参，非法时抛 Error。 */
export function parseMasterOutlineFieldEditInput(input: unknown): MasterOutlineEditRequest {
  const raw = input as Record<string, unknown>
  const projectPath = typeof raw?.projectPath === 'string' ? raw.projectPath.trim() : ''
  const target = typeof raw?.target === 'string' ? raw.target : ''
  const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined
  const newValue = typeof raw?.newValue === 'string' ? raw.newValue.trim() : ''
  const expectedOldValue = typeof raw?.expectedOldValue === 'string' ? raw.expectedOldValue : ''
  if (!projectPath) throw new Error('缺少项目路径')
  if (!TARGETS.has(target)) throw new Error('该内容有下游影响，需经评估后修改。')
  if (!newValue) throw new Error('内容不能为空。')
  if (target !== 'stakes_progression' && !id) throw new Error('缺少条目定位')
  return { projectPath, target, id, newValue, expectedOldValue }
}

/**
 * 经 memory host 调 novel_update_outline_book_field（CAS + 三写原子归引擎）。
 * 第 3 参为可注入 host（测试用），缺省取进程级单例。
 */
export async function submitMasterOutlineFieldEdit(
  request: MasterOutlineEditRequest,
  paths: { appRoot: string; resourcesPath?: string; userDataPath?: string },
  host?: MemoryHost,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const resolvedHost = host ?? getMemoryHostFor(paths)
    const raw = await resolvedHost.callTool(request.projectPath, UPDATE_TOOL, {
      target: request.target,
      ...(request.id ? { id: request.id } : {}),
      new_value: request.newValue,
      expected_old_value: request.expectedOldValue,
    })
    const result = parseEngineToolResultText(raw.text)
    return result.ok
      ? { ok: true }
      : { ok: false, message: result.errors?.[0]?.hint ?? result.message ?? '保存失败。' }
  } catch (error) {
    console.error('master-outline 第一档保存失败', error)
    return { ok: false, message: '保存失败，请稍后重试。' }
  }
}
