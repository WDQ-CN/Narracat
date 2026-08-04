// electron/main/novel/character-state-edit.test.ts
import { describe, expect, test } from 'bun:test'

import {
  mergeCharacterIdentityPayload,
  parseAuthoredStateEditInput,
  parseCharacterIdentityEditInput,
} from './character-state-edit'

const UID = '11111111-1111-4111-8111-111111111111'

describe('parseAuthoredStateEditInput', () => {
  test('set_current 全参数：只装引擎认得的键，未知字段不透传', () => {
    const request = parseAuthoredStateEditInput({
      projectPath: '/p',
      payload: {
        character_uid: UID,
        action: 'set_current',
        dimension: 'cultivation_level',
        value: ' 金丹 ',
        effective_chapter: 13,
        expected_current_value: '筑基',
        evil_extra: 'x',
      },
    })
    expect(request.projectPath).toBe('/p')
    expect(request.payload).toEqual({
      character_uid: UID,
      action: 'set_current',
      dimension: 'cultivation_level',
      value: '金丹',
      effective_chapter: 13,
      expected_current_value: '筑基',
    })
  })

  test('many 维度增删：operation 白名单，非法值拒绝', () => {
    const request = parseAuthoredStateEditInput({
      projectPath: '/p',
      payload: { character_uid: UID, action: 'set_current', dimension: 'inventory', operation: 'remove', value: '短刀', effective_chapter: 9 },
    })
    expect(request.payload.operation).toBe('remove')
    expect(() =>
      parseAuthoredStateEditInput({
        projectPath: '/p',
        payload: { character_uid: UID, action: 'set_current', dimension: 'inventory', operation: 'destroy', value: '短刀', effective_chapter: 9 },
      }),
    ).toThrow('不支持的维度操作')
  })

  test('set_current/backfill 缺维度、缺值、缺生效章分别报错；生效章须为不小于 0 的整数', () => {
    const base = { character_uid: UID, action: 'backfill', dimension: 'inventory', value: '短刀', effective_chapter: 5 }
    expect(() => parseAuthoredStateEditInput({ projectPath: '/p', payload: { ...base, dimension: '' } })).toThrow('缺少状态维度')
    expect(() => parseAuthoredStateEditInput({ projectPath: '/p', payload: { ...base, value: '  ' } })).toThrow('状态值不能为空')
    expect(() => parseAuthoredStateEditInput({ projectPath: '/p', payload: { ...base, effective_chapter: undefined } })).toThrow('缺少生效章')
    expect(() => parseAuthoredStateEditInput({ projectPath: '/p', payload: { ...base, effective_chapter: -1 } })).toThrow('不小于 0 的整数')
    expect(() => parseAuthoredStateEditInput({ projectPath: '/p', payload: { ...base, effective_chapter: 1.5 } })).toThrow('不小于 0 的整数')
  })

  test('expected_current_value 只在 set_current 生效，backfill 不透传', () => {
    const request = parseAuthoredStateEditInput({
      projectPath: '/p',
      payload: { character_uid: UID, action: 'backfill', dimension: 'inventory', value: '短刀', effective_chapter: 5, expected_current_value: 'x' },
    })
    expect(request.payload.expected_current_value).toBeUndefined()
  })

  test('set_current 带 secret_known：boolean 值透传；非 boolean 不透传', () => {
    const withKnown = parseAuthoredStateEditInput({
      projectPath: '/p',
      payload: {
        character_uid: UID,
        action: 'set_current',
        dimension: 'secret_identity',
        value: '隐藏身份',
        effective_chapter: 3,
        secret_known: true,
      },
    })
    expect(withKnown.payload.secret_known).toBe(true)

    const withNonBoolean = parseAuthoredStateEditInput({
      projectPath: '/p',
      payload: {
        character_uid: UID,
        action: 'backfill',
        dimension: 'secret_identity',
        value: '隐藏身份',
        effective_chapter: 3,
        secret_known: 'true',
      },
    })
    expect(withNonBoolean.payload.secret_known).toBeUndefined()
  })

  test('correct：需 target_fact_id 且新值/新发生章至少一项', () => {
    const request = parseAuthoredStateEditInput({
      projectPath: '/p',
      payload: { character_uid: UID, action: 'correct', target_fact_id: 'fact-123456', new_event_chapter: 8 },
    })
    expect(request.payload).toEqual({ character_uid: UID, action: 'correct', target_fact_id: 'fact-123456', new_event_chapter: 8 })
    expect(() =>
      parseAuthoredStateEditInput({ projectPath: '/p', payload: { character_uid: UID, action: 'correct', target_fact_id: 'fact-123456' } }),
    ).toThrow('新值或新发生章至少一项')
  })

  test('retract/endorse：缺 target_fact_id 报错', () => {
    for (const action of ['retract', 'endorse']) {
      const request = parseAuthoredStateEditInput({
        projectPath: '/p',
        payload: { character_uid: UID, action, target_fact_id: 'fact-123456' },
      })
      expect(request.payload).toEqual({ character_uid: UID, action: action as never, target_fact_id: 'fact-123456' })
      expect(() => parseAuthoredStateEditInput({ projectPath: '/p', payload: { character_uid: UID, action } })).toThrow('缺少目标记录定位')
    }
  })

  test('mark_secret_known：解析合法输入；缺 known/缺 target_fact_id 拒', () => {
    const parsed = parseAuthoredStateEditInput({
      projectPath: '/p',
      payload: { character_uid: 'u1', action: 'mark_secret_known', target_fact_id: 'f1', known: true },
    })
    expect(parsed.payload).toEqual({ character_uid: 'u1', action: 'mark_secret_known', target_fact_id: 'f1', known: true })

    expect(() =>
      parseAuthoredStateEditInput({ projectPath: '/p', payload: { character_uid: 'u1', action: 'mark_secret_known', target_fact_id: 'f1' } }),
    ).toThrow()
    expect(() =>
      parseAuthoredStateEditInput({ projectPath: '/p', payload: { character_uid: 'u1', action: 'mark_secret_known', known: true } }),
    ).toThrow()
  })

  test('缺项目路径 / 缺角色标识 / 非法 action 报错', () => {
    expect(() => parseAuthoredStateEditInput({ payload: { character_uid: UID, action: 'endorse', target_fact_id: 'fact-123456' } })).toThrow('缺少项目路径')
    expect(() => parseAuthoredStateEditInput({ projectPath: '/p', payload: { action: 'endorse', target_fact_id: 'fact-123456' } })).toThrow('缺少角色标识')
    expect(() => parseAuthoredStateEditInput({ projectPath: '/p', payload: { character_uid: UID, action: 'delete_all' } })).toThrow('不支持的编辑动作')
  })
})

