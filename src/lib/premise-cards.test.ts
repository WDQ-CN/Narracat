import { describe, expect, test } from 'bun:test'
import {
  buildPremiseCardViews,
  renderPremiseCardsMarkdown,
  summarizePremiseOpenness,
  type PremiseCardsData,
} from './premise-cards'

const sample: PremiseCardsData = {
  cards: [
    {
      card: 'genre_contract',
      fields: [
        { key: 'subgenre', value: '仙侠·宗门流' },
        { key: 'surprise_point', value: '反套路师徒', certainty: 'tentative' },
      ],
    },
    { card: 'core_hook', fields: [{ key: 'hook', value: '开篇主角被废丹田' }] },
    {
      card: 'golden_finger',
      fields: [
        { key: 'ability', value: '吞噬同化' },
        { key: 'feedback_loop', value: '待定的反馈机制', certainty: 'open' },
      ],
    },
    {
      card: 'world_rules',
      fields: [{ key: '灵气有限', value: '灵气是稀缺资源', note: '让宗门为矿脉火并' }],
    },
    {
      card: 'narrator_voice',
      fields: [
        { key: 'archetype', value: '冷峻第三人称' },
        { key: 'reference_example', value: '某段范例', note: '机制注解' },
      ],
    },
  ],
}

describe('premise-cards · 视图模型', () => {
  test('八张卡按固定顺序构建，缺卡安静跳过', () => {
    const views = buildPremiseCardViews(sample)
    expect(views.map((v) => v.key)).toEqual([
      'genre_contract',
      'core_hook',
      'golden_finger',
      'world_rules',
      'narrator_voice',
    ])
    // 卡序号按固定顺序（不随缺卡压缩）
    expect(views.find((v) => v.key === 'world_rules')?.index).toBe(7)
    expect(views.find((v) => v.key === 'narrator_voice')?.index).toBe(8)
  })

  test('确定度规整：未标注视为 canon，三态正确标记', () => {
    const views = buildPremiseCardViews(sample)
    const genre = views.find((v) => v.key === 'genre_contract')!
    expect(genre.fields[0]).toMatchObject({ isTentative: false, isOpen: false, certaintyLabel: '已定' })
    expect(genre.fields[1]).toMatchObject({ isTentative: true, certaintyLabel: '暂定' })
    expect(genre.hasGap).toBe(true)

    const golden = views.find((v) => v.key === 'golden_finger')!
    expect(golden.fields[1]).toMatchObject({ isOpen: true, certaintyLabel: '未确定' })
  })

  test('子字段卡用中文标签；prose 卡 / world_rules 无标签直呈 value', () => {
    const views = buildPremiseCardViews(sample)
    expect(views.find((v) => v.key === 'genre_contract')!.fields[0].label).toBe('细分题材')
    expect(views.find((v) => v.key === 'narrator_voice')!.fields[0].label).toBe('腔调原型')
    expect(views.find((v) => v.key === 'core_hook')!.fields[0].label).toBe('')
    expect(views.find((v) => v.key === 'world_rules')!.fields[0].label).toBe('')
  })

  test('未知卡 / 无值字段降级跳过，不抛错', () => {
    expect(buildPremiseCardViews(undefined)).toEqual([])
    expect(buildPremiseCardViews({ cards: [{ card: 'bogus_card', fields: [{ value: 'x' }] }] })).toEqual([])
    expect(buildPremiseCardViews({ cards: [{ card: 'core_hook', fields: [{ key: 'h', value: '   ' }] }] })).toEqual([])
  })

  test('留白声明自动汇总暂定 / 留白项', () => {
    const { tentative, open } = summarizePremiseOpenness(sample)
    expect(tentative.map((r) => `${r.cardTitle}·${r.fieldLabel}`)).toEqual(['题材读者契约·本书超预期点'])
    expect(open.map((r) => `${r.cardTitle}·${r.fieldLabel}`)).toEqual(['金手指与爽点引擎·反馈回路'])
  })
})

describe('premise-cards · 复制 markdown', () => {
  const md = renderPremiseCardsMarkdown(sample)

  test('按序渲染卡标题与字段（含 prose / world_rules / narrator_voice 形态）', () => {
    expect(md).toContain('## 1 题材读者契约')
    expect(md).toContain('- 细分题材：仙侠·宗门流')
    expect(md).toContain('## 2 核心钩子')
    expect(md).toContain('开篇主角被废丹田')
    expect(md).toContain('## 7 世界规则可冲突性')
    expect(md).toContain('- 灵气是稀缺资源 —— 让宗门为矿脉火并')
    expect(md).toContain('## 8 叙述声音')
    expect(md).toContain('- 腔调原型：冷峻第三人称')
    expect(md).toContain('- 范例片段：某段范例（机制注解）')
  })

  test('确定度：canon 不标注，暂定 / 未确定渲染中文徽标，无裸机器枚举', () => {
    expect(md).toContain('- 本书超预期点：反套路师徒（暂定）')
    expect(md).toContain('待定的反馈机制（未确定）')
    expect(md).toContain('## 9 留白声明')
    expect(md).toContain('- 暂定：题材读者契约·本书超预期点')
    expect(md).toContain('- 未确定：金手指与爽点引擎·反馈回路')
    // 用户通道不残留裸枚举值
    expect(md).not.toMatch(/\b(canon|tentative|open)\b/)
    expect(md).not.toContain('[canon]')
  })

  test('缺契约降级为占位文案，不抛错', () => {
    expect(renderPremiseCardsMarkdown(undefined)).toContain('立项卡数据契约缺失或为空')
    expect(renderPremiseCardsMarkdown({ cards: [] })).toContain('立项卡数据契约缺失或为空')
  })

  test('九卡全 canon 时留白声明显示空态', () => {
    const md2 = renderPremiseCardsMarkdown({ cards: [{ card: 'core_hook', fields: [{ value: '钩子' }] }] })
    expect(md2).toContain('（九卡均已定，暂无暂定或未确定项）')
  })
})
