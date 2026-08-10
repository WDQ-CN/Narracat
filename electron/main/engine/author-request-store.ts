// 作者给各 Agent 写的要求（「我对它的要求」）。存 userData/author-requests.json。
//
// 降级纪律对齐 prose-override-store.ts：
// 读一律 fail-soft 返回空列表——读不出来最多是「作者的要求这次没带上」，绝不能阻断 run；
// 写则 fail-loud 抛错——作者在设置页按了保存，静默失败是最坏的失败模式。

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuthorRequest, AuthorRequestFile } from '@shared/types/author-request'
import { withJsonFileLock } from './write-json-atomic'

/** author-requests.json 路径（与 prose-overrides.json 同级，userData 根） */
export function authorRequestStorePath(userDataPath: string): string {
  return join(userDataPath, 'author-requests.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeRequest(value: unknown): AuthorRequest | null {
  if (!isRecord(value)) return null
  const { id, agentId, text, createdAt } = value
  if (typeof id !== 'string' || !id.trim()) return null
  if (typeof agentId !== 'string' || !agentId.trim()) return null
  if (typeof text !== 'string' || !text.trim()) return null
  return {
    id,
    agentId,
    text,
    createdAt: typeof createdAt === 'string' ? createdAt : '',
  }
}

/** 读存量。任何失败（缺文件 / JSON 坏 / 形状非法）一律降级，绝不抛。 */
export async function listAuthorRequests(storePath: string): Promise<AuthorRequest[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(storePath, 'utf-8'))
    if (!isRecord(parsed) || !Array.isArray(parsed.requests)) return []
    return parsed.requests.flatMap((item) => {
      const normalized = normalizeRequest(item)
      return normalized ? [normalized] : []
    })
  } catch {
    return []
  }
}

/**
 * 新增一条。读现状 → 追加 → 落盘整段包进 withJsonFileLock：并发两次若各自在锁外独立读到同一份
 * 旧快照，后写的会覆盖掉先写的那条（同 prose-override-store 已实测坐实的问题）。
 */
export async function addAuthorRequest(input: {
  storePath: string
  agentId: string
  text: string
  now: string
}): Promise<AuthorRequest[]> {
  const { storePath, agentId, text, now } = input
  if (!agentId.trim()) throw new Error('缺少 Agent id。')
  if (!text.trim()) throw new Error('要求的内容不能为空。')

  return withJsonFileLock(storePath, async (write) => {
    const requests = await listAuthorRequests(storePath)
    const next = [...requests, { id: randomUUID(), agentId, text, createdAt: now }]
    await write({ version: 1, requests: next } satisfies AuthorRequestFile)
    return next
  })
}

/** 改写一条的正文。找不到 id 抛错——作者按了保存却什么都没改，必须让他知道。 */
export async function updateAuthorRequest(input: {
  storePath: string
  id: string
  text: string
}): Promise<AuthorRequest[]> {
  const { storePath, id, text } = input
  if (!id.trim()) throw new Error('缺少要求 id。')
  if (!text.trim()) throw new Error('要求的内容不能为空。')

  return withJsonFileLock(storePath, async (write) => {
    const requests = await listAuthorRequests(storePath)
    if (!requests.some((request) => request.id === id)) throw new Error('这条要求已不存在，请刷新后重试。')
    const next = requests.map((request) => (request.id === id ? { ...request, text } : request))
    await write({ version: 1, requests: next } satisfies AuthorRequestFile)
    return next
  })
}

/** 删除一条（幂等：不存在也不抛，删除的意图已经达成）。 */
export async function removeAuthorRequest(input: {
  storePath: string
  id: string
}): Promise<AuthorRequest[]> {
  const { storePath, id } = input
  if (!id.trim()) throw new Error('缺少要求 id。')

  return withJsonFileLock(storePath, async (write) => {
    const requests = await listAuthorRequests(storePath)
    const next = requests.filter((request) => request.id !== id)
    if (next.length === requests.length) return requests
    await write({ version: 1, requests: next } satisfies AuthorRequestFile)
    return next
  })
}
