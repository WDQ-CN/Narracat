// computePreloadBudget：预加载挂载的 token 预算护栏（PRD #258 护栏 2）。
//
// 每个预加载型 Skill = 一份 SKILL.md 全文常驻 subagent 上下文（eager 注入）。挂多了会撑爆
// 弱模型 context（4.0 撤大体量通用 craft Skill 注入的教训）。本纯函数算预加载集的 token 总量与超限判定，
// 供 Agent 档案显示「预加载已占 ~X token」+ 上限警告。
//
// token 估算对齐 WCP（mcp-server BLOCK_BUDGETS 同款规则）：CJK 字符按 1，其余按 0.3。
// 体量度量由上游（diagnostics）从 SKILL.md 字符数预估并传入；未知体量按保守占位降级，不漏算。

/** 预加载安全上限（token）。弱模型 context 下单 Agent 预加载常驻的安全水位。 */
export const PRELOAD_BUDGET_LIMIT = 8000

/** 未知体量 Skill 的保守占位估算（token）。避免缺数据时把超限误判为安全。 */
export const UNKNOWN_SKILL_TOKEN_ESTIMATE = 2000

export interface PreloadBudgetResult {
  /** 预加载集 token 总量估算 */
  totalTokens: number
  /** 安全上限 */
  limit: number
  /** 是否超过安全上限 */
  overLimit: boolean
  /** 体量未知、按占位估算的 skill（提示数据缺口） */
  unknownSkills: string[]
}

export interface ComputePreloadBudgetArgs {
  /** 有效预加载 skill 集 */
  preloadSkills: string[]
  /** 各 SKILL.md 的 token 体量估算（skillId → token），缺项按未知占位降级 */
  skillTokenEstimates: Record<string, number>
  /** 安全上限（默认 PRELOAD_BUDGET_LIMIT），便于测试与未来按模型调参 */
  limit?: number
}

export function computePreloadBudget({
  preloadSkills,
  skillTokenEstimates,
  limit = PRELOAD_BUDGET_LIMIT,
}: ComputePreloadBudgetArgs): PreloadBudgetResult {
  let totalTokens = 0
  const unknownSkills: string[] = []

  for (const skillId of preloadSkills) {
    const estimate = skillTokenEstimates[skillId]
    if (typeof estimate === 'number' && Number.isFinite(estimate) && estimate >= 0) {
      totalTokens += Math.ceil(estimate)
    } else {
      totalTokens += UNKNOWN_SKILL_TOKEN_ESTIMATE
      unknownSkills.push(skillId)
    }
  }

  return {
    totalTokens,
    limit,
    overLimit: totalTokens > limit,
    unknownSkills,
  }
}

/** token 估算：CJK 字符按 1、其余按 0.3（与 WCP / mcp-server estimateTokens 一致） */
export function estimateSkillTokens(text: string): number {
  let total = 0
  for (const ch of text) {
    total += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.3
  }
  return Math.ceil(total)
}
