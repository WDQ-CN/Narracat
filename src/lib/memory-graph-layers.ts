import type { MemoryGraphNode, MemoryGraphSnapshot } from '@shared/types/memory-graph'

/**
 * 记忆星图的**逐级展开**分层逻辑（纯函数，与 three.js 无关，故可单测）。
 *
 * 三档：
 *   ① 全景     只有角色 + 关系连线
 *   ② 分簇     点开某角色 → 它的事实按谓词归堆，每堆一个节点（带条数）
 *   ③ 事实     点开某一堆 → 只摊开这一堆里的事实
 *
 * 为什么要中间这一档：真机主角有 167 条事实，若在第②档就全摊开，它们会以同一距离挂在
 * 角色周围，球壳表面积刚好被占满，必然叠成一颗毛球，把角色本身和名字一起埋掉。先给
 * 八九个类别、再往下钻，每层的节点数才都在看得清的量级。
 *
 * 「分簇」是**纯渲染概念**，不进数据层契约（`shared/types/memory-graph.ts` 只有
 * character 与 fact）：它不是记忆库里的实体，只是"这个角色的事实按谓词归的堆"。
 */

export interface CanvasNode {
  id: string
  kind: 'character' | 'category' | 'fact'
  label: string
  ownerId: string | null
  predicate: string | null
  predicateLabel: string | null
  /** 角色=自己的事实数；分簇=本堆的事实数；事实=0。决定星点大小。 */
  factCount: number
  chapter: number | null
}

/**
 * source/target 传入时是节点 id 字符串，**力导向库会在运行时把它们原地改写成节点对象
 * 引用**。本模块不消费这两个字段，故用泛型让渲染层按自己的库类型收窄，避免在这里
 * 引入对 three/react-force-graph 的类型依赖（本模块要保持可单测、零图形依赖）。
 */
export interface CanvasLink<TNodeRef = unknown> {
  kind: string
  label: string | null
  source?: string | number | TNodeRef
  target?: string | number | TNodeRef
}

export interface VisibleGraph<TNodeRef = unknown> {
  nodes: CanvasNode[]
  links: CanvasLink<TNodeRef>[]
  /** id → 节点，供渲染层每帧按 id 反查（含本次未展开的事实，展开瞬间即可取到）。 */
  index: Map<string, CanvasNode>
}

/** 合成的分簇节点 id 前缀。真实节点 id 是角色 uid 或 facts.id，不会以此开头。 */
export const CATEGORY_ID_PREFIX = 'cat:'

export function categoryNodeId(ownerId: string, predicate: string): string {
  return `${CATEGORY_ID_PREFIX}${ownerId}:${predicate}`
}

export function isCategoryNodeId(id: string): boolean {
  return id.startsWith(CATEGORY_ID_PREFIX)
}

/**
 * 该节点是否在「当前正被查看的那条链路」上：角色 → 它的某个分簇 → 那个分簇里的事实。
 *
 * 链路上的保持原样，链路外的由渲染层压暗——用户逐级钻进去之后，一眼就能看出自己
 * 正在看哪一支，而不是在一片同样亮度的点里找。
 *
 * 分档语义：
 * - 全景（未展开任何角色）：无所谓链路，全部算在内，整张图保持同一亮度。
 * - 分簇档：链路 = 被展开的角色 + 它的全部分簇（还没选具体哪一堆，所以整层都算）。
 * - 事实档：链路收窄到被点开的那一堆 —— 同一角色的**兄弟分簇也要暗下去**，
 *   否则"钻进了哪一类"仍然看不出来。
 */
export function isOnFocusChain(
  node: CanvasNode,
  expandedId: string | null,
  expandedCategoryId: string | null,
): boolean {
  if (!expandedId) return true
  if (node.kind === 'character') return node.id === expandedId
  if (node.kind === 'category') {
    if (node.ownerId !== expandedId) return false
    return !expandedCategoryId || node.id === expandedCategoryId
  }
  // 事实只在它那一堆被点开时才会出现，出现即在链路上
  return node.ownerId === expandedId
}

/**
 * 按当前展开状态算出该渲染哪些节点与连线。
 *
 * `resolveNode` 由渲染层注入：它负责跨渲染复用同一个节点对象引用（力导向库会把收敛后的
 * 坐标原地写回节点对象，每次重建新对象会让整张图炸开重排）。本函数不关心它怎么实现。
 */
export function buildVisibleGraph<TNodeRef = unknown>({
  graph,
  expandedId,
  expandedCategoryId,
  resolveNode,
}: {
  graph: MemoryGraphSnapshot
  expandedId: string | null
  expandedCategoryId: string | null
  resolveNode: (node: CanvasNode) => CanvasNode
}): VisibleGraph<TNodeRef> {
  const index = new Map<string, CanvasNode>(graph.nodes.map((node) => [node.id, node]))
  const characters = graph.nodes.filter((node) => node.kind === 'character').map(resolveNode)
  const relationships: CanvasLink<TNodeRef>[] = graph.links
    .filter((link) => link.kind === 'relationship')
    .map((link) => ({ ...link }))

  if (!expandedId) {
    return { nodes: characters, links: relationships, index }
  }

  // ② 分簇：把该角色的事实按谓词归堆
  const byPredicate = new Map<string, MemoryGraphNode[]>()
  for (const node of graph.nodes) {
    if (node.kind !== 'fact' || node.ownerId !== expandedId) continue
    const key = node.predicate ?? 'unknown'
    const bucket = byPredicate.get(key)
    if (bucket) bucket.push(node)
    else byPredicate.set(key, [node])
  }

  const categories: CanvasNode[] = []
  const categoryLinks: CanvasLink<TNodeRef>[] = []
  for (const [predicate, facts] of byPredicate) {
    const id = categoryNodeId(expandedId, predicate)
    const label = facts[0]?.predicateLabel ?? predicate
    const node = resolveNode({
      id,
      kind: 'category',
      label,
      ownerId: expandedId,
      predicate,
      predicateLabel: label,
      factCount: facts.length,
      chapter: null,
    })
    index.set(id, node)
    categories.push(node)
    categoryLinks.push({ kind: 'belongs-to', label: null, source: expandedId, target: id })
  }

  if (!expandedCategoryId) {
    return {
      nodes: [...characters, ...categories],
      links: [...relationships, ...categoryLinks],
      index,
    }
  }

  // ③ 事实：只摊开被点开的那一堆
  const openPredicate = categories.find((node) => node.id === expandedCategoryId)?.predicate
  const dust = (openPredicate ? (byPredicate.get(openPredicate) ?? []) : []).map(resolveNode)
  const dustLinks: CanvasLink<TNodeRef>[] = dust.map((fact) => ({
    kind: 'belongs-to',
    label: null,
    source: expandedCategoryId,
    target: fact.id,
  }))

  return {
    nodes: [...characters, ...categories, ...dust],
    links: [...relationships, ...categoryLinks, ...dustLinks],
    index,
  }
}
