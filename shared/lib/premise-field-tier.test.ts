import { describe, expect, test } from 'bun:test'
import { isFirstTierField, isSecondTierEvaluableField } from './premise-field-tier'

describe('isFirstTierField · ADR-0029 第一档白名单', () => {
  test('11 个纯描述字段判为第一档', () => {
    const firstTier: Array<[string, string]> = [
      ['genre_contract', 'subgenre'],
      ['genre_contract', 'reader_expectation'],
      ['genre_contract', 'surprise_point'],
      ['genre_contract', 'emotional_tone'],
      ['core_hook', ''], // prose 卡，field.key 为空，按卡判第一档
      ['golden_finger', 'ability'],
      ['golden_finger', 'limit'],
      ['golden_finger', 'growth'],
      ['golden_finger', 'sustains_conflict'],
      ['protagonist_desire', 'cost'],
      ['protagonist_desire', 'bottom_line'],
    ]
    for (const [card, field] of firstTier) {
      expect(isFirstTierField(card, field)).toBe(true)
    }
  })

  test('有下游依赖字段判为第二档（fail-safe 默认）', () => {
    const secondTier: Array<[string, string]> = [
      ['central_dramatic_question', ''],
      ['antagonistic_force', ''],
      ['protagonist_desire', 'surface_want'],
      ['protagonist_desire', 'deep_need'],
      ['golden_finger', 'feedback_loop'],
      ['world_rules', 'rule'],
      ['narrator_voice', 'tone'],
      ['narrator_voice', 'address'],
      ['unknown_card', 'whatever'],
    ]
    for (const [card, field] of secondTier) {
      expect(isFirstTierField(card, field)).toBe(false)
    }
  })
})

describe('isSecondTierEvaluableField · ADR-0029 第二档评估流', () => {
  test('有下游依赖字段判为第二档可评估', () => {
    const secondTier: Array<[string, string]> = [
      ['central_dramatic_question', ''],
      ['antagonistic_force', 'force'],
      ['protagonist_desire', 'surface_want'],
      ['protagonist_desire', 'deep_need'],
      ['golden_finger', 'feedback_loop'],
      ['narrator_voice', 'tone'],
      ['narrator_voice', 'address'],
    ]
    for (const [card, field] of secondTier) {
      expect(isSecondTierEvaluableField(card, field)).toBe(true)
    }
  })

  test('第一档纯描述字段不进评估流', () => {
    expect(isSecondTierEvaluableField('genre_contract', 'subgenre')).toBe(false)
    expect(isSecondTierEvaluableField('core_hook', '')).toBe(false)
    expect(isSecondTierEvaluableField('golden_finger', 'growth')).toBe(false)
  })

  test('world_rules 整卡排除（value/note 同行、本期后置）', () => {
    expect(isSecondTierEvaluableField('world_rules', 'rule')).toBe(false)
  })
})
