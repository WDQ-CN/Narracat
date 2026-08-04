import { describe, expect, test } from 'bun:test'
import { buildRevisePremiseEvaluationPrompt } from './premise-impact-evaluation'

describe('buildRevisePremiseEvaluationPrompt', () => {
  const prompt = buildRevisePremiseEvaluationPrompt({
    cardTitle: '叙述声音',
    fieldLabel: '基调',
    oldValue: '冷峻克制',
    newValue: '热血昂扬',
  })

  test('含卡·字段定位、旧值、新值', () => {
    expect(prompt).toContain('叙述声音')
    expect(prompt).toContain('基调')
    expect(prompt).toContain('冷峻克制')
    expect(prompt).toContain('热血昂扬')
  })

  test('显式引导跳过讨论、直接评估级联影响、确认后同步', () => {
    expect(prompt).toContain('已确定')
    expect(prompt).toContain('评估')
    expect(prompt).toMatch(/影响/)
  })

  test('label 与卡名相同（prose 卡）时不重复堆叠', () => {
    const prose = buildRevisePremiseEvaluationPrompt({
      cardTitle: '对抗力量',
      fieldLabel: '对抗力量',
      oldValue: '宿命天敌',
      newValue: '体制围猎',
    })
    expect(prose).not.toContain('对抗力量·对抗力量')
  })
})