describe('parseCharacterIdentityEditInput', () => {
  const BASE = { projectPath: '/p', characterUid: UID, characterName: '张三', gender: '女', age: '十六', aliases: ['三郎'] }

  test('正常入参：trim + 空别名过滤', () => {
    const request = parseCharacterIdentityEditInput({ ...BASE, gender: ' 女 ', aliases: [' 三郎 ', '', '  '] })
    expect(request.gender).toBe('女')
    expect(request.aliases).toEqual(['三郎'])
  })

  test('角色名路径逃逸拒绝（../ 或以 . 开头）', () => {
    expect(() => parseCharacterIdentityEditInput({ ...BASE, characterName: '../../evil' })).toThrow('角色名不合法')
    expect(() => parseCharacterIdentityEditInput({ ...BASE, characterName: '.hidden' })).toThrow('角色名不合法')
  })

  test('长度上限镜像引擎 schema：性别 8 / 年龄 20 / 别名 12 个每个 20 字', () => {
    expect(() => parseCharacterIdentityEditInput({ ...BASE, gender: '一二三四五六七八九' })).toThrow('性别最长 8 字')
    expect(() => parseCharacterIdentityEditInput({ ...BASE, age: 'x'.repeat(21) })).toThrow('年龄描述最长 20 字')
    expect(() => parseCharacterIdentityEditInput({ ...BASE, aliases: Array.from({ length: 13 }, (_, i) => `别名${i}`) })).toThrow('别名最多 12 个')
    expect(() => parseCharacterIdentityEditInput({ ...BASE, aliases: ['x'.repeat(21)] })).toThrow('单个别名最长 20 字')
  })
})

describe('mergeCharacterIdentityPayload', () => {
  const REQUEST = { projectPath: '/p', characterUid: UID, characterName: '张三', gender: '女', age: '十六', aliases: ['三郎'] }

  test('身份三字段替换，initial_states/effective_chapter 原样透传（防止全量覆盖抹掉未提字段）', () => {
    const merged = mergeCharacterIdentityPayload(
      {
        character_uid: UID,
        name: '张三',
        gender: '男',
        effective_chapter: 3,
        initial_states: [{ dimension: 'inventory', value: '短刀' }],
      },
      REQUEST,
    )
    expect(merged).toEqual({
      ok: true,
      payload: {
        character_uid: UID,
        name: '张三',
        effective_chapter: 3,
        initial_states: [{ dimension: 'inventory', value: '短刀' }],
        gender: '女',
        age: '十六',
        aliases: ['三郎'],
      },
    })
  })

  test('清空字段（空串/空数组）= 省略键，引擎覆盖式写入即移除', () => {
    const merged = mergeCharacterIdentityPayload(
      { character_uid: UID, name: '张三', gender: '男', aliases: ['旧称号'] },
      { ...REQUEST, gender: '', age: '', aliases: [] },
    )
    expect(merged.ok).toBe(true)
    if (merged.ok) {
      expect(merged.payload).toEqual({ character_uid: UID, name: '张三' })
    }
  })

  test('uid 不匹配 / 档案不成形拒绝（出生证编辑不建档）', () => {
    expect(mergeCharacterIdentityPayload({ character_uid: 'other', name: '张三' }, REQUEST).ok).toBe(false)
    expect(mergeCharacterIdentityPayload(null, REQUEST).ok).toBe(false)
    expect(mergeCharacterIdentityPayload([], REQUEST).ok).toBe(false)
  })
})
