import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChapterAxisTimeline, CHAPTER_NODES_BATCH, INITIAL_CHAPTER_NODES } from './ChapterAxisTimeline'
import type { StateEditController } from './CharacterStatePanel'
import type { CharacterStateDimensionInfo, CharacterTimelineEvent, CharacterTimelineGroup } from '@shared/types/character-state'

function event(overrides: Partial<CharacterTimelineEvent>): CharacterTimelineEvent {
  return {
    factId: 'f0',
    value: '值',
    chapter: 1,
    source: 'extracted',
    invalidated: false,
    invalidatedAtChapter: null,
    revoked: null,
    secretKnown: null,
    ...overrides,
  }
}

const DIMS: CharacterStateDimensionInfo[] = [
  { key: 'cultivation_level', displayName: '境界', cardinality: 'one', valueType: 'enum', values: ['练气', '筑基', '金丹'] },
  { key: 'inventory', displayName: '持有物', cardinality: 'many', valueType: 'free', values: [] },
]

function controller(overrides: Partial<StateEditController> = {}): StateEditController {
  return {
    enabled: true,
    dimensions: DIMS,
    defaultChapter: 9,
    activeEditor: null,
    open: () => {},
    close: () => {},
    pending: false,
    submitState: async () => {},
    submitIdentity: async () => {},
    ...overrides,
  }
}

/** N 个章各一条境界事件（章号 1..N 升序，组内契约） */
function manyChapters(count: number): CharacterTimelineGroup[] {
  return [
    {
      key: 'cultivation_level',
      displayName: '境界',
      cardinality: 'one',
      events: Array.from({ length: count }, (_, i) => event({ factId: `f${i + 1}`, value: `境界${i + 1}`, chapter: i + 1 })),
    },
  ]
}

