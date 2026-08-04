import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PremiseCardsView } from './PremiseCardsView'
import type { NovelWorkbenchArtifact } from '@shared/types/novel'

const artifact: NovelWorkbenchArtifact = {
  id: 'bible-premise',
  kind: 'markdown',
  title: '核心前提',
  path: '/novels/stars/bible/premise.md',
  exists: true,
  data: {
    cards: [
      {
        card: 'genre_contract',
        fields: [
          { key: 'subgenre', value: '仙侠·宗门流' }, // canon（未标注）
          { key: 'surprise_point', value: '反套路师徒', certainty: 'tentative' },
        ],
      },
      {
        card: 'golden_finger',
        fields: [
          { key: 'ability', value: '吞噬同化', certainty: 'canon' },
          { key: 'feedback_loop', value: '待定的反馈机制', certainty: 'open' },
        ],
      },
    ],
  },
}

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node)

describe('PremiseCardsView · 分组列表', () => {
  test('卡标题 + 字段标题/内容 + 状态前置三态，套阅读外壳', () => {
    const html = render(<PremiseCardsView artifact={artifact} projectPath="/novels/stars" onDiscuss={() => {}} />)
    expect(html).toContain('data-reading-canvas="true"')
    expect(html).toContain('data-premise-card="genre_contract"')
    expect(html).toContain('题材读者契约')
    expect(html).toContain('细分题材')
    expect(html).toContain('仙侠·宗门流')
    // 状态前置三态（已定/暂定/未确定）
    expect(html).toContain('data-premise-field-status="canon"')
    expect(html).toContain('data-premise-field-status="tentative"')
    expect(html).toContain('data-premise-field-status="open"')
    expect(html).toContain('未确定')
    expect(html).not.toContain('[canon]')
    // 卡级状态标签已删
    expect(html).not.toContain('data-premise-card-status')
  })

  test('操作区：未确定显性「讨论确定」，已定/暂定收进 ⋯ 菜单', () => {
    const html = render(<PremiseCardsView artifact={artifact} projectPath="/novels/stars" onDiscuss={() => {}} />)
    expect(html).toContain('data-premise-discuss="settle"')
    expect(html).toContain('讨论确定')
    expect(html).toContain('data-premise-field-menu="true"')
  })

  test('只读模式（无 projectPath / onDiscuss）：仅状态前置，无操作入口', () => {
    const html = render(<PremiseCardsView artifact={artifact} />)
    expect(html).toContain('data-premise-field-status="open"')
    expect(html).not.toContain('data-premise-discuss')
    expect(html).not.toContain('data-premise-field-menu')
  })

  test('留白声明汇总卡（暂定 / 未确定项）', () => {
    const html = render(<PremiseCardsView artifact={artifact} projectPath="/novels/stars" onDiscuss={() => {}} />)
    expect(html).toContain('data-premise-card="openness"')
    expect(html).toContain('留白声明')
    expect(html).toContain('题材读者契约·本书超预期点')
    expect(html).toContain('金手指与爽点引擎·反馈回路')
  })

  test('全 canon：第 9 卡空态文案', () => {
    const allCanon: NovelWorkbenchArtifact = {
      ...artifact,
      data: { cards: [{ card: 'core_hook', fields: [{ key: 'hook', value: '开篇钩子' }] }] },
    }
    const html = render(<PremiseCardsView artifact={allCanon} projectPath="/novels/stars" onDiscuss={() => {}} />)
    expect(html).toContain('data-premise-openness-empty="true"')
    expect(html).toContain('九卡均已定，暂无暂定或未确定项')
  })

  test('空态：未生成 / 契约缺失各自降级', () => {
    expect(render(<PremiseCardsView artifact={{ ...artifact, exists: false }} />)).toContain('立项卡尚未生成')
    expect(render(<PremiseCardsView artifact={{ ...artifact, data: undefined }} />)).toContain('立项卡无法显示')
  })
})

