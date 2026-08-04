import { describe, expect, test } from 'bun:test'
import {
  MASTER_OUTLINE_ENGINE_FIELD_LABELS,
  getMasterOutlineEnginePremiseAnchor,
  buildMasterOutlineEngineFieldPrompt,
  buildStakesProgressionEvaluationPrompt,
} from './master-outline-editing'

describe('master-outline 引擎字段 → 立项卡锚点', () => {
  test('四个映射字段各有锚点，stakes_progression 无锚点（PR2 走独立通路）', () => {
    expect(getMasterOutlineEnginePremiseAnchor('central_dramatic_question')).toEqual({
      cardTitle: '中心戏剧问题',
      fieldLabel: '',
    })
    expect(getMasterOutlineEnginePremiseAnchor('protagonist_core_desire')).toEqual({
      cardTitle: '主角欲望与代价',
      fieldLabel: '表层想要',
    })
    expect(getMasterOutlineEnginePremiseAnchor('protagonist_core_lack')).toEqual({
      cardTitle: '主角欲望与代价',
      fieldLabel: '深层需要',
    })
    expect(getMasterOutlineEnginePremiseAnchor('antagonistic_force')).toEqual({
      cardTitle: '对抗力量',
      fieldLabel: '',
    })
    expect(getMasterOutlineEnginePremiseAnchor('stakes_progression')).toBeNull()
    // fail-safe：未知字段无锚点
    expect(getMasterOutlineEnginePremiseAnchor('storylines')).toBeNull()
  })

  test('标签表覆盖五个引擎字段', () => {
    expect(Object.keys(MASTER_OUTLINE_ENGINE_FIELD_LABELS)).toEqual([
      'central_dramatic_question',
      'protagonist_core_desire',
      'protagonist_core_lack',
      'antagonistic_force',
      'stakes_progression',
    ])
  })

  test('prompt 走 revise-premise 语义：声明新值已定、评估级联、二次确认', () => {
    const prompt = buildMasterOutlineEngineFieldPrompt({
      fieldKey: 'protagonist_core_lack',
      oldValue: '旧的缺失',
      newValue: '新的缺失',
    })
    expect(prompt).toContain('主角欲望与代价·深层需要')
    expect(prompt).toContain('当前内容：旧的缺失')
    expect(prompt).toContain('改为：新的缺失')
    expect(prompt).toContain('新值我已确定')
    // 无锚点字段构造抛错（防调用侧误用）
    expect(() =>
      buildMasterOutlineEngineFieldPrompt({ fieldKey: 'stakes_progression', oldValue: 'a', newValue: 'b' }),
    ).toThrow()
  })
})

describe('buildStakesProgressionEvaluationPrompt', () => {
  test('prompt 含引擎口径字段名、当前内容、改为、二次确认与落盘工具指令', () => {
    const prompt = buildStakesProgressionEvaluationPrompt({
      oldValue: '卷一失自由，卷二失信任',
      newValue: '卷一失自由，卷二失信任，卷三失自我',
    })
    expect(prompt).toContain('赌注递增曲线')
    expect(prompt).toContain('当前内容：卷一失自由，卷二失信任')
    expect(prompt).toContain('改为：卷一失自由，卷二失信任，卷三失自我')
    expect(prompt).toContain('二次确认')
    expect(prompt).toContain('novel_update_outline_book_field')
    expect(prompt).toContain('stakes_progression')
  })
})
