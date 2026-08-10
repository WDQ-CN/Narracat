// 设置页「写作指令」区的数据拼装：引擎当前块 × 用户存量 → 每块一个 view（含状态）。
//
// 生效回执走本查询而非在 run 里落状态文件（spec §11 定案）：状态完全由「当前引擎块 × store」
// 决定，等价且简单得多，不必把回执穿过整条运行链。

import { parseProseBlocks, resolveBlockStatus } from '@shared/lib/prose-blocks'
import type { ProseBlockView, ProseOverrideEntry } from '@shared/types/prose-block'
import { NARRACAT_ENGINE_AGENT_IDS } from '../engine/agent-core-contract.ts'

/**
 * 渲染端传来的 agentId 是否在引擎内置 agent 白名单内。主进程侧据此路径读 `agents/${agentId}.md`，
 * 不校验就会把渲染端字符串直接拼进文件路径——同类拼接在本仓其余地方（agent-core-contract.ts /
 * assemble-agent-skills.ts）一律取自这份封闭集合而非 IPC 原始入参，这里必须对齐同一道防线。
 */
export function isKnownProseAgentId(agentId: string): boolean {
  return (NARRACAT_ENGINE_AGENT_IDS as readonly string[]).includes(agentId)
}

/**
 * 该 Agent 当前文件里定义的块 id 集合。供「恢复当前 Agent 的官方默认」定位可清范围——
 * 只能读到这一份 agentText 里解析出的 id，天然排除了其他 Agent 的块与孤儿存量，
 * 不需要额外过滤就保证「reset-all 不会误清其他 Agent」。
 */
export function currentBlockIds(agentText: string): string[] {
  return parseProseBlocks(agentText).map((block) => block.id)
}

export function buildProseBlockViews(input: {
  agentText: string
  overrides: Record<string, ProseOverrideEntry>
  /**
   * 全部 Agent（不只当前渲染的这一个）当前定义的块 id 全集。孤儿判定必须靠它，不能只看
   * `agentText` 解析出的块——否则「属于另一个 Agent 的覆盖」会被误当成「哪个 Agent 都不认领」
   * 的孤儿，错误地追加进这个 Agent 的列表（复审修复的真机事故：作者调的是大纲架构师的设置，
   * 切到写手面板却看见一条状态「已不存在」的坏条目）。
   *
   * 不在这个全集里的 id 才是真孤儿；在全集里但不在当前 `agentText` 里的 id 属于别的 Agent，
   * 本函数对它完全不可见——既不进块列表，也不进孤儿列表。
   */
  knownIdsAcrossAgents: ReadonlySet<string>
}): ProseBlockView[] {
  const blocks = parseProseBlocks(input.agentText)
  const currentIds = new Set(blocks.map((block) => block.id))
  const views: ProseBlockView[] = blocks.map((block) => {
    const override = input.overrides[block.id]
    const view: ProseBlockView = {
      id: block.id,
      title: block.title,
      officialText: block.body,
      userText: override ? override.text : null,
      baseText: override ? override.baseText : null,
      status: resolveBlockStatus(block, override),
    }
    if (block.hint) view.hint = block.hint
    return view
  })

  // 真孤儿（哪个 Agent 都不认领）追加到末尾：不静默丢弃，否则作者以为设置还生效。
  // 属于其他 Agent 的 id（在全集里、但不在当前 agentText 里）直接跳过，交给它自己所属的
  // Agent 面板去渲染。
  for (const [id, override] of Object.entries(input.overrides)) {
    if (currentIds.has(id)) continue
    if (input.knownIdsAcrossAgents.has(id)) continue
    views.push({
      id,
      title: id,
      officialText: '',
      userText: override.text,
      baseText: override.baseText,
      status: 'missing',
    })
  }

  return views
}
