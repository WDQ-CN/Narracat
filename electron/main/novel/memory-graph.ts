import { join } from 'node:path'

import { characterPredicateLabel } from '@shared/lib/character-predicate-labels'
import type { MemoryGraphLink, MemoryGraphNode, MemoryGraphSnapshot } from '@shared/types/memory-graph'
import { readNovelId } from './character-state'
import type { MemoryDbReader, OpenMemoryDb } from './memory-db'
import { narracatMemoryDbPath } from './novel-layout'

/**
 * 记忆星图只读聚合（纯展示层）。
 *
 * 口径（照 character-state.ts / planned-state-read.ts 先例）：
 * - App 对 memory.db 只读，写入由引擎侧 memory-keeper 经提交工具独占；
 * - 只画有效事实（invalidated_at_chapter IS NULL）——失效事实是历史账，不进星图；
 * - novel_id 有则过滤、缺失则全表读（单库单小说兜底）；
 * - 全链吞错降级为空快照，绝不抛给渲染进程。
 *
 * 角色节点来源是并集：character_cards（引擎物化的已建档角色，取卡上人读名）
 * ∪ facts 里出现过的角色——只有卡而无事实的角色仍要出现（孤星），只有事实而无卡的
 * 角色也要出现（卡尚未刷新）。
 *
 * 节点 key 优先用 character_uid；uid 缺失时按名字兜底成 `name:<名字>`——老库的 uid 列
 * 可能从未回填，全丢会让整张星图空白，宁可按名字聚合（同名合并是可接受的展示层近似）。
 */

/**
 * 空快照必须每次新建：模块级共享一份可变对象会被多条降级路径直接 return 出去，任一调用方
 * 若原地 push 进 nodes/links（或 IPC 层做原地改写），污染会跨调用、跨小说扩散到全模块。
 */
function emptySnapshot(): MemoryGraphSnapshot {
  return { nodes: [], links: [] }
}

/**
 * 引擎保留哨兵：`subject='全书'` 的 facts 是全书结构锚点（中心戏剧问题 / 核心欲望 / 对抗力量
 * 等，见 agent-core/narracat/schemas/writing-context-pack.json 的 story_anchors），不是任何
 * 实体。放进星图会凭空多出一颗名叫「全书」的角色星，还把一堆书级设定挂成它的事实。
 */
const WHOLE_BOOK_SENTINEL = '全书'

/** 关系连线 label 的最长展示长度：真机实测 facts.object 是 200+ 字的关系状态段落，塞进小 tooltip 是一堵墙。 */
const RELATION_LABEL_MAX = 32

interface CardRow {
  character_uid: string
  character: string
}

interface FactRow {
  id: string
  subject: string
  subject_character_uid: string | null
  subject_character_b_uid: string | null
  predicate: string
  object: string
  from_chapter: number | null
  event_chapter: number | null
  invalidated_at_chapter: number | null
}

/** 关系行 subject 是 `"名A|名B"`（引擎按字典序排序后 `|` 连接）；非关系行原样返回。 */
function relationshipNames(subject: string): [string, string] | null {
  const parts = subject.split('|')
  if (parts.length !== 2) return null
  const [a, b] = parts.map((part) => part.trim())
  return a && b ? [a, b] : null
}

/**
 * 从一行 fact 里解出两端角色名：关系行拆 "名A|名B"；非关系行 subject 本身就是（唯一的）角色名。
 *
 * 拆 `|` 只对 `predicate === 'relationship'` 生效——`"A|B"` 是引擎给关系行定的编码，其他谓词的
 * subject 就是一个普通名字。不按谓词设限的话，任何恰好含一个 `|` 的实体名（道具/组织名里出现
 * 分隔符并非不可能）会被腰斩，owner 被算成前半段，事实挂错星。
 */
function factNames(row: FactRow): { nameA: string; nameB: string } {
  const subject = typeof row.subject === 'string' ? row.subject.trim() : ''
  if (row.predicate !== 'relationship') return { nameA: subject, nameB: '' }
  const names = relationshipNames(subject)
  return names ? { nameA: names[0], nameB: names[1] } : { nameA: subject, nameB: '' }
}

/** 关系名过长时截断加省略号——悬浮只需读出「这是什么关系」，完整状态段落不属于一行 tooltip。 */
function truncateRelationLabel(text: string): string {
  return text.length > RELATION_LABEL_MAX ? `${text.slice(0, RELATION_LABEL_MAX)}…` : text
}

/**
 * character_cards 读失败时局部降级为 `[]`（不牵连 facts）——决策记录（fix round 1 评审 Finding 1，
 * 选 (b)）：cards 只是「更好看的展示名」来源，图的骨架（角色是谁、有哪些事实、谁跟谁有关系）
 * 全部来自 facts；cards 缺失顶多让部分角色退化成 `name:` 兜底展示名，不该让整张星图空白。
 * 与 readValidFacts 的 fail-closed 不对称是有意的：facts 不可读 = 骨架本身缺失，无从聚合；
 * cards 不可读 = 只是缺一层装饰。见 memory-graph.test.ts「character_cards 不可读」用例固化本行为。
 */
