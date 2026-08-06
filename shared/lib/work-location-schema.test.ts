import { describe, expect, test } from 'bun:test'

import { parseStoredWorkLocation, type StoredWorkLocation } from './work-location-schema'

/**
 * 工作位置是**持久化**的：主进程把它写进磁盘，用户下次启动按它落回原处。
 * 新增 sectionId 时如果漏改 isSectionId 的白名单，parse 会静默判定为损坏、整条降级回「书库」
 * ——用户体感是"上次明明停在星图，重启却被弹回小说大纲"，没有任何报错、也没有任何测试会红。
 * 所以每个 sectionId 都要在这里过一遍往返。
 */
describe('parseStoredWorkLocation section ids', () => {
  const sectionIds: Extract<StoredWorkLocation, { landing: 'workbench' }>['sectionId'][] = [
    'status',
    'reference-works',
    'blueprint',
    'settings',
    'packs',
    'chat',
    'memory-graph',
  ]

  test.each(sectionIds)('round-trips the %s section', (sectionId) => {
    const stored: StoredWorkLocation = {
      version: 1,
      landing: 'workbench',
      novelId: 'novel-1',
      projectPath: '/books/novel-1',
      sectionId,
    }

    expect(parseStoredWorkLocation(JSON.stringify(stored))).toEqual(stored)
  })

  test('falls back to the library for an unknown section id', () => {
    const raw = JSON.stringify({
      version: 1,
      landing: 'workbench',
      novelId: 'novel-1',
      projectPath: '/books/novel-1',
      sectionId: 'not-a-section',
    })

    expect(parseStoredWorkLocation(raw)).toEqual({ version: 1, landing: 'library' })
  })
})
