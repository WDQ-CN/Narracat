import { describe, expect, test } from 'bun:test'
import { applyPremiseFieldEdit, parsePremiseFieldEditInput, type PremiseFieldEdit, type RawPremisePayload } from './premise-edit.ts'

function editContent(overrides: Partial<PremiseFieldEdit> = {}): PremiseFieldEdit {
  return {
    kind: 'edit-content',
    cardKey: 'genre_contract',
    fieldIndex: 0, // subgenre（第一档）
    newValue: '仙侠·御兽流',
    expectedKey: 'subgenre',
    expectedValue: '仙侠',
    expectedCertainty: 'canon',
    ...overrides,
  } as PremiseFieldEdit
}

function sample(): RawPremisePayload {
  return {
    cards: [
      {
        card: 'genre_contract',
        fields: [
          { key: 'subgenre', value: '仙侠', certainty: 'canon' },
          { key: 'surprise_point', value: '反套路', certainty: 'tentative' },
          { key: 'emotional_tone', value: '占位', certainty: 'open' },
        ],
      },
    ],
  }
}

/** 默认对齐 sample() 的 surprise_point（暂定）那条——乐观锁三件套匹配。 */
function markCanon(overrides: Partial<PremiseFieldEdit> = {}): PremiseFieldEdit {
  return {
    kind: 'mark-canon' as const,
    cardKey: 'genre_contract',
    fieldIndex: 1,
    certainty: 'canon',
    expectedKey: 'surprise_point',
    expectedValue: '反套路',
    expectedCertainty: 'tentative',
    ...overrides,
  }
}

describe('applyPremiseFieldEdit · 边界守卫（App 直写仅 暂定→已定）', () => {
  test('暂定 → 已定 成功（标记为已定，内容不变，不改原 payload）', () => {
    const payload = sample()
    const out = applyPremiseFieldEdit(payload, markCanon())
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.payload.cards[0].fields?.[1].certainty).toBe('canon')
      expect(out.payload.cards[0].fields?.[1].value).toBe('反套路') // 内容不变
    }
    // 不可变：原 payload 未被改
    expect(payload.cards[0].fields?.[1].certainty).toBe('tentative')
  })

  test('未确定 → 已定 被拒（非暂定，定内容走 AI）', () => {
    const out = applyPremiseFieldEdit(
      sample(),
      markCanon({ fieldIndex: 2, expectedKey: 'emotional_tone', expectedValue: '占位', expectedCertainty: 'open' }),
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('暂定')
  })

  test('已定 → 已定 被拒（非暂定项）', () => {
    const out = applyPremiseFieldEdit(
      sample(),
      markCanon({ fieldIndex: 0, expectedKey: 'subgenre', expectedValue: '仙侠', expectedCertainty: 'canon' }),
    )
    expect(out.ok).toBe(false)
  })

  test('乐观锁：fieldIndex 处字段与渲染时不符（Agent 改过）→ 拒绝并要求刷新', () => {
    // 渲染时点的是「反套路」，但 main 读盘时该位置 value 已变
    const drifted: RawPremisePayload = {
      cards: [
        {
          card: 'genre_contract',
          fields: [
            { key: 'subgenre', value: '仙侠', certainty: 'canon' },
            { key: 'surprise_point', value: '反套路师徒（已被 Agent 改写）', certainty: 'tentative' },
          ],
        },
      ],
    }
    const out = applyPremiseFieldEdit(drifted, markCanon())
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('刷新')
  })

  test('乐观锁：同卡字段顺序变化（key 不符）→ 拒绝', () => {
    // surprise_point 被挪到 index 0，index 1 现在是另一条暂定项
    const reordered: RawPremisePayload = {
      cards: [
        {
          card: 'genre_contract',
          fields: [
            { key: 'surprise_point', value: '反套路', certainty: 'tentative' },
            { key: 'reader_expectation', value: '另一条暂定', certainty: 'tentative' },
          ],
        },
      ],
    }
    // 仍按渲染时的 expected（surprise_point @1）提交 → index 1 现在是 reader_expectation，key 不符
    const out = applyPremiseFieldEdit(reordered, markCanon())
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('刷新')
  })

  test('未找到卡 / 越界条目被拒', () => {
    expect(applyPremiseFieldEdit(sample(), markCanon({ cardKey: 'bogus' })).ok).toBe(false)
    expect(applyPremiseFieldEdit(sample(), markCanon({ fieldIndex: 9 })).ok).toBe(false)
  })
})

