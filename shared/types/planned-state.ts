/**
 * 计划状态变更（planned_state_changes）只读通道的共享 DTO（A4×D2 片3b，spec §2.1/§7.1）。
 *
 * 数据源：引擎侧 `planned_state_changes` 五态计划账表（片3a，T1/T2）——章纲提交时把
 * chapter_outline.state_changes 镜像进这张表；`/write` 收尾按 novel_check_state_delivery
 * 兑现比对推进 status（planned → delivered/deferred/cancelled），acknowledged 由作者标记。
 * App 只读聚合三个消费端：章纲卡账本区（按章）、角色页轻提示②（按角色，仅 planned）、
 * 目录徽标（按章计数，仅 planned；「未兑现」判定留给渲染端用 toc 精确章状态 join）。
 */

export type PlannedStateStatus = 'planned' | 'delivered' | 'deferred' | 'cancelled' | 'acknowledged'

export interface PlannedStateRowDto {
  id: string
  chapter: number
  status: PlannedStateStatus
  deferredToChapter: number | null
  characterUid: string
  characterName: string
  dimension: string
  operation: 'set' | 'add' | 'remove'
  value: string
  reason: string | null
}

export interface PlannedStateDimensionDto {
  key: string
  displayName: string
  cardinality: 'one' | 'many'
  valueType: 'enum' | 'free'
  /** enum 维度的值域梯子；free 维度省略该字段（与词表定义同构，无值域可编辑范围） */
  values?: string[]
}

export interface PlannedStateCharacterDto {
  uid: string
  name: string
}

export interface ChapterPlannedStateSnapshot {
  /** memory.db 可读且 novel_id 在；false 时账本区整体不渲染 */
  available: boolean
  rows: PlannedStateRowDto[]
  /** 编辑器下拉数据；词表缺失 = 空数组（账本区据此禁编辑，行照常展示，spec §2.1/P2-2） */
  dimensions: PlannedStateDimensionDto[]
  /** 有实体 json 的角色（bible/characters/*.json） */
  characters: PlannedStateCharacterDto[]
  /**
   * 该章 json 的 `state_changes` 现值——用作提交编辑时的 CAS 基线（引擎侧 novel_submit_chapter_outline
   * 重提交按 `json.state_changes ?? []` 与当前计划表镜像比对）。两种「无」的语义不同，调用方须分辨：
   * - `null`：章纲 json 文件本身缺失/不可读 → 无基线可用，编辑入口应整体禁用；
   * - `[]`：json 存在但没有 state_changes 字段（或字段本就是空数组）→ 基线就是空数组，
   *   可以正常提交（等价于「本章目前无计划状态变更」），编辑入口正常开放。
   */
  jsonStateChanges: unknown[] | null
}

/** 角色页轻提示②：仅该角色未来的 status='planned' 行，供「即将变化」摘要展示。 */
export interface CharacterFuturePlansSnapshot {
  available: boolean
  rows: PlannedStateRowDto[]
}

export type PlannedStateScope =
  | { kind: 'chapter'; chapter: number }
  | { kind: 'character'; characterUid: string }

export interface ReadPlannedStateInput {
  projectPath: string
  scope: PlannedStateScope
}

/**
 * chapter scope 返回完整 {@link ChapterPlannedStateSnapshot}；character scope 返回
 * {@link CharacterFuturePlansSnapshot}（结构上是前者的子集，`'dimensions' in result` 可用于窄化）。
 * 调用方在发起请求时已知 scope.kind，通常无需运行时窄化即可直接按预期形状使用。
 */
export type PlannedStateReadResult = ChapterPlannedStateSnapshot | CharacterFuturePlansSnapshot

export interface ReadPlannedStateCountsInput {
  projectPath: string
}

/** 按章计数（chapter 号 → status='planned' 行数），目录徽标只读消费。 */
export type PlannedStateCounts = Record<string, number>
