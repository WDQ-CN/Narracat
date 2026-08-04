import { describe, expect, test } from 'bun:test'
import { feederDraftNavigation, packsSubTitle, parsePacksSubParam } from './CapabilityPackLibraryPanel'

describe('parsePacksSubParam · creations/draft (Task 11)', () => {
  test('parses "creations" into the creations view', () => {
    expect(parsePacksSubParam('creations')).toEqual({ kind: 'creations' })
  })

  test('parses "draft:<id>" into the draft view, carrying the draft id', () => {
    expect(parsePacksSubParam('draft:abc')).toEqual({ kind: 'draft', draftId: 'abc' })
  })

  test('rejects "draft:" with an empty id', () => {
    expect(parsePacksSubParam('draft:')).toBeNull()
  })

  test('still parses existing guide/detail views (no regression)', () => {
    expect(parsePacksSubParam('guide')).toEqual({ kind: 'guide' })
    expect(parsePacksSubParam('pack:foo@1.0.0')).toEqual({ kind: 'detail', id: 'foo', version: '1.0.0' })
  })
})

describe('parsePacksSubParam · learn (Task 12)', () => {
  test('parses "learn" into the learn-from-book view', () => {
    expect(parsePacksSubParam('learn')).toEqual({ kind: 'learn' })
  })
})

describe('packsSubTitle · creations/draft (Task 11)', () => {
  test('titles the creations view "我的创作"', () => {
    expect(packsSubTitle({ kind: 'creations' })).toBe('我的创作')
  })

  test('titles the draft view "编辑能力包"', () => {
    expect(packsSubTitle({ kind: 'draft', draftId: 'abc' })).toBe('编辑能力包')
  })
})

describe('packsSubTitle · learn (Task 12)', () => {
  test('titles the learn-from-book view "从书学写法"', () => {
    expect(packsSubTitle({ kind: 'learn' })).toBe('从书学写法')
  })
})

describe('parsePacksSubParam · wizard (刀5 Task 6)', () => {
  test('parses "wizard" into the writer-wizard view', () => {
    expect(parsePacksSubParam('wizard')).toEqual({ kind: 'wizard' })
  })

  test('rejects unknown wizard-like params (no prefix routes)', () => {
    expect(parsePacksSubParam('wizard:abc')).toBeNull()
    expect(parsePacksSubParam('wizards')).toBeNull()
  })

  test('clearing the param still parses to null (leaving the wizard view)', () => {
    expect(parsePacksSubParam(null)).toBeNull()
    expect(parsePacksSubParam('')).toBeNull()
  })
})

describe('packsSubTitle · wizard (刀5 Task 6)', () => {
  test('titles the writer-wizard view "作家向导"', () => {
    expect(packsSubTitle({ kind: 'wizard' })).toBe('作家向导')
  })
})

describe('feederDraftNavigation · 进料器→草稿 replace（T6 评审 Minor-2）', () => {
  test('learn/wizard 完成进草稿必须 replace 而非 push：返回键不落回已清空的进料器幽灵页', () => {
    expect(feederDraftNavigation('abc')).toEqual(['draft:abc', { replace: true }])
    // 产出的 sub 串本身可被 parse 回 draft 视图（防拼串漂移）
    expect(parsePacksSubParam(feederDraftNavigation('abc')[0])).toEqual({ kind: 'draft', draftId: 'abc' })
  })
})
