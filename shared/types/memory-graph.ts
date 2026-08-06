/**
 * 记忆星图（只读展示层）的跨进程 DTO。
 *
 * 数据源：`.narracat/memory.db` 的 facts / character_cards——App 只读聚合，写入由引擎侧
 * memory-keeper 经提交工具独占。星图只消费有效事实（invalidated_at_chapter IS NULL）。
 *
 * 两类节点：character（角色，第一层星座）与 fact（事实，点击角色后展开的星尘）。
 * 两类连线：relationship（角色↔角色，第一层）与 belongs-to（角色→其事实，第二层）。
 * chapter 字段（事实首次成立的章号）本期不消费，为后续「按章回放」预留，不删。
 */

export type MemoryGraphNodeKind = 'character' | 'fact'

export interface MemoryGraphNode {
  /**
   * 节点唯一 id：事实为 facts.id；角色为「角色 key」——优先 character_uid，uid 缺失时兜底成
   * `name:<角色名>`（详见下方 ownerId 注释，两种形态同样适用于此处）。
   */
  id: string
  kind: MemoryGraphNodeKind
  /** 展示名：角色为角色名；事实为事实内容（facts.object） */
  label: string
  /**
   * 事实节点所属角色的「角色 key」；角色节点为 null。
   *
   * ⚠️ 不是恒等于 character_uid：老库的 subject_character_uid 列可能整片从未回填，聚合层对这类
   * 行按名字兜底成 `name:<角色名>`（真机某本书 27 个角色里 21 个是这种兜底键）。所以它有两种形态：
   * - 真 uid（如 `chr_7f3a…`）——可拿去查 character_cards / facts；
   * - `name:` 前缀的兜底键——拿去查 character_cards 只会查空，要先剥前缀按名字查。
   * 只在展示层用它做「同一颗星的归属分组」是安全的；任何要落回数据库的用法都必须先分辨形态。
   */
  ownerId: string | null
  /** 事实节点的谓词机器名（如 secret / goal）；角色节点为 null */
  predicate: string | null
  /** 事实节点的谓词中文标签（如「秘密」）；角色节点为 null */
  predicateLabel: string | null
  /** 角色节点的有效事实条数（渲染端据此定星球大小）；事实节点为 0 */
  factCount: number
  /** 事实首次成立的章号（event_chapter 优先，回落 from_chapter）；缺失或角色节点为 null */
  chapter: number | null
}

export interface MemoryGraphLink {
  /** 起点节点 id */
  source: string
  /** 终点节点 id */
  target: string
  kind: 'relationship' | 'belongs-to'
  /** 关系连线的状态描述（facts.object）；belongs-to 连线为 null */
  label: string | null
}

export interface MemoryGraphSnapshot {
  nodes: MemoryGraphNode[]
  links: MemoryGraphLink[]
}
