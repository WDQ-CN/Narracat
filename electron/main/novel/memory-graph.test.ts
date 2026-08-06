import { describe, expect, test } from 'bun:test'

import { aggregateMemoryGraph, readMemoryGraph } from './memory-graph'
import type { MemoryDbReader } from './memory-db'

/**
 * fake reader：按 SQL 片段分派返回行。
 * columns 用来模拟老库 schema（缺 secret_known / source 列）。
 */
function fakeReader(
  data: {
    cards?: Record<string, unknown>[]
    facts?: Record<string, unknown>[]
  },
  options: { novelId?: string; columns?: string[]; throwOnFacts?: boolean; throwOnCards?: boolean } = {},
): MemoryDbReader {
  const columns = options.columns ?? ['id', 'subject', 'subject_character_uid', 'subject_character_b_uid', 'predicate', 'object', 'from_chapter', 'event_chapter', 'invalidated_at_chapter', 'source', 'secret_known']
  return {
    all<T = Record<string, unknown>>(sql: string): T[] {
      if (sql.includes('FROM meta')) return (options.novelId ? [{ value: options.novelId }] : []) as T[]
      if (sql.includes('PRAGMA table_info')) return columns.map((name) => ({ name })) as T[]
      if (sql.includes('FROM character_cards')) {
        if (options.throwOnCards) throw new Error('no such table: character_cards')
        return (data.cards ?? []) as T[]
      }
      if (sql.includes('FROM facts')) {
        if (options.throwOnFacts) throw new Error('no such table: facts')
        return (data.facts ?? []) as T[]
      }
      return [] as T[]
    },
    close() {},
  }
}

