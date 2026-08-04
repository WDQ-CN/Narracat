import { describe, expect, test } from 'bun:test'

import { aggregateCandidateCharacters } from './candidate-characters'
import type { MemoryDbReader } from './memory-db'

function fakeReader(
  rows: Record<string, unknown>[],
  options: { novelId?: string; throwOnMeta?: boolean; columns?: string[] } = {},
): MemoryDbReader {
  // 默认模拟已迁移库（含 importance 列）；传 columns 可模拟老库 schema。
  const columns = options.columns ?? [
    'character_uid',
    'name',
    'note',
    'proposed_chapter',
    'importance',
    'source',
    'status',
  ]
  return {
    all<T = Record<string, unknown>>(sql: string): T[] {
      if (sql.includes('FROM meta')) {
        if (options.throwOnMeta) throw new Error('no meta table')
        return (options.novelId ? [{ value: options.novelId }] : []) as T[]
      }
      if (sql.includes('PRAGMA table_info')) {
        return columns.map((name) => ({ name })) as T[]
      }
      return rows as T[]
    },
    close() {},
  }
}

describe('aggregateCandidateCharacters', () => {
  test('maps rows to candidates and normalizes optional fields', () => {
    const reader = fakeReader(
      [
        { character_uid: 'uid-1', name: '黄宏晖', note: '第3章逃跑的第三人', proposed_chapter: 3, importance: 'major', source: 'write' },
        { character_uid: 'uid-2', name: '纪文渊', note: null, proposed_chapter: null, source: 'plan' },
      ],
      { novelId: 'novel-1' },
    )

    const candidates = aggregateCandidateCharacters(reader)

    // 重要度透传：显式 major 保留；缺列（旧行）默认 minor。
    expect(candidates).toEqual([
      { characterUid: 'uid-1', name: '黄宏晖', note: '第3章逃跑的第三人', proposedChapter: 3, importance: 'major', source: 'write' },
      { characterUid: 'uid-2', name: '纪文渊', note: null, proposedChapter: null, importance: 'minor', source: 'plan' },
    ])
  })

  test('drops rows without uid or name, dedupes by uid, and defaults unknown source to write', () => {
    const reader = fakeReader([
      { character_uid: '  ', name: '无 uid', note: null, proposed_chapter: null, source: 'write' },
      { character_uid: 'uid-3', name: '  ', note: null, proposed_chapter: null, source: 'write' },
      { character_uid: 'uid-4', name: '阿九', note: null, proposed_chapter: null, source: 'weird' },
      { character_uid: 'uid-4', name: '阿九（重复）', note: null, proposed_chapter: null, source: 'write' },
    ])

    const candidates = aggregateCandidateCharacters(reader)

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ characterUid: 'uid-4', name: '阿九', source: 'write' })
  })

  test('old DB without importance column still lists candidates (defaults minor), not empty', () => {
    // 回归 P1：App 只读、跑不了 v14 迁移；老库缺 importance 列时旧实现会整片清空。
    const reader = fakeReader(
      [
        { character_uid: 'uid-1', name: '镇岳堂伤者', note: null, proposed_chapter: 5, source: 'write' },
        { character_uid: 'uid-2', name: '神秘老者', note: null, proposed_chapter: null, source: 'plan' },
      ],
      { novelId: 'novel-1', columns: ['character_uid', 'name', 'note', 'proposed_chapter', 'source', 'status'] },
    )

    const candidates = aggregateCandidateCharacters(reader)

    expect(candidates).toHaveLength(2)
    expect(candidates.every((c) => c.importance === 'minor')).toBe(true)
  })

  test('still reads candidates when the meta novel_id lookup fails', () => {
    const reader = fakeReader(
      [{ character_uid: 'uid-5', name: '林舟', note: null, proposed_chapter: 1, source: 'manual' }],
      { throwOnMeta: true },
    )

    expect(aggregateCandidateCharacters(reader)).toHaveLength(1)
  })
})
