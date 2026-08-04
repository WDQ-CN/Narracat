// electron/main/novel/planned-state-edit.test.ts
import { describe, expect, test } from 'bun:test'

import { parseResolvePlannedStateInput, parseUpdateChapterStateChangesInput } from './planned-state-edit'

describe('parseResolvePlannedStateInput', () => {
  test('合法入参原样透传（cancel，无 to_chapter）', () => {
    const request = parseResolvePlannedStateInput({
      projectPath: '/p',
      payload: { id: 'row-1', action: 'cancel' },
    })
    expect(request).toEqual({ projectPath: '/p', payload: { id: 'row-1', action: 'cancel' } })
  })

  test('defer 合法入参：携带 to_chapter', () => {
    const request = parseResolvePlannedStateInput({
      projectPath: '/p',
      payload: { id: 'row-1', action: 'defer', to_chapter: 12 },
    })
    expect(request.payload).toEqual({ id: 'row-1', action: 'defer', to_chapter: 12 })
  })

  test('缺少项目路径报错', () => {
    expect(() => parseResolvePlannedStateInput({ payload: { id: 'row-1', action: 'cancel' } })).toThrow('缺少项目路径')
  })

  test('缺少计划行 id 报错', () => {
    expect(() => parseResolvePlannedStateInput({ projectPath: '/p', payload: { action: 'cancel' } })).toThrow('缺少计划行标识')
  })

  test('非法 action 报错', () => {
    expect(() =>
      parseResolvePlannedStateInput({ projectPath: '/p', payload: { id: 'row-1', action: 'destroy' } }),
    ).toThrow('不支持的处置动作')
  })

  test('defer 缺 to_chapter 报错', () => {
    expect(() =>
      parseResolvePlannedStateInput({ projectPath: '/p', payload: { id: 'row-1', action: 'defer' } }),
    ).toThrow('目标章须为不小于 1 的整数')
  })

  test('defer 的 to_chapter 非整数报错', () => {
    expect(() =>
      parseResolvePlannedStateInput({
        projectPath: '/p',
        payload: { id: 'row-1', action: 'defer', to_chapter: 1.5 },
      }),
    ).toThrow('目标章须为不小于 1 的整数')
    expect(() =>
      parseResolvePlannedStateInput({
        projectPath: '/p',
        payload: { id: 'row-1', action: 'defer', to_chapter: '12' },
      }),
    ).toThrow('目标章须为不小于 1 的整数')
  })
})

describe('parseUpdateChapterStateChangesInput', () => {
  const entry = { character: { character_uid: 'u1', name: '苏明' }, dimension: 'cultivation_level', value: '金丹' }

  test('合法入参原样透传', () => {
    const request = parseUpdateChapterStateChangesInput({
      projectPath: '/p',
      payload: { chapter: 5, state_changes: [entry], expected_state_changes: [] },
    })
    expect(request).toEqual({
      projectPath: '/p',
      payload: { chapter: 5, state_changes: [entry], expected_state_changes: [] },
    })
  })

  test('缺少项目路径报错', () => {
    expect(() =>
      parseUpdateChapterStateChangesInput({ payload: { chapter: 5, state_changes: [], expected_state_changes: [] } }),
    ).toThrow('缺少项目路径')
  })

  test('章号非法报错（非整数/小于 1）', () => {
    expect(() =>
      parseUpdateChapterStateChangesInput({
        projectPath: '/p',
        payload: { chapter: 0, state_changes: [], expected_state_changes: [] },
      }),
    ).toThrow('章号须为不小于 1 的整数')
    expect(() =>
      parseUpdateChapterStateChangesInput({
        projectPath: '/p',
        payload: { chapter: '5', state_changes: [], expected_state_changes: [] },
      }),
    ).toThrow('章号须为不小于 1 的整数')
  })

  test('state_changes 非数组报错', () => {
    expect(() =>
      parseUpdateChapterStateChangesInput({
        projectPath: '/p',
        payload: { chapter: 5, state_changes: 'nope', expected_state_changes: [] },
      }),
    ).toThrow('计划状态变更须为数组')
  })

  test('state_changes 超 8 条报错', () => {
    const list = Array.from({ length: 9 }, () => entry)
    expect(() =>
      parseUpdateChapterStateChangesInput({
        projectPath: '/p',
        payload: { chapter: 5, state_changes: list, expected_state_changes: [] },
      }),
    ).toThrow('计划状态变更最多 8 条')
  })

  test('expected_state_changes 非数组报错', () => {
    expect(() =>
      parseUpdateChapterStateChangesInput({
        projectPath: '/p',
        payload: { chapter: 5, state_changes: [], expected_state_changes: 'nope' },
      }),
    ).toThrow('缺少读取时快照（CAS 基线）')
  })
})
