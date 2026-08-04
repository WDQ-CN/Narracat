import { describe, expect, test } from 'bun:test'
import {
  computePreloadBudget,
  estimateSkillTokens,
  PRELOAD_BUDGET_LIMIT,
  UNKNOWN_SKILL_TOKEN_ESTIMATE,
} from './skill-budget'

describe('computePreloadBudget', () => {
  test('empty preload set is 0 tokens and not over limit', () => {
    const result = computePreloadBudget({ preloadSkills: [], skillTokenEstimates: {} })
    expect(result.totalTokens).toBe(0)
    expect(result.overLimit).toBe(false)
    expect(result.unknownSkills).toEqual([])
  })

  test('accumulates multiple skill estimates', () => {
    const result = computePreloadBudget({
      preloadSkills: ['a', 'b', 'c'],
      skillTokenEstimates: { a: 1000, b: 2000, c: 500 },
    })
    expect(result.totalTokens).toBe(3500)
    expect(result.overLimit).toBe(false)
  })

  test('exactly at the limit is not over limit', () => {
    const result = computePreloadBudget({
      preloadSkills: ['a'],
      skillTokenEstimates: { a: PRELOAD_BUDGET_LIMIT },
    })
    expect(result.totalTokens).toBe(PRELOAD_BUDGET_LIMIT)
    expect(result.overLimit).toBe(false)
  })

  test('one over the limit is flagged over limit', () => {
    const result = computePreloadBudget({
      preloadSkills: ['a'],
      skillTokenEstimates: { a: PRELOAD_BUDGET_LIMIT + 1 },
    })
    expect(result.overLimit).toBe(true)
  })

  test('unknown skill size degrades to a conservative placeholder, not 0', () => {
    const result = computePreloadBudget({
      preloadSkills: ['known', 'mystery'],
      skillTokenEstimates: { known: 100 },
    })
    expect(result.totalTokens).toBe(100 + UNKNOWN_SKILL_TOKEN_ESTIMATE)
    expect(result.unknownSkills).toEqual(['mystery'])
  })

  test('negative / NaN estimates are treated as unknown', () => {
    const result = computePreloadBudget({
      preloadSkills: ['neg', 'nan'],
      skillTokenEstimates: { neg: -5, nan: Number.NaN },
    })
    expect(result.totalTokens).toBe(UNKNOWN_SKILL_TOKEN_ESTIMATE * 2)
    expect(result.unknownSkills).toEqual(['neg', 'nan'])
  })

  test('honours a custom limit', () => {
    const result = computePreloadBudget({
      preloadSkills: ['a'],
      skillTokenEstimates: { a: 600 },
      limit: 500,
    })
    expect(result.overLimit).toBe(true)
    expect(result.limit).toBe(500)
  })
})

describe('estimateSkillTokens', () => {
  test('counts CJK as 1 and ASCII as 0.3, rounding up (WCP-aligned)', () => {
    // 2 CJK = 2 ; "abcd" = 4 * 0.3 = 1.2 → ceil(3.2) = 4
    expect(estimateSkillTokens('中文abcd')).toBe(4)
  })

  test('empty string is 0', () => {
    expect(estimateSkillTokens('')).toBe(0)
  })
})