function readCards(reader: MemoryDbReader, novelId: string | null): CardRow[] {
  try {
    return novelId
      ? reader.all<CardRow>(
          'SELECT character_uid, character FROM character_cards WHERE novel_id = ? ORDER BY rowid ASC',
          novelId,
        )
      : reader.all<CardRow>('SELECT character_uid, character FROM character_cards ORDER BY rowid ASC')
  } catch {
    return []
  }
}

/**
 * 返回 null 表示 facts 表本身不可读（缺表/查询报错，非「查得到但零行」）——
 * 调用方须据此整体降级为空快照，不能拿 cards 数据凑出半张星图（见 aggregateMemoryGraph）。
 *
 * SQL 里的 `invalidated_at_chapter IS NULL` 是给真实 SQLite 的过滤条件；这里再叠一层 JS
 * 侧 filter 作为保险——纯函数不应假设调用方传入的 reader 一定会尊重 WHERE 子句语义。
 */
function readValidFacts(reader: MemoryDbReader, novelId: string | null): FactRow[] | null {
  // 只 SELECT 全版本都存在的列：secret_known / source 是后加列，星图不消费，不必探列。
  const columns =
    'id, subject, subject_character_uid, subject_character_b_uid, predicate, object, from_chapter, event_chapter, invalidated_at_chapter'
  try {
    const rows = novelId
      ? reader.all<FactRow>(
          `SELECT ${columns} FROM facts WHERE novel_id = ? AND invalidated_at_chapter IS NULL ORDER BY rowid ASC`,
          novelId,
        )
      : reader.all<FactRow>(
          `SELECT ${columns} FROM facts WHERE invalidated_at_chapter IS NULL ORDER BY rowid ASC`,
        )
    return rows.filter(
      (row) =>
        row.invalidated_at_chapter === null &&
        (typeof row.subject !== 'string' || row.subject.trim() !== WHOLE_BOOK_SENTINEL),
    )
  } catch {
    return null
  }
}

