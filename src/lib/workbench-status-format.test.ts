import { describe, expect, test } from 'bun:test'
import {
  formatWordCount,
  resolveForeshadowingStateLabel,
  resolveForeshadowingTypeLabel,
  resolveNextActionLabel,
} from './workbench-status-format'

describe('workbench status formatting', () => {
  test('formats word counts in 字 / 万字', () => {
    expect(formatWordCount(0)).toBe('0 字')
    expect(formatWordCount(-5)).toBe('0 字')
    expect(formatWordCount(2100)).toBe('2100 字')
    expect(formatWordCount(12000)).toBe('1.2 万字')
  })

  test('resolves next action chapter label and the completed fallback', () => {
    expect(resolveNextActionLabel(2)).toBe('第 2 章')
    expect(resolveNextActionLabel(null)).toBe('已规划完成')
  })

  test('maps foreshadowing machine fields to human labels', () => {
    expect(resolveForeshadowingStateLabel('registered')).toBe('已登记')
    expect(resolveForeshadowingStateLabel('revealed')).toBe('已揭示')
    expect(resolveForeshadowingTypeLabel('major')).toBe('大')
    expect(resolveForeshadowingTypeLabel('small')).toBe('小')
  })
})
