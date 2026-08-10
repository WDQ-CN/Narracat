// 用户对引擎散文块的覆盖存量。与 author-requests.json 同级（userData 根）。
//
// 读一律 fail-soft 返回 {}：override 读不出来最多是「作者的调整没生效」，绝不能阻断 run。
// 写则 fail-loud 抛错：作者在设置页按了保存，静默失败是最坏的失败模式。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROSE_BLOCK_ID_RE } from '@shared/lib/prose-blocks'
import type { ProseOverrideEntry } from '@shared/types/prose-block'
import { withJsonFileLock } from './write-json-atomic'

/** prose-overrides.json 路径（与 author-requests.json 同级，userData 根） */
export function proseOverrideStorePath(userDataPath: string): string {
  return join(userDataPath, 'prose-overrides.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeEntry(value: unknown): ProseOverrideEntry | null {
  if (!isRecord(value)) return null
  const { text, baseText, baseEngineVersion, updatedAt } = value
  if (typeof text !== 'string' || typeof baseText !== 'string') return null
  return {
    text,
    baseText,
    baseEngineVersion: typeof baseEngineVersion === 'string' ? baseEngineVersion : '',
    updatedAt: typeof updatedAt === 'string' ? updatedAt : '',
  }
}

/** 读存量。任何失败（缺文件 / JSON 坏 / 形状非法）一律降级为 {}，绝不抛。 */
export async function readProseOverrides(storePath: string): Promise<Record<string, ProseOverrideEntry>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(storePath, 'utf-8'))
    if (!isRecord(parsed) || !isRecord(parsed.overrides)) return {}
    const result: Record<string, ProseOverrideEntry> = {}
    for (const [id, raw] of Object.entries(parsed.overrides)) {
      if (!PROSE_BLOCK_ID_RE.test(id)) continue
      const entry = normalizeEntry(raw)
      if (entry) result[id] = entry
    }
    return result
  } catch {
    return {}
  }
}

/**
 * 写入前校验（id 合法）在锁外做，纯参数校验不依赖现状，抛错无需等锁。
 * 读现状 → 算合计 → 落盘则整段包进 withJsonFileLock：并发两次 setProseOverride 若各自在锁外
 * 独立读到同一份旧快照，后写的会覆盖掉先写的那条改动（已用测试实测坐实）。锁没锁写这一步不够，
 * 必须连读都纳入同一条队列，后来者才能看见前者已提交的结果。
 */
export async function setProseOverride(input: {
  storePath: string
  id: string
  text: string
  baseText: string
  baseEngineVersion: string
  now: string
}): Promise<Record<string, ProseOverrideEntry>> {
  const { storePath, id, text, baseText, baseEngineVersion, now } = input
  if (!PROSE_BLOCK_ID_RE.test(id)) throw new Error(`散文块 id 非法：${id}`)

  return withJsonFileLock(storePath, async (write) => {
    const overrides = await readProseOverrides(storePath)
    const next = { ...overrides, [id]: { text, baseText, baseEngineVersion, updatedAt: now } }
    await write({ version: 1, overrides: next })
    return next
  })
}

/** 移除单条（幂等：不存在也不抛）。 */
export async function removeProseOverride(input: {
  storePath: string
  id: string
}): Promise<Record<string, ProseOverrideEntry>> {
  const { storePath, id } = input
  return withJsonFileLock(storePath, async (write) => {
    const overrides = await readProseOverrides(storePath)
    if (!(id in overrides)) return overrides
    const next = { ...overrides }
    delete next[id]
    await write({ version: 1, overrides: next })
    return next
  })
}

/**
 * 按 id 批量移除（幂等：不存在的 id 静默跳过）。供「恢复当前 Agent 的官方默认」用——
 * 调用方只传该 Agent 名下的块 id 集合，不属于任何已知块的孤儿存量原样保留，
 * 绝不能在这里做「清空全部」，那会误伤其他 Agent 的调整（真机事故：#Task6 修复）。
 * ids 为空时是无副作用的幂等返回，读现状即答，不落盘。
 */
export async function removeProseOverrides(input: {
  storePath: string
  ids: string[]
}): Promise<Record<string, ProseOverrideEntry>> {
  const { storePath, ids } = input
  return withJsonFileLock(storePath, async (write) => {
    const overrides = await readProseOverrides(storePath)
    if (ids.length === 0) return overrides

    const removeSet = new Set(ids)
    let changed = false
    const next: Record<string, ProseOverrideEntry> = {}
    for (const [id, entry] of Object.entries(overrides)) {
      if (removeSet.has(id)) {
        changed = true
        continue
      }
      next[id] = entry
    }
    if (!changed) return overrides

    await write({ version: 1, overrides: next })
    return next
  })
}
