import { describe, expect, test } from 'bun:test'
import type { MemoryGraphNode, MemoryGraphSnapshot } from '@shared/types/memory-graph'
import { buildVisibleGraph, categoryNodeId, isCategoryNodeId, isOnFocusChain } from './memory-graph-layers'

function character(id: string, label: string, factCount: number): MemoryGraphNode {
  return { id, kind: 'character', label, ownerId: null, predicate: null, predicateLabel: null, factCount, chapter: null }
}

function fact(id: string, ownerId: string, predicate: string, predicateLabel: string): MemoryGraphNode {
  return { id, kind: 'fact', label: `${id} 的内容`, ownerId, predicate, predicateLabel, factCount: 0, chapter: 1 }
}

/** 渲染层注入的复用逻辑在这些用例里无关紧要，直接透传。 */
const passthrough = <T,>(node: T): T => node

const graph: MemoryGraphSnapshot = {
  nodes: [
    character('su', '苏见', 5),
    character('jiu', '阿九', 2),
    fact('f1', 'su', 'secret', '秘密'),
    fact('f2', 'su', 'secret', '秘密'),
    fact('f3', 'su', 'goal', '目标'),
    fact('f4', 'jiu', 'identity', '身份'),
  ],
  links: [
    { source: 'su', target: 'jiu', kind: 'relationship', label: '同门相护' },
    { source: 'su', target: 'f1', kind: 'belongs-to', label: null },
    { source: 'su', target: 'f2', kind: 'belongs-to', label: null },
    { source: 'su', target: 'f3', kind: 'belongs-to', label: null },
    { source: 'jiu', target: 'f4', kind: 'belongs-to', label: null },
  ],
}

const build = (expandedId: string | null, expandedCategoryId: string | null = null) =>
  buildVisibleGraph({ graph, expandedId, expandedCategoryId, resolveNode: passthrough })

describe('buildVisibleGraph 第①档：全景', () => {
  test('只给角色与关系连线，事实一条都不出现', () => {
    const { nodes, links } = build(null)

    expect(nodes.map((node) => node.id)).toEqual(['su', 'jiu'])
    expect(links).toEqual([{ source: 'su', target: 'jiu', kind: 'relationship', label: '同门相护' }])
  })
})

describe('buildVisibleGraph 第②档：分簇', () => {
  test('展开角色时给的是按谓词归堆的分簇节点，不是摊开的事实', () => {
    const { nodes } = build('su')

    // 苏见有 3 条事实、分属 2 个谓词 → 只应长出 2 个分簇节点，事实一条都不摊开
    expect(nodes.filter((node) => node.kind === 'fact')).toEqual([])
    expect(nodes.filter((node) => node.kind === 'category').map((node) => [node.label, node.factCount])).toEqual([
      ['秘密', 2],
      ['目标', 1],
    ])
  })

  test('分簇只挂在被展开的角色下，且连线从该角色指向分簇', () => {
    const { nodes, links } = build('su')

    expect(nodes.filter((node) => node.kind === 'category').every((node) => node.ownerId === 'su')).toBe(true)
    // 阿九的身份事实不该冒出来
    expect(nodes.some((node) => node.predicate === 'identity')).toBe(false)

    const belongs = links.filter((link) => link.kind === 'belongs-to')
    expect(belongs.map((link) => [link.source, link.target])).toEqual([
      ['su', categoryNodeId('su', 'secret')],
      ['su', categoryNodeId('su', 'goal')],
    ])
  })

  test('角色节点在展开后仍然全部保留（星座不塌）', () => {
    expect(build('su').nodes.filter((node) => node.kind === 'character').map((node) => node.id)).toEqual(['su', 'jiu'])
  })
})

describe('buildVisibleGraph 第③档：事实', () => {
  test('只摊开被点开的那一堆，别的堆仍是分簇', () => {
    const { nodes } = build('su', categoryNodeId('su', 'secret'))

    expect(nodes.filter((node) => node.kind === 'fact').map((node) => node.id)).toEqual(['f1', 'f2'])
    // 「目标」那堆没被点开，仍以分簇形态存在，其事实 f3 不出现
    expect(nodes.some((node) => node.id === 'f3')).toBe(false)
    expect(nodes.filter((node) => node.kind === 'category')).toHaveLength(2)
  })

  test('事实连的是它所属的分簇，不是角色——否则等于绕过了分层', () => {
    const secretId = categoryNodeId('su', 'secret')
    const { links } = build('su', secretId)

    const factLinks = links.filter((link) => link.target === 'f1' || link.target === 'f2')
    expect(factLinks.map((link) => link.source)).toEqual([secretId, secretId])
  })

  test('分簇 id 对不上（如切换角色后残留）时不摊开任何事实，也不抛错', () => {
    const { nodes } = build('su', categoryNodeId('jiu', 'identity'))

    expect(nodes.filter((node) => node.kind === 'fact')).toEqual([])
  })
})

