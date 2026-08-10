// 设置页「我对它的要求」区的数据拼装：全量存量 → 某个 Agent 的要求列表。
//
// store 按全量存取（一个 JSON 文件），UI 只关心当前 Agent，故过滤放在 IPC 层。
// 抽成纯函数便于单测顺序语义。

import type { AuthorRequest } from '@shared/types/author-request'

/**
 * 取某 Agent 的要求，按 createdAt 升序（作者写下的先后顺序 = 注入 prompt 的顺序）。
 * createdAt 缺失（存量被手工改过）的条目排在最后，不打乱其余条目的相对顺序。
 */
export function filterRequestsByAgent(requests: AuthorRequest[], agentId: string): AuthorRequest[] {
  return requests
    .filter((request) => request.agentId === agentId)
    .sort((a, b) => {
      if (!a.createdAt && !b.createdAt) return 0
      if (!a.createdAt) return 1
      if (!b.createdAt) return -1
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
    })
}
