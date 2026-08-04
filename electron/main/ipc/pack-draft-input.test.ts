import { describe, expect, it } from 'vitest'
import { readUpdatePackDraftInput } from './pack-draft-input.ts'

describe('readUpdatePackDraftInput（PR#477 P1-3：来源锁不可经通用更新通道改写）', () => {
  it('攻击复现：patch.meta.localSource 必须被白名单丢弃，不能原样透传', () => {
    const { patch } = readUpdatePackDraftInput({
      draftId: 'd1',
      patch: { meta: { name: '洗白后的名字', localSource: 'created' } },
    })
    expect(patch.meta).toEqual({ name: '洗白后的名字' })
    expect((patch.meta as Record<string, unknown> | undefined)?.localSource).toBeUndefined()
  })

  it('攻击复现：meta.learnedFrom/packId/lastPublishedVersion/draftId/derivedFrom 全部被丢弃', () => {
    const { patch } = readUpdatePackDraftInput({
      draftId: 'd1',
      patch: {
        meta: {
          learnedFrom: { title: '别人的书', tier: 'deep' },
          packId: '../evil',
          lastPublishedVersion: '9.9.9',
          draftId: 'not-the-real-id',
          derivedFrom: 'someone-elses-pack@1.0.0',
        },
      },
    })
    expect(patch.meta).toEqual({})
  })

  it('meta.name/author/description 三个合法字段照常放行', () => {
    const { patch } = readUpdatePackDraftInput({
      draftId: 'd1',
      patch: { meta: { name: 'N', author: 'A', description: 'D' } },
    })
    expect(patch.meta).toEqual({ name: 'N', author: 'A', description: 'D' })
  })

  it('meta.name 类型非法（非字符串）→ 抛错', () => {
    expect(() =>
      readUpdatePackDraftInput({ draftId: 'd1', patch: { meta: { name: 123 } } }),
    ).toThrow()
  })

  it('cards 数组：合法卡形状放行', () => {
    const card = {
      cardId: 'c1', type: 'persona', name: 'N', oneLine: '', body: 'b', intent: 'i', compiled: null,
    }
    const { patch } = readUpdatePackDraftInput({ draftId: 'd1', patch: { cards: [card] } })
    expect(patch.cards).toEqual([card])
  })

  it('cards 数组：条目缺字符串字段 → 抛错', () => {
    expect(() =>
      readUpdatePackDraftInput({ draftId: 'd1', patch: { cards: [{ cardId: 'c1' }] } }),
    ).toThrow()
  })

  it('cards 数组：compiled 既非对象也非 null → 抛错', () => {
    const card = { cardId: 'c1', type: 'persona', name: 'N', oneLine: '', body: 'b', intent: 'i', compiled: 'nope' }
    expect(() =>
      readUpdatePackDraftInput({ draftId: 'd1', patch: { cards: [card] } }),
    ).toThrow()
  })

  it('readme 字符串照常放行', () => {
    const { patch } = readUpdatePackDraftInput({ draftId: 'd1', patch: { readme: 'hello' } })
    expect(patch.readme).toBe('hello')
  })

  it('readme 非字符串 → 抛错', () => {
    expect(() => readUpdatePackDraftInput({ draftId: 'd1', patch: { readme: 42 } })).toThrow()
  })

  it('缺少 patch → 抛错', () => {
    expect(() => readUpdatePackDraftInput({ draftId: 'd1' })).toThrow()
  })

  it('缺少 draftId → 抛错', () => {
    expect(() => readUpdatePackDraftInput({ patch: {} })).toThrow()
  })
})