describe('applyPremiseFieldEdit · 第一档内容编辑', () => {
  test('第一档字段改内容成功：value 改为新值、确定度置 canon、不可变原 payload', () => {
    const payload = sample()
    const out = applyPremiseFieldEdit(payload, editContent())
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.payload.cards[0].fields?.[0].value).toBe('仙侠·御兽流')
      expect(out.payload.cards[0].fields?.[0].certainty).toBe('canon')
    }
    expect(payload.cards[0].fields?.[0].value).toBe('仙侠') // 原对象未被改
  })

  test('第二档字段拒绝直写（需经评估）', () => {
    const payload: RawPremisePayload = {
      cards: [{ card: 'narrator_voice', fields: [{ key: 'tone', value: '冷峻', certainty: 'canon' }] }],
    }
    const out = applyPremiseFieldEdit(
      payload,
      editContent({ cardKey: 'narrator_voice', fieldIndex: 0, newValue: '热血', expectedKey: 'tone', expectedValue: '冷峻' }),
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('评估')
  })

  test('空新值拒绝', () => {
    const out = applyPremiseFieldEdit(sample(), editContent({ newValue: '  ' }))
    expect(out.ok).toBe(false)
  })

  test('第一档 tentative 字段改内容：value 更新、certainty 提升为 canon（tentative→canon）', () => {
    const payload = sample()
    // surprise_point 在 genre_contract 卡的 fieldIndex=1，初始确定度为 tentative
    const out = applyPremiseFieldEdit(
      payload,
      editContent({
        fieldIndex: 1,
        expectedKey: 'surprise_point',
        expectedValue: '反套路',
        expectedCertainty: 'tentative',
        newValue: '逆天改命',
      }),
    )
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.payload.cards[0].fields?.[1].value).toBe('逆天改命')
      expect(out.payload.cards[0].fields?.[1].certainty).toBe('canon')
    }
    // 不可变：原 payload 未被改
    expect(payload.cards[0].fields?.[1].value).toBe('反套路')
    expect(payload.cards[0].fields?.[1].certainty).toBe('tentative')
  })

  test('乐观锁：渲染时值与读盘最新不符 → 拒绝并要求刷新', () => {
    const out = applyPremiseFieldEdit(sample(), editContent({ expectedValue: '已被改写' }))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('刷新')
  })
})

describe('parsePremiseFieldEditInput · 两类编辑入参', () => {
  const lock = { expectedKey: 'subgenre', expectedValue: '仙侠', expectedCertainty: 'canon' }

  test('mark-canon 入参解析', () => {
    const out = parsePremiseFieldEditInput({
      kind: 'mark-canon', projectPath: '/p', cardKey: 'genre_contract', fieldIndex: 1, certainty: 'canon', ...lock,
    })
    expect(out.projectPath).toBe('/p')
    expect(out.edit.kind).toBe('mark-canon')
  })

  test('edit-content 入参解析', () => {
    const out = parsePremiseFieldEditInput({
      kind: 'edit-content', projectPath: '/p', cardKey: 'genre_contract', fieldIndex: 0, newValue: '玄幻', ...lock,
    })
    expect(out.edit.kind).toBe('edit-content')
    if (out.edit.kind === 'edit-content') expect(out.edit.newValue).toBe('玄幻')
  })

  test('未知 kind 抛错', () => {
    expect(() => parsePremiseFieldEditInput({ kind: 'bogus' })).toThrow()
  })

  test('edit-content 的 newValue 为空白字符串时抛错', () => {
    expect(() =>
      parsePremiseFieldEditInput({
        kind: 'edit-content', projectPath: '/p', cardKey: 'genre_contract', fieldIndex: 0, newValue: '   ', ...lock,
      }),
    ).toThrow('新内容不能为空')
  })
})