describe('PremiseCardsView · 第一档内联编辑入口', () => {
  const editArtifact = {
    id: 'bible-premise',
    kind: 'markdown',
    title: '核心前提',
    exists: true,
    data: {
      cards: [
        { card: 'genre_contract', fields: [{ key: 'subgenre', value: '仙侠', certainty: 'canon' }] },
        { card: 'narrator_voice', fields: [{ key: 'tone', value: '冷峻', certainty: 'canon' }] },
      ],
    },
  } as unknown as NovelWorkbenchArtifact

  test('第一档字段（subgenre）行标记为可编辑', () => {
    const html = renderToStaticMarkup(
      <PremiseCardsView artifact={editArtifact} projectPath="/p" onDiscuss={() => {}} />,
    )
    expect(html).toContain('data-premise-editable="true"')
  })

  test('第二档字段（narrator_voice.tone）行不标记为可编辑', () => {
    const onlySecond = {
      ...editArtifact,
      data: { cards: [{ card: 'narrator_voice', fields: [{ key: 'tone', value: '冷峻', certainty: 'canon' }] }] },
    } as unknown as NovelWorkbenchArtifact
    const html = renderToStaticMarkup(
      <PremiseCardsView artifact={onlySecond} projectPath="/p" onDiscuss={() => {}} />,
    )
    expect(html).not.toContain('data-premise-editable="true"')
  })

  test('只读模式（无 projectPath）行不标记为可编辑', () => {
    const html = renderToStaticMarkup(<PremiseCardsView artifact={editArtifact} />)
    expect(html).not.toContain('data-premise-editable="true"')
  })
})

describe('PremiseCardsView · 第二档评估编辑入口', () => {
  const base = { id: 'bible-premise', kind: 'markdown', title: '核心前提', exists: true }

  const secondTierOnly = {
    ...base,
    data: { cards: [{ card: 'antagonistic_force', fields: [{ key: 'force', value: '宿命天敌', certainty: 'canon' }] }] },
  } as unknown as NovelWorkbenchArtifact

  const firstTierOnly = {
    ...base,
    data: { cards: [{ card: 'genre_contract', fields: [{ key: 'subgenre', value: '仙侠', certainty: 'canon' }] }] },
  } as unknown as NovelWorkbenchArtifact

  const worldRulesOnly = {
    ...base,
    data: { cards: [{ card: 'world_rules', fields: [{ key: 'rule', value: '灵气复苏', certainty: 'canon', note: '冲突描述' }] }] },
  } as unknown as NovelWorkbenchArtifact

  test('第二档字段提供 onEvaluateImpact 时标记为可评估编辑', () => {
    const html = renderToStaticMarkup(
      <PremiseCardsView artifact={secondTierOnly} projectPath="/p" onDiscuss={() => {}} onEvaluateImpact={() => {}} />,
    )
    expect(html).toContain('data-premise-evaluable="true"')
  })

  test('未提供 onEvaluateImpact 时第二档不出评估入口', () => {
    const html = renderToStaticMarkup(
      <PremiseCardsView artifact={secondTierOnly} projectPath="/p" onDiscuss={() => {}} />,
    )
    expect(html).not.toContain('data-premise-evaluable="true"')
  })

  test('world_rules 字段不出第二档评估入口（本期后置）', () => {
    const html = renderToStaticMarkup(
      <PremiseCardsView artifact={worldRulesOnly} projectPath="/p" onDiscuss={() => {}} onEvaluateImpact={() => {}} />,
    )
    expect(html).not.toContain('data-premise-evaluable="true"')
  })

  test('第一档字段不被标记为可评估（仍走第一档直改）', () => {
    const html = renderToStaticMarkup(
      <PremiseCardsView artifact={firstTierOnly} projectPath="/p" onDiscuss={() => {}} onEvaluateImpact={() => {}} />,
    )
    expect(html).toContain('data-premise-editable="true"')
    expect(html).not.toContain('data-premise-evaluable="true"')
  })

  test('只读模式（无 projectPath / onEvaluateImpact）无评估入口', () => {
    const html = renderToStaticMarkup(<PremiseCardsView artifact={secondTierOnly} />)
    expect(html).not.toContain('data-premise-evaluable="true"')
  })
})
