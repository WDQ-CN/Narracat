import { describe, expect, test } from 'bun:test'
import { characterPredicateLabel } from './character-predicate-labels.ts'

describe('characterPredicateLabel', () => {
  test('受控词表 12 谓词全部映射为中文', () => {
    expect(characterPredicateLabel('identity')).toBe('身份')
    expect(characterPredicateLabel('location')).toBe('所在地')
    expect(characterPredicateLabel('possession')).toBe('持有物')
    expect(characterPredicateLabel('goal')).toBe('目标')
    expect(characterPredicateLabel('injury')).toBe('伤势')
    expect(characterPredicateLabel('ability')).toBe('能力')
    expect(characterPredicateLabel('status')).toBe('状态')
    expect(characterPredicateLabel('secret')).toBe('秘密')
    expect(characterPredicateLabel('reputation')).toBe('名声')
    expect(characterPredicateLabel('oath')).toBe('誓约')
    expect(characterPredicateLabel('debt')).toBe('恩怨债')
    expect(characterPredicateLabel('relationship')).toBe('关系')
  })

  test('x- 前缀自拟谓词剥前缀展示；纯 "x-" 原样返回', () => {
    expect(characterPredicateLabel('x-剑意感悟')).toBe('剑意感悟')
    expect(characterPredicateLabel('x-')).toBe('x-')
  })

  test('词表外未知谓词原样返回（词表维度 key 不受影响）', () => {
    expect(characterPredicateLabel('cultivation_level')).toBe('cultivation_level')
    expect(characterPredicateLabel('境界')).toBe('境界')
  })
})
