import { describe, expect, test } from 'bun:test'

import { buildChapterAxis } from './character-timeline-chapter-axis'
import type { CharacterStateDimensionInfo, CharacterTimelineEvent, CharacterTimelineGroup } from '@shared/types/character-state'

function event(overrides: Partial<CharacterTimelineEvent>): CharacterTimelineEvent {
  return {
    factId: 'f0',
    value: '值',
    chapter: 1,
    source: 'extracted',
    invalidated: false,
    invalidatedAtChapter: null,
    revoked: null,
    secretKnown: null,
    ...overrides,
  }
}

const DIMS: CharacterStateDimensionInfo[] = [
  { key: 'cultivation_level', displayName: '境界', cardinality: 'one', valueType: 'enum', values: ['练气', '筑基', '金丹'] },
  { key: 'faction', displayName: '阵营', cardinality: 'one', valueType: 'free', values: [] },
  { key: 'inventory', displayName: '持有物', cardinality: 'many', valueType: 'free', values: [] },
]

describe('buildChapterAxis', () => {
  test('空输入返回空数组', () => {
    expect(buildChapterAxis([], DIMS)).toEqual([])
  })

  test('one 维度按章降序成节点，prevValue 取上一条未撤销事件值，第 0 章垫底', () => {
    const groups: CharacterTimelineGroup[] = [
      {
        key: 'cultivation_level',
        displayName: '境界',
        cardinality: 'one',
        events: [
          event({ factId: 'f1', value: '练气', chapter: 0, source: 'authored', invalidated: true, invalidatedAtChapter: 3 }),
          event({ factId: 'f2', value: '筑基', chapter: 3, invalidated: true, invalidatedAtChapter: 8 }),
          event({ factId: 'f3', value: '金丹', chapter: 8 }),
        ],
      },
    ]
    const nodes = buildChapterAxis(groups, DIMS)
    expect(nodes.map((n) => n.chapter)).toEqual([8, 3, 0])
    expect(nodes[0].entries[0]).toMatchObject({ kind: 'set', value: '金丹', prevValue: '筑基', eventChapter: 8 })
    expect(nodes[1].entries[0]).toMatchObject({ value: '筑基', prevValue: '练气' })
    expect(nodes[2].entries[0]).toMatchObject({ value: '练气', prevValue: null })
  })

  test('revoked 事件 prevValue 为 null 且不参与后续 prevValue 推导', () => {
    const groups: CharacterTimelineGroup[] = [
      {
        key: 'cultivation_level',
        displayName: '境界',
        cardinality: 'one',
        events: [
          event({ factId: 'f1', value: '练气', chapter: 0 }),
          event({ factId: 'f2', value: '错误境界', chapter: 5, invalidated: true, invalidatedAtChapter: 5, revoked: 'corrected' }),
          event({ factId: 'f3', value: '筑基', chapter: 8 }),
        ],
      },
    ]
    const nodes = buildChapterAxis(groups, DIMS)
    const revokedEntry = nodes.find((n) => n.chapter === 5)?.entries[0]
    expect(revokedEntry).toMatchObject({ revoked: 'corrected', prevValue: null })
    // f3 的 prevValue 跳过被撤销的 f2，取 f1
    expect(nodes.find((n) => n.chapter === 8)?.entries[0]).toMatchObject({ value: '筑基', prevValue: '练气' })
  })

  test('many 维度 invalidatedAtChapter 派生失去条目落在失去章，derived=true；revoked 事件不派生', () => {
    const groups: CharacterTimelineGroup[] = [
      {
        key: 'inventory',
        displayName: '持有物',
        cardinality: 'many',
        events: [
          event({ factId: 'f5', value: '铁剑', chapter: 2, invalidated: true, invalidatedAtChapter: 6 }),
          event({ factId: 'f6', value: '假物品', chapter: 3, invalidated: true, invalidatedAtChapter: 3, revoked: 'retracted' }),
        ],
      },
    ]
    const nodes = buildChapterAxis(groups, DIMS)
    const lossNode = nodes.find((n) => n.chapter === 6)
    expect(lossNode?.entries).toHaveLength(1)
    expect(lossNode?.entries[0]).toMatchObject({ kind: 'remove', value: '铁剑', derived: true, factId: 'f5', eventChapter: 2, secretKnown: null })
    // 获得条目照常在第 2 章
    expect(nodes.find((n) => n.chapter === 2)?.entries[0]).toMatchObject({ kind: 'add', value: '铁剑', derived: false })
    // revoked 事件只有本章一条撤销记录，无派生失去
    expect(nodes.find((n) => n.chapter === 3)?.entries).toHaveLength(1)
  })

  test('同章多维度条目按词表声明顺序排，词表外维度垫后', () => {
    const groups: CharacterTimelineGroup[] = [
      { key: 'legacy_predicate', displayName: '旧谓词', cardinality: 'one', events: [event({ factId: 'f9', value: '甲', chapter: 4 })] },
      { key: 'faction', displayName: '阵营', cardinality: 'one', events: [event({ factId: 'f8', value: '天剑宗', chapter: 4 })] },
      { key: 'cultivation_level', displayName: '境界', cardinality: 'one', events: [event({ factId: 'f7', value: '筑基', chapter: 4 })] },
    ]
    const nodes = buildChapterAxis(groups, DIMS)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].entries.map((e) => e.dimensionKey)).toEqual(['cultivation_level', 'faction', 'legacy_predicate'])
  })

  test('获得与派生失去落同一章时合并进一个节点', () => {
    const groups: CharacterTimelineGroup[] = [
      {
        key: 'inventory',
        displayName: '持有物',
        cardinality: 'many',
        events: [
          event({ factId: 'f5', value: '铁剑', chapter: 2, invalidated: true, invalidatedAtChapter: 5 }),
          event({ factId: 'f6', value: '青霜剑', chapter: 5 }),
        ],
      },
    ]
    const nodes = buildChapterAxis(groups, DIMS)
    const ch5 = nodes.find((n) => n.chapter === 5)
    expect(ch5?.entries.map((e) => e.kind).sort()).toEqual(['add', 'remove'])
  })
})
