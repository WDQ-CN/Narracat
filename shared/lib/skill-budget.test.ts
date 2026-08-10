import { describe, expect, test } from 'bun:test'
import { computeAgentInstructionBudget, estimateSkillTokens } from './skill-budget'

describe('estimateSkillTokens', () => {
  test('counts CJK as 1 and ASCII as 0.3, rounding up (WCP-aligned)', () => {
    // 2 CJK = 2 ; "abcd" = 4 * 0.3 = 1.2 → ceil(3.2) = 4
    expect(estimateSkillTokens('中文abcd')).toBe(4)
  })

  test('empty string is 0', () => {
    expect(estimateSkillTokens('')).toBe(0)
  })
})

describe('computeAgentInstructionBudget（persona + 作者要求合计）', () => {
  test('空输入 → 0 token、不超限', () => {
    expect(computeAgentInstructionBudget({ texts: [] })).toEqual({
      totalTokens: 0,
      limit: 8000,
      overLimit: false,
    })
  })

  test('多段文本累加', () => {
    const result = computeAgentInstructionBudget({ texts: ['你好', '世界'] })
    expect(result.totalTokens).toBe(4)
    expect(result.overLimit).toBe(false)
  })

  test('超过上限时 overLimit 为 true，但 totalTokens 照实报（不截断、不阻断）', () => {
    const result = computeAgentInstructionBudget({ texts: ['很'.repeat(9000)] })
    expect(result.totalTokens).toBe(9000)
    expect(result.overLimit).toBe(true)
  })

  test('limit 可注入，便于按模型调参', () => {
    expect(computeAgentInstructionBudget({ texts: ['很'.repeat(10)], limit: 5 }).overLimit).toBe(true)
  })

  test('空串与空白段落不贡献 token', () => {
    expect(computeAgentInstructionBudget({ texts: ['', '   '] }).totalTokens).toBe(0)
  })
})
