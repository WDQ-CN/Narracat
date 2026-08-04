/**
 * 角色变更记录「章节轴」重分组（spec 2026-08-03 §4.3）：
 * 输入按维度分组的时间线（组内按发生章升序），输出按章降序的节点列表。
 * 纯函数，无 IPC/DOM 依赖——数据口径完全来自 CharacterStateSnapshot.timeline。
 */
import type {
  CharacterStateDimensionInfo,
  CharacterTimelineGroup,
} from '@shared/types/character-state'

export interface ChapterAxisEntry {
  dimensionKey: string
  displayName: string
  cardinality: 'one' | 'many'
  /** one 维度换值='set'；many 获得='add'；many 失去（派生）='remove' */
  kind: 'set' | 'add' | 'remove'
  value: string
  /** 仅 one 维度非 revoked 事件：该维度上一条未被撤销事件的值；首条/其余情形 null */
  prevValue: string | null
  factId: string
  /** 原事件的发生章（remove 派生条目也带原获得事件的发生章，供修正编辑器回填） */
  eventChapter: number
  source: 'extracted' | 'authored'
  revoked: 'corrected' | 'retracted' | null
  secretKnown: boolean | null
  /** true=由 invalidatedAtChapter 派生的「失去」条目，不开编辑/secret 入口 */
  derived: boolean
}

export interface ChapterAxisNode {
  /** 0 = 初始设定节点 */
  chapter: number
  entries: ChapterAxisEntry[]
}

export function buildChapterAxis(
  groups: CharacterTimelineGroup[],
  dimensions: CharacterStateDimensionInfo[],
): ChapterAxisNode[] {
  const entriesByChapter = new Map<number, ChapterAxisEntry[]>()
  const push = (chapter: number, entry: ChapterAxisEntry) => {
    const list = entriesByChapter.get(chapter)
    if (list) list.push(entry)
    else entriesByChapter.set(chapter, [entry])
  }

  for (const group of groups) {
    // prevValue 链：one 维度演进史的「旧值 → 新值」；revoked 行是从未生效的错误记录，
    // 既不显示旧值也不充当后续事件的旧值（spec §4.3）
    let lastEffective: string | null = null
    for (const event of group.events) {
      const revoked = event.revoked !== null
      push(event.chapter, {
        dimensionKey: group.key,
        displayName: group.displayName,
        cardinality: group.cardinality,
        kind: group.cardinality === 'one' ? 'set' : 'add',
        value: event.value,
        prevValue: group.cardinality === 'one' && !revoked ? lastEffective : null,
        factId: event.factId,
        eventChapter: event.chapter,
        source: event.source,
        revoked: event.revoked,
        secretKnown: event.secretKnown,
        derived: false,
      })
      if (!revoked) lastEffective = event.value
      // many 维度自然失去：在失去发生章派生一条 remove（one 维度被顶替由下一条的箭头表达）
      if (group.cardinality === 'many' && !revoked && event.invalidated && event.invalidatedAtChapter !== null) {
        push(event.invalidatedAtChapter, {
          dimensionKey: group.key,
          displayName: group.displayName,
          cardinality: group.cardinality,
          kind: 'remove',
          value: event.value,
          prevValue: null,
          factId: event.factId,
          eventChapter: event.chapter,
          source: event.source,
          revoked: null,
          secretKnown: null,
          derived: true,
        })
      }
    }
  }

  const dimOrder = new Map(dimensions.map((dim, index) => [dim.key, index]))
  const orderOf = (key: string) => dimOrder.get(key) ?? Number.MAX_SAFE_INTEGER
  return [...entriesByChapter.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([chapter, entries]) => ({
      chapter,
      // Array.prototype.sort 稳定：同维度条目保持事件插入序
      entries: [...entries].sort((a, b) => orderOf(a.dimensionKey) - orderOf(b.dimensionKey)),
    }))
}