describe('buildVisibleGraph 规模控制', () => {
  test('主角百余条事实在分簇档只压缩成个位数节点', () => {
    // 真机主角是 167 条事实——这正是分簇要解决的场景：全摊开会叠成一颗毛球把角色埋掉
    const many: MemoryGraphNode[] = []
    const predicates = ['secret', 'goal', 'identity', 'location', 'ability', 'status']
    for (let i = 0; i < 167; i += 1) {
      const predicate = predicates[i % predicates.length]
      many.push(fact(`m${i}`, 'su', predicate, predicate))
    }
    const bigGraph: MemoryGraphSnapshot = { nodes: [character('su', '苏见', 167), ...many], links: [] }

    const { nodes } = buildVisibleGraph({
      graph: bigGraph,
      expandedId: 'su',
      expandedCategoryId: null,
      resolveNode: passthrough,
    })

    expect(nodes.filter((node) => node.kind === 'category')).toHaveLength(predicates.length)
    expect(nodes.filter((node) => node.kind === 'fact')).toEqual([])
    // 分簇上的条数要如实反映堆的大小，否则用户无从判断该点哪一堆
    expect(nodes.filter((node) => node.kind === 'category').reduce((sum, node) => sum + node.factCount, 0)).toBe(167)
  })

  test('缺谓词的事实归到一个兜底堆，不被丢掉', () => {
    const odd: MemoryGraphSnapshot = {
      nodes: [
        character('su', '苏见', 1),
        { ...fact('f9', 'su', 'x', 'x'), predicate: null, predicateLabel: null },
      ],
      links: [],
    }

    const { nodes } = buildVisibleGraph({
      graph: odd,
      expandedId: 'su',
      expandedCategoryId: null,
      resolveNode: passthrough,
    })

    expect(nodes.filter((node) => node.kind === 'category')).toHaveLength(1)
    expect(nodes.find((node) => node.kind === 'category')?.factCount).toBe(1)
  })
})

describe('isOnFocusChain：链路内保持、链路外压暗', () => {
  const su = character('su', '苏见', 5)
  const jiu = character('jiu', '阿九', 2)
  const secretCat = { ...su, id: categoryNodeId('su', 'secret'), kind: 'category' as const, ownerId: 'su', predicate: 'secret' }
  const goalCat = { ...su, id: categoryNodeId('su', 'goal'), kind: 'category' as const, ownerId: 'su', predicate: 'goal' }
  const secretFact = fact('f1', 'su', 'secret', '秘密')

  test('全景态没有链路概念，所有节点一视同仁', () => {
    expect(isOnFocusChain(su, null, null)).toBe(true)
    expect(isOnFocusChain(jiu, null, null)).toBe(true)
  })

  test('分簇档：只有被展开的角色和它的分簇在链路上，别的角色要暗', () => {
    expect(isOnFocusChain(su, 'su', null)).toBe(true)
    expect(isOnFocusChain(jiu, 'su', null)).toBe(false)
    // 还没选具体哪一堆，该角色的分簇整层都算链路
    expect(isOnFocusChain(secretCat, 'su', null)).toBe(true)
    expect(isOnFocusChain(goalCat, 'su', null)).toBe(true)
  })

  test('事实档：链路收窄到被点开的那一堆，兄弟分簇也要暗', () => {
    const openId = categoryNodeId('su', 'secret')

    expect(isOnFocusChain(su, 'su', openId)).toBe(true)
    expect(isOnFocusChain(secretCat, 'su', openId)).toBe(true)
    // 这条是关键：不把兄弟分簇压暗，"钻进了哪一类"就仍然看不出来
    expect(isOnFocusChain(goalCat, 'su', openId)).toBe(false)
    expect(isOnFocusChain(secretFact, 'su', openId)).toBe(true)
  })

  test('别的角色的分簇任何时候都不在链路上', () => {
    const otherCat = { ...jiu, id: categoryNodeId('jiu', 'identity'), kind: 'category' as const, ownerId: 'jiu' }

    expect(isOnFocusChain(otherCat, 'su', null)).toBe(false)
    expect(isOnFocusChain(otherCat, 'su', categoryNodeId('su', 'secret'))).toBe(false)
  })
})

describe('分簇 id', () => {
  test('与真实节点 id 区分得开，供缓存淘汰时豁免', () => {
    expect(isCategoryNodeId(categoryNodeId('su', 'secret'))).toBe(true)
    expect(isCategoryNodeId('su')).toBe(false)
    expect(isCategoryNodeId('f1')).toBe(false)
  })
})