describe('aggregateMemoryGraph', () => {
  test('builds character nodes from cards and facts, sized by valid fact count', () => {
    const reader = fakeReader(
      {
        cards: [{ character_uid: 'uid-a', character: '苏见' }],
        facts: [
          { id: 'f1', subject: '苏见', subject_character_uid: 'uid-a', subject_character_b_uid: null, predicate: 'goal', object: '找到师父下落', from_chapter: 1, event_chapter: null, invalidated_at_chapter: null },
          { id: 'f2', subject: '苏见', subject_character_uid: 'uid-a', subject_character_b_uid: null, predicate: 'secret', object: '其实是仇家之子', from_chapter: 2, event_chapter: 3, invalidated_at_chapter: null },
          { id: 'f3', subject: '阿九', subject_character_uid: 'uid-b', subject_character_b_uid: null, predicate: 'identity', object: '药铺学徒', from_chapter: 2, event_chapter: null, invalidated_at_chapter: null },
        ],
      },
      { novelId: 'novel-1' },
    )

    const graph = aggregateMemoryGraph(reader)
    const characters = graph.nodes.filter((node) => node.kind === 'character')

    // 有卡的角色取卡上的名字；只在 facts 里出现的角色（阿九）用 subject 兜底建节点
    expect(characters).toEqual([
      { id: 'uid-a', kind: 'character', label: '苏见', ownerId: null, predicate: null, predicateLabel: null, factCount: 2, chapter: null },
      { id: 'uid-b', kind: 'character', label: '阿九', ownerId: null, predicate: null, predicateLabel: null, factCount: 1, chapter: null },
    ])
  })

  test('builds fact nodes with chinese predicate labels and belongs-to links', () => {
    const reader = fakeReader({
      cards: [{ character_uid: 'uid-a', character: '苏见' }],
      facts: [
        { id: 'f2', subject: '苏见', subject_character_uid: 'uid-a', subject_character_b_uid: null, predicate: 'secret', object: '其实是仇家之子', from_chapter: 2, event_chapter: 3, invalidated_at_chapter: null },
      ],
    })

    const graph = aggregateMemoryGraph(reader)

    // 章号取 event_chapter 优先（3），谓词中文标签走现成映射
    expect(graph.nodes.find((node) => node.kind === 'fact')).toEqual({
      id: 'f2', kind: 'fact', label: '其实是仇家之子', ownerId: 'uid-a',
      predicate: 'secret', predicateLabel: '秘密', factCount: 0, chapter: 3,
    })
    expect(graph.links).toEqual([{ source: 'uid-a', target: 'f2', kind: 'belongs-to', label: null }])
  })

  test('builds relationship links between two character ends', () => {
    const reader = fakeReader({
      cards: [
        { character_uid: 'uid-a', character: '苏见' },
        { character_uid: 'uid-b', character: '阿九' },
      ],
      facts: [
        { id: 'r1', subject: '苏见|阿九', subject_character_uid: 'uid-a', subject_character_b_uid: 'uid-b', predicate: 'relationship', object: '同门相护', from_chapter: 4, event_chapter: null, invalidated_at_chapter: null },
      ],
    })

    const graph = aggregateMemoryGraph(reader)

    expect(graph.links).toEqual([{ source: 'uid-a', target: 'uid-b', kind: 'relationship', label: '同门相护' }])
    // 关系行不产生事实星尘节点，也不计进任一端的 factCount
    expect(graph.nodes.filter((node) => node.kind === 'fact')).toEqual([])
    expect(graph.nodes.every((node) => node.factCount === 0)).toBe(true)
  })

  test('excludes invalidated facts', () => {
    const reader = fakeReader({
      cards: [{ character_uid: 'uid-a', character: '苏见' }],
      facts: [
        { id: 'f1', subject: '苏见', subject_character_uid: 'uid-a', subject_character_b_uid: null, predicate: 'location', object: '青云镇', from_chapter: 1, event_chapter: null, invalidated_at_chapter: 9 },
      ],
    })

    const graph = aggregateMemoryGraph(reader)

    expect(graph.nodes.filter((node) => node.kind === 'fact')).toEqual([])
    expect(graph.nodes.find((node) => node.id === 'uid-a')?.factCount).toBe(0)
  })

  test('keys uid-less facts by subject name so legacy books still render', () => {
    const reader = fakeReader({
      cards: [],
      facts: [
        { id: 'f9', subject: '某个路人', subject_character_uid: null, subject_character_b_uid: null, predicate: 'identity', object: '卖炊饼的', from_chapter: 1, event_chapter: null, invalidated_at_chapter: null },
      ],
    })

    const graph = aggregateMemoryGraph(reader)

    // 老库（uid 列从未回填）整片事实都缺 uid：按名字兜底建节点，否则整张星图会空白
    expect(graph.nodes).toEqual([
      { id: 'name:某个路人', kind: 'character', label: '某个路人', ownerId: null, predicate: null, predicateLabel: null, factCount: 1, chapter: null },
      { id: 'f9', kind: 'fact', label: '卖炊饼的', ownerId: 'name:某个路人', predicate: 'identity', predicateLabel: '身份', factCount: 0, chapter: 1 },
    ])
    expect(graph.links).toEqual([{ source: 'name:某个路人', target: 'f9', kind: 'belongs-to', label: null }])
  })

  test('keys uid-less relationship ends by their names from the subject pair', () => {
    const reader = fakeReader({
      cards: [],
      facts: [
        { id: 'r2', subject: '无名客|苏见', subject_character_uid: 'uid-a', subject_character_b_uid: null, predicate: 'relationship', object: '互不相识', from_chapter: 5, event_chapter: null, invalidated_at_chapter: null },
      ],
    })

    const graph = aggregateMemoryGraph(reader)

    // subject 是 "名A|名B"（引擎按字典序排序），uid 对应排前的那个名字；缺 uid 的一端按名字兜底
    expect(graph.links).toEqual([
      { source: 'uid-a', target: 'name:苏见', kind: 'relationship', label: '互不相识' },
    ])
    expect(graph.nodes.map((node) => node.label)).toEqual(['无名客', '苏见'])
  })

  test('degrades a malformed relationship row to fact dust instead of a dangling link', () => {
    const reader = fakeReader({
      cards: [{ character_uid: 'uid-a', character: '苏见' }],
      facts: [
        { id: 'r3', subject: '苏见', subject_character_uid: 'uid-a', subject_character_b_uid: null, predicate: 'relationship', object: '与旧友重归于好', from_chapter: 6, event_chapter: null, invalidated_at_chapter: null },
      ],
    })

    const graph = aggregateMemoryGraph(reader)

    // subject 不是 "A|B" 形态、另一端也无 uid：认不出对手方，挂成该角色的普通事实星尘
    expect(graph.links).toEqual([{ source: 'uid-a', target: 'r3', kind: 'belongs-to', label: null }])
    expect(graph.nodes.find((node) => node.id === 'r3')?.predicateLabel).toBe('关系')
  })

  test('drops rows with neither uid nor subject', () => {
    const reader = fakeReader({
      cards: [],
      facts: [
        { id: 'f0', subject: '  ', subject_character_uid: null, subject_character_b_uid: null, predicate: 'identity', object: '无主之事', from_chapter: 1, event_chapter: null, invalidated_at_chapter: null },
      ],
    })

    expect(aggregateMemoryGraph(reader)).toEqual({ nodes: [], links: [] })
  })

  test('returns empty snapshot when facts table is unreadable', () => {
    const reader = fakeReader({ cards: [{ character_uid: 'uid-a', character: '苏见' }] }, { throwOnFacts: true })

    expect(aggregateMemoryGraph(reader)).toEqual({ nodes: [], links: [] })
  })

  test('works on legacy schema without source and secret_known columns', () => {
    const reader = fakeReader(
      {
        cards: [{ character_uid: 'uid-a', character: '苏见' }],
        facts: [
          { id: 'f1', subject: '苏见', subject_character_uid: 'uid-a', subject_character_b_uid: null, predicate: 'goal', object: '找到师父下落', from_chapter: 1, event_chapter: null, invalidated_at_chapter: null },
        ],
      },
      { columns: ['id', 'subject', 'subject_character_uid', 'subject_character_b_uid', 'predicate', 'object', 'from_chapter', 'event_chapter', 'invalidated_at_chapter'] },
    )

    const graph = aggregateMemoryGraph(reader)

    expect(graph.nodes.filter((node) => node.kind === 'fact')).toHaveLength(1)
  })

  test('keeps isolated characters that have no facts at all', () => {
    const reader = fakeReader({ cards: [{ character_uid: 'uid-solo', character: '孤星' }], facts: [] })

    expect(aggregateMemoryGraph(reader)).toEqual({
      nodes: [{ id: 'uid-solo', kind: 'character', label: '孤星', ownerId: null, predicate: null, predicateLabel: null, factCount: 0, chapter: null }],
      links: [],
    })
  })

  // fix round 1 评审 Finding 1（选 b）：character_cards 只是「更好看的展示名」来源，不是图的骨架；
  // 读失败时局部降级为 []，不应牵连 facts 让整张星图消失——与 facts 不可读的 fail-closed 刻意不对称。
  test('degrades locally when character_cards is unreadable but facts still render the skeleton', () => {
    const reader = fakeReader(
      {
        facts: [
          { id: 'f1', subject: '苏见', subject_character_uid: 'uid-a', subject_character_b_uid: null, predicate: 'goal', object: '找到师父下落', from_chapter: 1, event_chapter: null, invalidated_at_chapter: null },
        ],
      },
      { throwOnCards: true },
    )

    const graph = aggregateMemoryGraph(reader)

    // cards 拿不到人读名不要紧：facts 里自带 uid 的行仍能建出角色骨架（而非整张图清空）
    expect(graph.nodes.filter((node) => node.kind === 'character')).toEqual([
      { id: 'uid-a', kind: 'character', label: '苏见', ownerId: null, predicate: null, predicateLabel: null, factCount: 1, chapter: null },
    ])
  })

  // fix round 1 评审 Finding 2：引擎不会给候选期 uid=NULL 的历史 fact 回填 uid，同一个人的
  // 「候选期」与「建档后」两段历史必须合并成一颗星，不能拆成 uid-a 和 name:苏见 两颗。
  test('merges an uid-less historical fact with the character that later got an uid, instead of a duplicate star', () => {
    const reader = fakeReader({
      cards: [{ character_uid: 'uid-a', character: '苏见' }],
      facts: [
        { id: 'f1', subject: '苏见', subject_character_uid: null, subject_character_b_uid: null, predicate: 'goal', object: '候选期的早期事实', from_chapter: 1, event_chapter: null, invalidated_at_chapter: null },
        { id: 'f2', subject: '苏见', subject_character_uid: 'uid-a', subject_character_b_uid: null, predicate: 'identity', object: '建档后事实', from_chapter: 5, event_chapter: null, invalidated_at_chapter: null },
      ],
    })

    const graph = aggregateMemoryGraph(reader)

    // 只应有一颗「苏见」星，两条事实都挂在它名下
    expect(graph.nodes.filter((node) => node.kind === 'character')).toEqual([
      { id: 'uid-a', kind: 'character', label: '苏见', ownerId: null, predicate: null, predicateLabel: null, factCount: 2, chapter: null },
    ])
    expect(graph.links).toEqual([
      { source: 'uid-a', target: 'f1', kind: 'belongs-to', label: null },
      { source: 'uid-a', target: 'f2', kind: 'belongs-to', label: null },
    ])
  })

  // I3：subject='全书' 是引擎的全书结构锚点哨兵（见 writing-context-pack.json 的 story_anchors），
  // 不是任何实体。混进来会凭空多一颗叫「全书」的星，还把书级设定当成它的事实。
  test('excludes the engine "全书" sentinel rows instead of drawing a fake character star', () => {
    const reader = fakeReader({
      cards: [{ character_uid: 'uid-a', character: '苏见' }],
      facts: [
        { id: 'w1', subject: '全书', subject_character_uid: null, subject_character_b_uid: null, predicate: 'goal', object: '中心戏剧问题：能否夺回师门', from_chapter: 1, event_chapter: null, invalidated_at_chapter: null },
        { id: 'f1', subject: '苏见', subject_character_uid: 'uid-a', subject_character_b_uid: null, predicate: 'goal', object: '找到师父下落', from_chapter: 1, event_chapter: null, invalidated_at_chapter: null },
      ],
    })

    const graph = aggregateMemoryGraph(reader)

    expect(graph.nodes.map((node) => node.label)).toEqual(['苏见', '找到师父下落'])
    expect(graph.nodes.some((node) => node.label === '全书')).toBe(false)
  })

  // M2：关系 label 真机是 200+ 字的关系状态段落，塞进一行 tooltip 是一堵墙
  test('truncates an overlong relationship label', () => {
    const longObject = '两人自幼同门'.repeat(20)
    const reader = fakeReader({
      cards: [
        { character_uid: 'uid-a', character: '苏见' },
        { character_uid: 'uid-b', character: '阿九' },
      ],
      facts: [
        { id: 'r1', subject: '苏见|阿九', subject_character_uid: 'uid-a', subject_character_b_uid: 'uid-b', predicate: 'relationship', object: longObject, from_chapter: 4, event_chapter: null, invalidated_at_chapter: null },
      ],
    })

    const label = aggregateMemoryGraph(reader).links[0]?.label ?? ''

    expect(label.length).toBe(33) // 32 字 + 省略号
    expect(label.endsWith('…')).toBe(true)
    expect(longObject.startsWith(label.slice(0, -1))).toBe(true)
  })

  // M11：同一对人常有多条有效 relationship 行（真机「苏见|阿九」实测两条）。逐行 push 会得到
  // 多条重叠平行边——看着是一条线，力导向里却是双倍 link 力，把这对星拽得贴在一起。
  test('collapses duplicate relationship rows for the same pair into one link with the latest label', () => {
    const reader = fakeReader({
      cards: [
        { character_uid: 'uid-a', character: '苏见' },
        { character_uid: 'uid-b', character: '阿九' },
      ],
      facts: [
        { id: 'r1', subject: '苏见|阿九', subject_character_uid: 'uid-a', subject_character_b_uid: 'uid-b', predicate: 'relationship', object: '同门相护', from_chapter: 4, event_chapter: null, invalidated_at_chapter: null },
        { id: 'r2', subject: '苏见|阿九', subject_character_uid: 'uid-a', subject_character_b_uid: 'uid-b', predicate: 'relationship', object: '反目成仇', from_chapter: 9, event_chapter: null, invalidated_at_chapter: null },
      ],
    })

    const graph = aggregateMemoryGraph(reader)

    expect(graph.links).toEqual([{ source: 'uid-a', target: 'uid-b', kind: 'relationship', label: '反目成仇' }])
  })

  // M11 边界：两端顺序对调的重复行也是同一对人，不能因为 source/target 反过来就漏掉去重
  test('treats a reversed pair as the same relationship', () => {
    const reader = fakeReader({
      cards: [
        { character_uid: 'uid-a', character: '苏见' },
        { character_uid: 'uid-b', character: '阿九' },
      ],
      facts: [
        { id: 'r1', subject: '苏见|阿九', subject_character_uid: 'uid-a', subject_character_b_uid: 'uid-b', predicate: 'relationship', object: '同门相护', from_chapter: 4, event_chapter: null, invalidated_at_chapter: null },
        { id: 'r2', subject: '阿九|苏见', subject_character_uid: 'uid-b', subject_character_b_uid: 'uid-a', predicate: 'relationship', object: '师兄妹', from_chapter: 6, event_chapter: null, invalidated_at_chapter: null },
      ],
    })

    expect(aggregateMemoryGraph(reader).links).toEqual([
      { source: 'uid-a', target: 'uid-b', kind: 'relationship', label: '师兄妹' },
    ])
  })

  // M10：拆 `|` 是关系行的编码，与其他谓词无关。非关系行的 subject 含 `|` 时不能被腰斩，
  // 否则 owner 变成前半段，事实挂到一颗根本不存在的星上。
  test('does not split a non-relationship subject that happens to contain a pipe', () => {
    const reader = fakeReader({
      cards: [],
      facts: [
        { id: 'f1', subject: '断水|残刃', subject_character_uid: null, subject_character_b_uid: null, predicate: 'possession', object: '刃口有缺', from_chapter: 3, event_chapter: null, invalidated_at_chapter: null },
      ],
    })

    const graph = aggregateMemoryGraph(reader)

    // 整个 "断水|残刃" 才是那个实体的名字
    expect(graph.nodes.filter((node) => node.kind === 'character').map((node) => node.id)).toEqual(['name:断水|残刃'])
    expect(graph.links).toEqual([{ source: 'name:断水|残刃', target: 'f1', kind: 'belongs-to', label: null }])
  })

  // M5：空快照曾是模块级共享的可变对象，被多条降级路径直接 return——任一调用方原地 push 就会
  // 污染之后所有调用。每次必须是新对象。
  test('returns a fresh empty snapshot object each time so callers cannot poison the module', async () => {
    const first = aggregateMemoryGraph(fakeReader({}, { throwOnFacts: true }))
    first.nodes.push({ id: 'x', kind: 'character', label: '污染', ownerId: null, predicate: null, predicateLabel: null, factCount: 0, chapter: null })

    expect(aggregateMemoryGraph(fakeReader({}, { throwOnFacts: true }))).toEqual({ nodes: [], links: [] })

    // 顶层入口的 catch 分支走的是另一条 return，同样要新建
    const opened = await readMemoryGraph({
      projectPath: '/nowhere',
      openMemoryDb: () => {
        throw new Error('no db')
      },
    })
    opened.links.push({ source: 'a', target: 'b', kind: 'relationship', label: null })

    expect(
      await readMemoryGraph({
        projectPath: '/nowhere',
        openMemoryDb: () => {
          throw new Error('no db')
        },
      }),
    ).toEqual({ nodes: [], links: [] })
  })
})
