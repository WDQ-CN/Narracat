// Agent 侧指令的 token 体量估算与预算护栏。
//
// 作者能往一个 Agent 上堆的东西有两处：persona 覆盖正文、以及若干条「我对它的要求」。
// 它们全部常驻该 Agent 的 prompt，堆太多会挤占弱模型 context（4.0 撤大体量通用 craft 注入的教训）。
// 本文件提供纯函数估算与超限判定——**只度量不阻断**（ADR-0030），超限时由 UI 出一句提示。
//
// token 估算对齐 WCP（mcp-server BLOCK_BUDGETS 同款规则）：CJK 字符按 1，其余按 0.3。

/** 预加载安全上限（token）。弱模型 context 下单 Agent 预加载常驻的安全水位。 */
export const PRELOAD_BUDGET_LIMIT = 8000

/** token 估算：CJK 字符按 1、其余按 0.3（与 WCP / mcp-server estimateTokens 一致） */
export function estimateSkillTokens(text: string): number {
  let total = 0
  for (const ch of text) {
    total += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.3
  }
  return Math.ceil(total)
}

export interface AgentInstructionBudget {
  /** 合计 token 估算 */
  totalTokens: number
  /** 安全上限 */
  limit: number
  /** 是否超过安全上限。**超限只警告不阻断**（ADR-0030：账房层守纪律，评价层只度量不阻断）——
   * 内容照常注入，UI 出一句提示由作者自行取舍。绝不静默截断或丢弃。 */
  overLimit: boolean
}

/**
 * 某个 Agent 的作者侧指令预算：persona 覆盖正文 + 该 Agent 的全部作者要求，合计估算 token。
 * 这些文本全部常驻该 Agent 的 prompt，堆太多会挤占弱模型 context（4.0 撤大体量注入的教训）。
 */
export function computeAgentInstructionBudget({
  texts,
  limit = PRELOAD_BUDGET_LIMIT,
}: {
  texts: string[]
  limit?: number
}): AgentInstructionBudget {
  const totalTokens = texts.reduce((sum, text) => sum + estimateSkillTokens(text.trim()), 0)
  return { totalTokens, limit, overLimit: totalTokens > limit }
}