describe('ChapterAxisTimeline', () => {
  test('空时间线仍渲染容器与空态文案', () => {
    const html = renderToStaticMarkup(<ChapterAxisTimeline groups={[]} dimensions={DIMS} />)
    expect(html).toContain('data-character-chapter-axis="true"')
    expect(html).toContain('还没有变更记录')
  })

  test('空时间线 + 编辑开启：补录入口仍出现', () => {
    const html = renderToStaticMarkup(
      <ChapterAxisTimeline groups={[]} dimensions={DIMS} controller={controller({ enabled: true })} />,
    )
    expect(html).toContain('aria-label="补录记录"')
  })

  test('少于初始批量：全部节点渲染、最新章在上、无展开按钮', () => {
    const html = renderToStaticMarkup(<ChapterAxisTimeline groups={manyChapters(3)} dimensions={DIMS} />)
    expect(html).toContain('变更记录')
    expect(html.indexOf('第 3 章')).toBeLessThan(html.indexOf('第 1 章'))
    expect(html).not.toContain('显示更早记录')
  })

  test('超过初始批量：只渲染最近 10 章节点 + 展开按钮带剩余计数', () => {
    const html = renderToStaticMarkup(<ChapterAxisTimeline groups={manyChapters(INITIAL_CHAPTER_NODES + 2)} dimensions={DIMS} />)
    expect(html).toContain(`第 ${INITIAL_CHAPTER_NODES + 2} 章`)
    expect(html).toContain('第 3 章')
    expect(html).not.toContain('data-chapter-axis-node="2"')
    expect(html).not.toContain('data-chapter-axis-node="1"')
    expect(html).toContain('显示更早记录（还有 2 章）')
    expect(CHAPTER_NODES_BATCH).toBe(20)
  })

  test('展开计数不含初始设定节点：12 个真实章 + 1 条 chapter 0 事件，未显示的 3 个节点里只 2 个是真实章', () => {
    // 12 个真实章事件（chapter 1..12）+ 1 条 chapter 0 事件 = 13 节点；chapter 0 恒垫底，
    // 初始只渲染最近 10 个真实章节点（12..3），未显示的 3 个节点=[2, 1, 0]，
    // 其中 chapter 0 不计入「还有 N 章」（PR 终审修复：N 此前把初始设定也算作一章）。
    const groups: CharacterTimelineGroup[] = [
      {
        key: 'cultivation_level',
        displayName: '境界',
        cardinality: 'one',
        events: [
          event({ factId: 'f0', value: '初始境界', chapter: 0, source: 'authored' }),
          ...Array.from({ length: 12 }, (_, i) =>
            event({ factId: `f${i + 1}`, value: `境界${i + 1}`, chapter: i + 1 }),
          ),
        ],
      },
    ]
    const html = renderToStaticMarkup(<ChapterAxisTimeline groups={groups} dimensions={DIMS} />)
    expect(html).toContain('第 12 章')
    expect(html).toContain('第 3 章')
    expect(html).not.toContain('data-chapter-axis-node="2"')
    expect(html).not.toContain('data-chapter-axis-node="0"')
    expect(html).toContain('显示更早记录（还有 2 章）')
  })

  test('未显示节点只剩初始设定：按钮文案退化为不带计数', () => {
    const groups: CharacterTimelineGroup[] = [
      {
        key: 'cultivation_level',
        displayName: '境界',
        cardinality: 'one',
        events: [
          event({ factId: 'f0', value: '初始境界', chapter: 0, source: 'authored' }),
          ...Array.from({ length: INITIAL_CHAPTER_NODES }, (_, i) =>
            event({ factId: `f${i + 1}`, value: `境界${i + 1}`, chapter: i + 1 }),
          ),
        ],
      },
    ]
    const html = renderToStaticMarkup(<ChapterAxisTimeline groups={groups} dimensions={DIMS} />)
    expect(html).toContain('显示更早记录')
    expect(html).not.toContain('显示更早记录（还有')
  })

  test('one 维度显示 旧值→新值，第 0 章节点标「初始设定」', () => {
    const groups: CharacterTimelineGroup[] = [
      {
        key: 'cultivation_level',
        displayName: '境界',
        cardinality: 'one',
        events: [
          event({ factId: 'f1', value: '练气', chapter: 0, source: 'authored' }),
          event({ factId: 'f2', value: '筑基', chapter: 8 }),
        ],
      },
    ]
    const html = renderToStaticMarkup(<ChapterAxisTimeline groups={groups} dimensions={DIMS} />)
    expect(html).toContain('初始设定')
    expect(html).toContain('练气')
    expect(html).toContain('→')
    expect(html).toContain('筑基')
    expect(html).toContain('作者钦定')
  })

  test('many 维度获得带 +，派生失去条目带 − 且不开修正/作废入口', () => {
    const groups: CharacterTimelineGroup[] = [
      {
        key: 'inventory',
        displayName: '持有物',
        cardinality: 'many',
        events: [event({ factId: 'f5', value: '铁剑', chapter: 2, invalidated: true, invalidatedAtChapter: 6 })],
      },
    ]
    const html = renderToStaticMarkup(<ChapterAxisTimeline groups={groups} dimensions={DIMS} controller={controller()} />)
    expect(html).toContain('+')
    expect(html).toContain('−')
    // 第 2 章获得条目开修正/作废；第 6 章派生失去条目不开——恰好各出现一次
    expect(html.split('aria-label="修正铁剑"').length - 1).toBe(1)
    expect(html.split('aria-label="作废铁剑"').length - 1).toBe(1)
  })

  test('revoked 条目划线标注且不开编辑入口', () => {
    const groups: CharacterTimelineGroup[] = [
      {
        key: 'cultivation_level',
        displayName: '境界',
        cardinality: 'one',
        events: [event({ factId: 'f1', value: '错误值', chapter: 4, invalidated: true, invalidatedAtChapter: 4, revoked: 'corrected' })],
      },
    ]
    const html = renderToStaticMarkup(<ChapterAxisTimeline groups={groups} dimensions={DIMS} controller={controller()} />)
    expect(html).toContain('line-through')
    expect(html).toContain('已修正')
    expect(html).not.toContain('aria-label="修正错误值"')
  })

  test('补录入口：enabled 时标题右侧有补录按钮，activeEditor=axis-backfill 渲染维度选择编辑器', () => {
    const html = renderToStaticMarkup(
      <ChapterAxisTimeline groups={manyChapters(2)} dimensions={DIMS} controller={controller({ activeEditor: 'axis-backfill' })} />,
    )
    expect(html).toContain('data-chapter-axis-backfill="true"')
    expect(html).toContain('补录')
    const closed = renderToStaticMarkup(<ChapterAxisTimeline groups={manyChapters(2)} dimensions={DIMS} controller={controller()} />)
    expect(closed).toContain('aria-label="补录记录"')
    const readonly = renderToStaticMarkup(
      <ChapterAxisTimeline groups={manyChapters(2)} dimensions={DIMS} controller={controller({ enabled: false })} />,
    )
    expect(readonly).not.toContain('aria-label="补录记录"')
  })

  test('圆点时间线：竖轴容器与节点圆点', () => {
    const html = renderToStaticMarkup(<ChapterAxisTimeline groups={manyChapters(2)} dimensions={DIMS} />)
    expect(html).toContain('data-chapter-axis-rail="true"')
    expect(html.split('data-chapter-axis-dot="true"').length - 1).toBe(2)
  })

  test('获得/失去符号带语义色', () => {
    const groups: CharacterTimelineGroup[] = [
      {
        key: 'inventory',
        displayName: '持有物',
        cardinality: 'many',
        events: [event({ factId: 'f5', value: '铁剑', chapter: 2, invalidated: true, invalidatedAtChapter: 6 })],
      },
    ]
    const html = renderToStaticMarkup(<ChapterAxisTimeline groups={groups} dimensions={DIMS} />)
    expect(html).toContain('text-success')
    expect(html).toContain('text-destructive')
  })

  test('作者钦定等标注渲染为徽标 pill 而非括号后缀', () => {
    const groups: CharacterTimelineGroup[] = [
      {
        key: 'cultivation_level',
        displayName: '境界',
        cardinality: 'one',
        events: [event({ factId: 'f1', value: '练气', chapter: 3, source: 'authored' })],
      },
    ]
    const html = renderToStaticMarkup(<ChapterAxisTimeline groups={groups} dimensions={DIMS} />)
    expect(html).toContain('作者钦定')
    expect(html).not.toContain('（作者钦定）')
  })

  test('activeEditor 命中条目时渲染修正编辑器', () => {
    const html = renderToStaticMarkup(
      <ChapterAxisTimeline groups={manyChapters(2)} dimensions={DIMS} controller={controller({ activeEditor: 'tl-correct:f2' })} />,
    )
    expect(html).toContain('data-character-state-editor="true"')
    expect(html).toContain('修正记忆使其符合正文')
  })
})
