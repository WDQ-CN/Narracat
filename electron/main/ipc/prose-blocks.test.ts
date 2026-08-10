import { describe, expect, test } from 'bun:test'
import { buildProseBlockViews, currentBlockIds, isKnownProseAgentId } from './prose-blocks'
import type { ProseOverrideEntry } from '@shared/types/prose-block'

const AGENT_TEXT = `<!-- narracat:prose id="block-one" title="甲" hint="提示甲" -->
官方甲。
<!-- /narracat:prose -->

锁死段落。

<!-- narracat:prose id="block-two" title="乙" -->
官方乙。
<!-- /narracat:prose -->
`

// 模拟另一个 Agent（如大纲架构师）自己的块，供跨 Agent 孤儿判定测试用。
const OTHER_AGENT_TEXT = `<!-- narracat:prose id="outline-scope" title="主线范围" -->
官方主线范围。
<!-- /narracat:prose -->
`

function entry(text: string, baseText: string): ProseOverrideEntry {
  return { text, baseText, baseEngineVersion: '4.0.162', updatedAt: '2026-08-06T10:00:00+08:00' }
}

// AGENT_TEXT 单独存在时的全集：不涉及跨 Agent 场景的用例用它，等价于旧的「blocks-only」判定，
// 保持这些用例的既有断言不变。
const KNOWN_IDS_SELF_ONLY = new Set(currentBlockIds(AGENT_TEXT))

describe('buildProseBlockViews', () => {
  test('无覆盖时全部 clean，userText 为 null，按文件顺序', () => {
    const views = buildProseBlockViews({ agentText: AGENT_TEXT, overrides: {}, knownIdsAcrossAgents: KNOWN_IDS_SELF_ONLY })
    expect(views.map((v) => v.id)).toEqual(['block-one', 'block-two'])
    expect(views[0].officialText).toBe('官方甲。')
    expect(views[0].hint).toBe('提示甲')
    expect(views[0].userText).toBeNull()
    expect(views[0].status).toBe('clean')
  })

  test('baseText 与当前原文一致 → clean 且带用户文本', () => {
    const views = buildProseBlockViews({
      agentText: AGENT_TEXT,
      overrides: { 'block-one': entry('我的甲。', '官方甲。') },
      knownIdsAcrossAgents: KNOWN_IDS_SELF_ONLY,
    })
    expect(views[0].userText).toBe('我的甲。')
    expect(views[0].status).toBe('clean')
  })

  test('官方改过 → official-updated，三份文本都在（供三栏对照）', () => {
    const views = buildProseBlockViews({
      agentText: AGENT_TEXT,
      overrides: { 'block-one': entry('我的甲。', '官方甲的旧版。') },
      knownIdsAcrossAgents: KNOWN_IDS_SELF_ONLY,
    })
    expect(views[0].status).toBe('official-updated')
    expect(views[0].officialText).toBe('官方甲。')
    expect(views[0].baseText).toBe('官方甲的旧版。')
    expect(views[0].userText).toBe('我的甲。')
  })

  test('引擎已删但存量还在，且哪个 Agent 的全集里都没有这个 id → 追加到末尾，status missing，不静默丢弃', () => {
    const views = buildProseBlockViews({
      agentText: AGENT_TEXT,
      overrides: { 'gone-block': entry('我的孤儿。', '早年的官方文案。') },
      knownIdsAcrossAgents: KNOWN_IDS_SELF_ONLY,
    })
    expect(views.map((v) => v.id)).toEqual(['block-one', 'block-two', 'gone-block'])
    const orphan = views[2]
    expect(orphan.status).toBe('missing')
    expect(orphan.officialText).toBe('')
    expect(orphan.userText).toBe('我的孤儿。')
    expect(orphan.title).toBe('gone-block') // 孤儿存量没有引擎标题可用，title 缺省回退为 id
  })
})

describe('buildProseBlockViews × 跨 Agent 孤儿判定（孤儿必须是"哪个 Agent 都不认领"，不是"不在当前 Agent 里"）', () => {
  test('证伪：属于其他 Agent 的覆盖，既不进当前 Agent 的块列表，也不进孤儿列表', () => {
    // knownIdsAcrossAgents 是「全部」Agent 的块 id 全集，不只是当前渲染的这个 Agent 的。
    const knownIdsAcrossAgents = new Set([...currentBlockIds(AGENT_TEXT), ...currentBlockIds(OTHER_AGENT_TEXT)])
    const views = buildProseBlockViews({
      agentText: AGENT_TEXT, // 当前渲染的是这个 Agent（只有 block-one / block-two）
      overrides: {
        'block-one': entry('我的甲。', '官方甲。'),
        // outline-scope 属于另一个 Agent（OTHER_AGENT_TEXT），不属于当前 agentText，
        // 但它在 knownIdsAcrossAgents 全集里 → 不该被当成「哪个 Agent 都不认领」的孤儿。
        'outline-scope': entry('别的 Agent 的调整。', '官方主线范围。'),
      },
      knownIdsAcrossAgents,
    })
    expect(views.map((v) => v.id)).toEqual(['block-one', 'block-two'])
    expect(views.some((v) => v.id === 'outline-scope')).toBe(false)
  })

  test('fail-safe 不能弄丢：真孤儿（在任何 Agent 的全集里都不存在的 id）仍然出现在列表里', () => {
    const knownIdsAcrossAgents = new Set([...currentBlockIds(AGENT_TEXT), ...currentBlockIds(OTHER_AGENT_TEXT)])
    const views = buildProseBlockViews({
      agentText: AGENT_TEXT,
      overrides: { 'gone-block': entry('我的孤儿。', '早年的官方文案。') },
      knownIdsAcrossAgents,
    })
    const orphan = views.find((v) => v.id === 'gone-block')
    expect(orphan).toBeDefined()
    expect(orphan?.status).toBe('missing')
    expect(orphan?.userText).toBe('我的孤儿。')
  })
})

describe('currentBlockIds（供「恢复当前 Agent 默认」定位可清范围，供修复"reset-all 误清其他 Agent"用）', () => {
  test('只返回该 Agent 文件里当前定义的块 id', () => {
    expect(currentBlockIds(AGENT_TEXT)).toEqual(['block-one', 'block-two'])
  })

  test('该 Agent 没有任何块时返回空数组，不会意外把别处 id 当成本 Agent 的', () => {
    expect(currentBlockIds('纯 markdown 正文，没有 narracat:prose 标记。')).toEqual([])
  })
})

describe('isKnownProseAgentId', () => {
  test('引擎内置 agent id 合法', () => {
    expect(isKnownProseAgentId('chapter-writer')).toBe(true)
  })

  test('未知 id 非法', () => {
    expect(isKnownProseAgentId('ghost-writer')).toBe(false)
  })

  test('路径穿越字符串非法（越界读文件的攻击面）', () => {
    expect(isKnownProseAgentId('../../../../etc/passwd')).toBe(false)
    expect(isKnownProseAgentId('../secrets')).toBe(false)
  })
})
