import { describe, expect, test } from 'bun:test'
import { filterRequestsByAgent } from './author-requests.ts'
import type { AuthorRequest } from '@shared/types/author-request'

const ALL: AuthorRequest[] = [
  { id: 'a', agentId: 'chapter-writer', text: '少写环境描写', createdAt: '2026-08-07T00:00:00.000Z' },
  { id: 'b', agentId: 'outline-architect', text: '开局快一点', createdAt: '2026-08-07T00:00:01.000Z' },
  { id: 'c', agentId: 'chapter-writer', text: '多写对话', createdAt: '2026-08-07T00:00:02.000Z' },
]

describe('filterRequestsByAgent', () => {
  test('只返回该 Agent 的要求，且保持 createdAt 升序', () => {
    expect(filterRequestsByAgent(ALL, 'chapter-writer').map((item) => item.id)).toEqual(['a', 'c'])
  })

  test('该 Agent 没有要求时返回空数组', () => {
    expect(filterRequestsByAgent(ALL, 'world-curator')).toEqual([])
  })

  test('createdAt 缺失的条目排在最后，不影响其余顺序', () => {
    const withBlank: AuthorRequest[] = [
      { id: 'x', agentId: 'chapter-writer', text: '无时间', createdAt: '' },
      ...ALL,
    ]
    expect(filterRequestsByAgent(withBlank, 'chapter-writer').map((item) => item.id)).toEqual(['a', 'c', 'x'])
  })
})