/** 纯函数：从 reader 聚合星图快照。角色按首次出现顺序稳定排序，事实挂在其角色之后。 */
export function aggregateMemoryGraph(reader: MemoryDbReader): MemoryGraphSnapshot {
  const novelId = readNovelId(reader)
  const cards = readCards(reader, novelId)
  const facts = readValidFacts(reader, novelId)
  // facts 表本身不可读：宁可整张星图空白，也不用只有 cards 的半成品糊弄（fail-closed）。
  if (facts === null) return emptySnapshot()
  if (cards.length === 0 && facts.length === 0) return emptySnapshot()

  const characterNames = new Map<string, string>()
  for (const card of cards) {
    const uid = typeof card.character_uid === 'string' ? card.character_uid.trim() : ''
    const name = typeof card.character === 'string' ? card.character.trim() : ''
    if (uid && name && !characterNames.has(uid)) characterNames.set(uid, name)
  }

  /**
   * 名字 → uid 反查表（fix round 1 评审 Finding 2）：引擎允许候选/未建档角色的 fact 以
   * subject_character_uid=NULL 落库（仅警告不拦截）；该角色之后建档拿到 uid 时，引擎没有任何
   * 回填逻辑把它早期 uid=NULL 的历史 fact 补上 uid（全仓核实：无 `UPDATE facts SET
   * subject_character_uid` 写路径）。若不预先建好这张反查表，同一个人会被拆成 uid 键的星
   * 和 `name:` 前缀键的星两颗——对「一人一星」的星图是硬伤。
   *
   * 必须在遍历建节点之前完整预扫一遍：facts 已整体读入内存（不是真流式游标），但数组内 uid=NULL
   * 的行可能排在带 uid 的行之前（候选阶段事实章号更小、rowid 更小）；不预扫会导致「先遇到的行
   * 决定 key」这种顺序敏感的分裂。
   *
   * 代价（明写出来，别当它没有）：这是按「名字」合并，同名不同人会被错误合并成一颗星——两个都叫
   * 「阿九」的路人会共用先注册的那个 uid，factCount 虚增，极端情况下 A 的 secret 事实会挂到 B 的
   * 星上展示。星图是只读展示层，错合的后果止于观感；但若日后有人拿这里的 ownerId 去做写路径或
   * 权限判断（谁能看到谁的秘密），这个合并就不再是可接受近似，必须先换成真 uid 口径。
   */
  const nameToUid = new Map<string, string>()
  for (const [uid, name] of characterNames) {
    if (!nameToUid.has(name)) nameToUid.set(name, uid)
  }
  for (const row of facts) {
    const uidA = typeof row.subject_character_uid === 'string' ? row.subject_character_uid.trim() : ''
    const uidB = typeof row.subject_character_b_uid === 'string' ? row.subject_character_b_uid.trim() : ''
    const { nameA, nameB } = factNames(row)
    if (uidA && nameA && !nameToUid.has(nameA)) nameToUid.set(nameA, uidA)
    if (uidB && nameB && !nameToUid.has(nameB)) nameToUid.set(nameB, uidB)
  }

  const factNodes: MemoryGraphNode[] = []
  const links: MemoryGraphLink[] = []
  const factCounts = new Map<string, number>()
  /**
   * 同一对角色 → 已产出的关系连线在 links 里的下标。同一对人常有多条有效 relationship 行
   * （真机实测「苏见|阿九」就有两条），逐行 push 会得到多条重叠平行边：视觉上看着是一条线，
   * 力导向里却是 N 倍的 link 力，把这对星硬拽到贴在一起。按无序对去重，label 取最新一条
   * （facts 按 rowid ASC 读入，后来的行即更新的关系状态）。
   */
  const relationshipLinkIndex = new Map<string, number>()

  /**
   * 角色节点 key：优先行内 uid；缺 uid 时先查反查表复用已注册的 uid（合并同名候选/建档两段
   * 历史），查不到才按名字兜底成 `name:<名字>`（老库 uid 列可能整片从未回填）。
   */
  function characterKey(uid: string, name: string): string {
    const resolvedUid = uid || (name ? (nameToUid.get(name) ?? '') : '')
    if (resolvedUid) {
      if (name && !characterNames.has(resolvedUid)) characterNames.set(resolvedUid, name)
      return resolvedUid
    }
    if (!name) return ''
    const key = `name:${name}`
    if (!characterNames.has(key)) characterNames.set(key, name)
    return key
  }

  for (const row of facts) {
    const uidA = typeof row.subject_character_uid === 'string' ? row.subject_character_uid.trim() : ''
    const uidB = typeof row.subject_character_b_uid === 'string' ? row.subject_character_b_uid.trim() : ''
    const object = typeof row.object === 'string' ? row.object.trim() : ''
    const { nameA, nameB } = factNames(row)

    if (row.predicate === 'relationship') {
      const keyA = characterKey(uidA, nameA)
      const keyB = characterKey(uidB, nameB)
      // 两端都认得出才画关系线；否则落到下面降级成普通事实星尘，不画断头线。
      if (keyA && keyB && keyA !== keyB) {
        const label = object ? truncateRelationLabel(object) : null
        // JSON.stringify 而非拼接分隔符：角色 key 可能是 `name:<名字>`，名字里含空格或冒号都
        // 不稀奇，拼接式 key 会让本不相干的两对人撞成同一个键
        const pairKey = JSON.stringify([keyA, keyB].sort())
        const existing = relationshipLinkIndex.get(pairKey)
        const previous = existing === undefined ? undefined : links[existing]
        if (existing === undefined || !previous) {
          relationshipLinkIndex.set(pairKey, links.length)
          links.push({ source: keyA, target: keyB, kind: 'relationship', label })
        } else if (label) {
          // 保住首次出现的位置与两端方向，只把 label 刷成最新一条关系状态
          links[existing] = { ...previous, label }
        }
        continue
      }
    }

    const ownerId = characterKey(uidA, nameA) || characterKey(uidB, nameB)
    if (!ownerId) continue
    const factId = typeof row.id === 'string' ? row.id.trim() : ''
    if (!factId || !object) continue
    factNodes.push({
      id: factId,
      kind: 'fact',
      label: object,
      ownerId,
      predicate: row.predicate,
      predicateLabel: characterPredicateLabel(row.predicate),
      factCount: 0,
      chapter: row.event_chapter ?? row.from_chapter ?? null,
    })
    links.push({ source: ownerId, target: factId, kind: 'belongs-to', label: null })
    factCounts.set(ownerId, (factCounts.get(ownerId) ?? 0) + 1)
  }

  const characterNodes: MemoryGraphNode[] = []
  for (const [uid, name] of characterNames) {
    characterNodes.push({
      id: uid,
      kind: 'character',
      label: name,
      ownerId: null,
      predicate: null,
      predicateLabel: null,
      factCount: factCounts.get(uid) ?? 0,
      chapter: null,
    })
  }

  return { nodes: [...characterNodes, ...factNodes], links }
}

/** 顶层读取：打开只读 memory.db 聚合星图。缺库 / 缺表 / 读失败一律返回空快照。 */
export async function readMemoryGraph(input: {
  projectPath: string
  openMemoryDb: OpenMemoryDb
}): Promise<MemoryGraphSnapshot> {
  let reader: MemoryDbReader | null = null
  try {
    reader = input.openMemoryDb(join(input.projectPath, narracatMemoryDbPath()))
    return aggregateMemoryGraph(reader)
  } catch {
    return emptySnapshot()
  } finally {
    try {
      reader?.close()
    } catch {
      // ignore close failures
    }
  }
}
