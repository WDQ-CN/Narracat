// electron/main/novel/master-outline-edit.test.ts
import { describe, expect, test } from 'bun:test'
import { parseMasterOutlineFieldEditInput } from './master-outline-edit.ts'

function base(overrides: Record<string, unknown> = {}) {
  return {
    projectPath: '/p',
    target: 'stakes_progression',
    newValue: '风险从个人恩怨升级为门派存亡',
    expectedOldValue: '风险仅限个人恩怨',
    ...overrides,
  }
}

describe('parseMasterOutlineFieldEditInput · 校验矩阵', () => {
  test('缺 projectPath 拒绝', () => {
    expect(() => parseMasterOutlineFieldEditInput(base({ projectPath: '' }))).toThrow()
    expect(() => parseMasterOutlineFieldEditInput(base({ projectPath: '   ' }))).toThrow()
  })

  test('非法 target 拒绝', () => {
    expect(() => parseMasterOutlineFieldEditInput(base({ target: 'payoff_beat' }))).toThrow()
    expect(() => parseMasterOutlineFieldEditInput(base({ target: '' }))).toThrow()
  })

  test('空 newValue 拒绝', () => {
    expect(() => parseMasterOutlineFieldEditInput(base({ newValue: '  ' }))).toThrow()
  })

  test('storyline_name 缺 id 拒绝', () => {
    expect(() =>
      parseMasterOutlineFieldEditInput(base({ target: 'storyline_name', newValue: '新主线名', id: undefined })),
    ).toThrow()
  })

  test('foreshadowing_description 缺 id 拒绝', () => {
    expect(() =>
      parseMasterOutlineFieldEditInput(
        base({ target: 'foreshadowing_description', newValue: '新伏笔描述', id: '  ' }),
      ),
    ).toThrow()
  })

  test('stakes_progression 无需 id，合法输入原样返回', () => {
    const out = parseMasterOutlineFieldEditInput(base())
    expect(out).toEqual({
      projectPath: '/p',
      target: 'stakes_progression',
      id: undefined,
      newValue: '风险从个人恩怨升级为门派存亡',
      expectedOldValue: '风险仅限个人恩怨',
    })
  })

  test('storyline_name 带 id，合法输入原样返回（含 id trim）', () => {
    const out = parseMasterOutlineFieldEditInput(
      base({ target: 'storyline_name', id: '  SL-main  ', newValue: '主线新名', expectedOldValue: '主线旧名' }),
    )
    expect(out).toEqual({
      projectPath: '/p',
      target: 'storyline_name',
      id: 'SL-main',
      newValue: '主线新名',
      expectedOldValue: '主线旧名',
    })
  })

  test('newValue 前后空白被 trim', () => {
    const out = parseMasterOutlineFieldEditInput(base({ newValue: '  新值  ' }))
    expect(out.newValue).toBe('新值')
  })
})
