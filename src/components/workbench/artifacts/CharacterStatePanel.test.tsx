import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '@/components/ui/tooltip'

import {
  buildSecretTogglePayload,
  CharacterStatePanelView,
  CharacterStateUnavailableNotice,
} from './CharacterStatePanel'
import type { StateEditController } from './CharacterStatePanel'
import type { CharacterStateSnapshot } from '@shared/types/character-state'
import type { PlannedStateRowDto } from '@shared/types/planned-state'

function snapshot(overrides: Partial<CharacterStateSnapshot> = {}): CharacterStateSnapshot {
  return {
    available: true,
    hasVocabulary: true,
    asOfChapter: 9,
    latestCompletedChapter: 9,
    identity: { gender: '女', age: '十六', aliases: [] },
    dimensions: [
      { key: 'cultivation_level', displayName: '境界', cardinality: 'one', valueType: 'enum', values: ['练气', '筑基', '金丹'] },
      { key: 'inventory', displayName: '持有物', cardinality: 'many', valueType: 'free', values: [] },
    ],
    card: [
      {
        key: 'cultivation_level',
        displayName: '境界',
        cardinality: 'one',
        values: [{ value: '筑基', source: 'extracted', chapter: 8, factId: 'f2', secretKnown: null }],
      },
      {
        key: 'inventory',
        displayName: '持有物',
        cardinality: 'many',
        values: [
          { value: '短刀', source: 'extracted', chapter: 5, factId: 'f3', secretKnown: null },
          { value: '令牌', source: 'authored', chapter: 9, factId: 'f4', secretKnown: null },
        ],
      },
    ],
    relationships: [{ otherName: '李四', state: '师徒', chapter: 3, source: 'extracted' }],
    timeline: [
      {
        key: 'cultivation_level',
        displayName: '境界',
        cardinality: 'one',
        events: [
          { factId: 'f1', value: '练气', chapter: 0, source: 'authored', invalidated: true, invalidatedAtChapter: 8, revoked: null, secretKnown: null },
          { factId: 'f2', value: '筑基', chapter: 8, source: 'extracted', invalidated: false, invalidatedAtChapter: null, revoked: null, secretKnown: null },
        ],
      },
      {
        key: 'inventory',
        displayName: '持有物',
        cardinality: 'many',
        events: [
          { factId: 'f5', value: '铁剑', chapter: 2, source: 'extracted', invalidated: true, invalidatedAtChapter: 5, revoked: null, secretKnown: null },
          { factId: 'f3', value: '短刀', chapter: 5, source: 'extracted', invalidated: false, invalidatedAtChapter: null, revoked: null, secretKnown: null },
        ],
      },
    ],
    ...overrides,
  }
}

function controller(overrides: Partial<StateEditController> = {}, snap: CharacterStateSnapshot = snapshot()): StateEditController {
  return {
    enabled: snap.hasVocabulary,
    dimensions: snap.dimensions,
    defaultChapter: snap.latestCompletedChapter,
    activeEditor: null,
    open: () => {},
    close: () => {},
    pending: false,
    submitState: async () => {},
    submitIdentity: async () => {},
    ...overrides,
  }
}

describe('CharacterStatePanelView（只读渲染）', () => {
  test('身份行回到状态卡首行', () => {
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snapshot()} />)
    expect(html).toContain('基本')
    expect(html).toContain('女 · 十六')
    // 身份行在第一个维度行之前
    expect(html.indexOf('女 · 十六')).toBeLessThan(html.indexOf('境界'))
  })

  test('身份编辑入口不受词表门管（enabled:false 仍可编辑）', () => {
    const html = renderToStaticMarkup(
      <CharacterStatePanelView snapshot={snapshot({ hasVocabulary: false })} controller={controller({ enabled: false, dimensions: [] })} />,
    )
    expect(html).toContain('aria-label="编辑身份字段"')
  })

  test('状态卡行是两列网格：左标签右值', () => {
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snapshot()} />)
    expect(html).toContain('grid-cols-[88px_minmax(0,1fr)_auto]')
  })

  test('状态卡按维度渲染，extracted 值带「待确认」徽标、authored 不带', () => {
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snapshot()} />)
    expect(html).toContain('data-character-state-panel="true"')
    expect(html).toContain('当前状态')
    expect(html).toContain('境界')
    expect(html).toContain('筑基')
    expect(html).toContain('待确认')
    expect(html).toContain('截至第 9 章')
    // authored 值不带待确认徽标：待确认 pill 只出现在 extracted 值上（筑基/短刀/师徒 3 处）
    expect(html.split('待确认').length - 1).toBe(3)
    // 徽标成族（spec 2026-08-04 §2.3）：「待确认」用琥珀描边 pill
    expect(html).toContain('border-warning/40')
  })

  test('状态卡超长值单行截断', () => {
    // brief 原文本 23 字未过 VALUE_CLAMP_THRESHOLD=24（ClampedValueText.tsx，Task 2 已定稿不可改），
    // 补两字使其确实超阈值，验证真实截断行为（否则本测试会在正确实现下误判失败）
    const long = '获得了一柄来历不明且蕴含上古剑意的神秘长剑青霜寒芒'
    const base = snapshot()
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <CharacterStatePanelView
          snapshot={{
            ...base,
            card: [
              {
                key: 'inventory',
                displayName: '持有物',
                cardinality: 'many',
                values: [{ value: long, source: 'authored', chapter: 9, factId: 'f9', secretKnown: null }],
              },
            ],
          }}
        />
      </TooltipProvider>,
    )
    expect(html).toContain('data-clamped-value="true"')
  })

  test('关系区渲染', () => {
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snapshot()} />)
    expect(html).toContain('李四')
    expect(html).toContain('师徒')
  })

  test('章节轴：one 维度演进链带箭头与作者钦定标记，第0章节点标「初始设定」', () => {
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snapshot()} />)
    expect(html).toContain('变更记录')
    expect(html).toContain('data-character-chapter-axis="true"')
    expect(html).toContain('初始设定')
    expect(html).toContain('练气')
    expect(html).toContain('作者钦定')
    expect(html).toContain('第 8 章')
    expect(html).toContain('→')
  })

  test('章节轴：many 维度自然失效项派生失去条目在原失去发生章标 −（非划线，非从未生效）', () => {
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snapshot()} />)
    const nodeStart = html.indexOf('data-chapter-axis-node="5"')
    expect(nodeStart).toBeGreaterThan(-1)
    const nextNodeStart = html.indexOf('data-chapter-axis-node="', nodeStart + 1)
    const nodeHtml = html.slice(nodeStart, nextNodeStart === -1 ? undefined : nextNodeStart)
    expect(nodeHtml).toContain('−')
  })

  test('时间线：revoked 事件划线并标「已修正」，不显示「已失去」', () => {
    const base = snapshot()
    const html = renderToStaticMarkup(
      <CharacterStatePanelView
        snapshot={{
          ...base,
          timeline: [
            {
              key: 'inventory',
              displayName: '持有物',
              cardinality: 'many',
              events: [
                { factId: 'x1', value: '错误物品', chapter: 4, source: 'extracted', invalidated: true, invalidatedAtChapter: 4, revoked: 'corrected', secretKnown: null },
                { factId: 'x2', value: '短刀', chapter: 5, source: 'extracted', invalidated: false, invalidatedAtChapter: null, revoked: null, secretKnown: null },
              ],
            },
          ],
        }}
      />,
    )
    expect(html).toContain('line-through')
    expect(html).toContain('已修正')
    expect(html).not.toContain('已失去')
  })

  test('时间线：revoked=retracted 事件标「已作废」，不进入 one 维度 prevValue 链（从未生效不充当旧值）', () => {
    const base = snapshot()
    const html = renderToStaticMarkup(
      <CharacterStatePanelView
        snapshot={{
          ...base,
          timeline: [
            {
              key: 'cultivation_level',
              displayName: '境界',
              cardinality: 'one',
              events: [
                { factId: 'x1', value: '练气', chapter: 3, source: 'extracted', invalidated: true, invalidatedAtChapter: 3, revoked: 'retracted', secretKnown: null },
                { factId: 'x2', value: '筑基', chapter: 8, source: 'extracted', invalidated: false, invalidatedAtChapter: null, revoked: null, secretKnown: null },
              ],
            },
          ],
        }}
      />,
    )
    expect(html).toContain('已作废')
    // revoked 行不进 prevValue 链（spec §4.3）：筑基是该维度第一条未撤销事件，无旧值可箭头回溯
    expect(html).not.toContain('→')
    expect(html).not.toContain('已修正')
  })

  test('空快照渲染克制空态一行', () => {
    const html = renderToStaticMarkup(
      <CharacterStatePanelView
        snapshot={snapshot({ card: [], relationships: [], timeline: [], identity: null, asOfChapter: null, dimensions: [] })}
      />,
    )
    expect(html).toContain('尚无结构化状态记录')
    expect(html).not.toContain('当前状态')
  })

  test('identity 有值但其余三数组皆空且无可编辑维度时不判定为空态（身份并回状态区）', () => {
    const html = renderToStaticMarkup(
      <CharacterStatePanelView
        snapshot={snapshot({
          card: [],
          relationships: [],
          timeline: [],
          identity: { gender: '女', age: '十六', aliases: [] },
          asOfChapter: null,
          dimensions: [],
        })}
      />,
    )
    expect(html).not.toContain('尚无结构化状态记录')
    expect(html).toContain('当前状态')
    expect(html).toContain('女 · 十六')
  })

  test('无 controller（只读）不渲染任何编辑入口', () => {
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snapshot()} />)
    expect(html).not.toContain('data-character-state-editor')
    expect(html).not.toContain('data-character-state-endorse')
    expect(html).not.toContain('aria-label="编辑境界"')
  })

  test('状态不可用提示文案', () => {
    const html = renderToStaticMarkup(<CharacterStateUnavailableNotice />)
    expect(html).toContain('data-character-state-unavailable="true"')
    expect(html).toContain('暂时无法展示')
  })
})

describe('CharacterStatePanelView（片2b 编辑入口）', () => {
  test('有词表时渲染编辑入口：one 维度编辑、many 维度添加/移除、章节轴补录/修正/作废', () => {
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snapshot()} controller={controller()} />)
    expect(html).toContain('aria-label="编辑境界"')
    expect(html).toContain('aria-label="添加持有物"')
    expect(html).toContain('aria-label="移除短刀"')
    expect(html).toContain('aria-label="补录记录"')
    expect(html).toContain('aria-label="修正筑基"')
    expect(html).toContain('aria-label="作废筑基"')
  })

  test('extracted 且带 factId 的卡面值：「待确认」pill 变可点确认按钮；关系区 pill 保持只读', () => {
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snapshot()} controller={controller()} />)
    // 卡面 extracted 两处（筑基/短刀）可点，关系区（师徒）只读 span
    expect(html.split('data-character-state-endorse').length - 1).toBe(2)
  })

  test('factId 为 null 的卡面值不出确认按钮（对不上事实，诚实兜底）', () => {
    const snap = snapshot({
      card: [
        {
          key: 'cultivation_level',
          displayName: '境界',
          cardinality: 'one',
          values: [{ value: '金丹', source: 'extracted', chapter: null, factId: null, secretKnown: null }],
        },
      ],
    })
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snap} controller={controller({}, snap)} />)
    expect(html).not.toContain('data-character-state-endorse')
  })

  test('无词表（存量书降级档）：controller.enabled=false，状态与时间线编辑入口全关', () => {
    const snap = snapshot({ hasVocabulary: false, dimensions: [] })
    const html = renderToStaticMarkup(
      <CharacterStatePanelView snapshot={snap} controller={controller({ enabled: false, dimensions: [] }, snap)} />,
    )
    expect(html).not.toContain('aria-label="编辑境界"')
    expect(html).not.toContain('aria-label="补录记录"')
    expect(html).not.toContain('data-character-state-endorse')
  })

  test('revoked 事件不再出修正/作废入口', () => {
    const snap = snapshot({
      timeline: [
        {
          key: 'cultivation_level',
          displayName: '境界',
          cardinality: 'one',
          events: [
            { factId: 'x1', value: '练气', chapter: 3, source: 'extracted', invalidated: true, invalidatedAtChapter: 3, revoked: 'retracted', secretKnown: null },
          ],
        },
      ],
    })
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snap} controller={controller({}, snap)} />)
    expect(html).not.toContain('aria-label="修正练气"')
    expect(html).not.toContain('aria-label="作废练气"')
  })

  test('词表维度尚无记录时渲染「未设定」占位行，仍可钦定', () => {
    const snap = snapshot({ card: [], timeline: [], relationships: [] })
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snap} controller={controller({}, snap)} />)
    expect(html).toContain('境界')
    expect(html).toContain('未设定')
    expect(html).toContain('aria-label="编辑境界"')
    expect(html).not.toContain('尚无结构化状态记录')
  })

  test('打开 one 维度编辑器：值域下拉 + 生效章 + 轻提示（当前值来源与章号）', () => {
    const html = renderToStaticMarkup(
      <CharacterStatePanelView snapshot={snapshot()} controller={controller({ activeEditor: 'card:cultivation_level' })} />,
    )
    expect(html).toContain('data-character-state-editor="true"')
    expect(html).toContain('当前值：筑基（第8章·正文抽取），保存后自生效章起覆盖')
    expect(html).toContain('保存')
    expect(html).toContain('取消')
  })

  test('打开时间线修正编辑器：固定语义提示「想改变剧情本身，请编辑正文或章纲」', () => {
    const html = renderToStaticMarkup(
      <CharacterStatePanelView snapshot={snapshot()} controller={controller({ activeEditor: 'tl-correct:f2' })} />,
    )
    expect(html).toContain('想改变剧情本身，请编辑正文或章纲')
    expect(html).toContain('修正')
  })

  test('打开身份编辑器：渲染性别/年龄/别名输入，含机械同步提示', () => {
    const html = renderToStaticMarkup(
      <CharacterStatePanelView snapshot={snapshot()} controller={controller({ activeEditor: 'identity' })} />,
    )
    expect(html).toContain('data-character-state-editor="true"')
    expect(html).toContain('性别')
    expect(html).toContain('年龄')
    expect(html).toContain('别名')
    expect(html).toContain('身份字段机械同步进档案 md')
  })

})

function plannedRow(overrides: Partial<PlannedStateRowDto> = {}): PlannedStateRowDto {
  return {
    id: 'p1',
    chapter: 12,
    status: 'planned',
    deferredToChapter: null,
    characterUid: 'u1',
    characterName: '角色甲',
    dimension: 'cultivation_level',
    operation: 'set',
    value: '金丹',
    reason: null,
    ...overrides,
  }
}

/**
 * 结构断言：提示节点必须落在打开的编辑器容器（data-character-state-editor 的 div）内部
 * （spec §6.3「编辑器底部一行淡提示」）。renderToStaticMarkup 输出无自闭合 div，按
 * `<div`/`</div>` 计数配平即可定位编辑器 div 的闭合位置，再判提示 index 是否在区间内。
 */
function hintInsideEditor(html: string): boolean {
  const marker = html.indexOf('data-character-state-editor="true"')
  const hintIndex = html.indexOf('data-future-plans-hint="true"')
  if (marker === -1 || hintIndex === -1) return false
  const editorOpen = html.lastIndexOf('<div', marker)
  const tagPattern = /<div\b|<\/div>/g
  tagPattern.lastIndex = editorOpen
  let depth = 0
  let editorClose = -1
  for (let match = tagPattern.exec(html); match !== null; match = tagPattern.exec(html)) {
    depth += match[0] === '</div>' ? -1 : 1
    if (depth === 0) {
      editorClose = match.index
      break
    }
  }
  return editorClose !== -1 && hintIndex > editorOpen && hintIndex < editorClose
}

describe('CharacterStatePanelView（轻提示②：角色页未来计划自查，spec §6.3）', () => {
  test('编辑器打开且有未来计划：提示渲染在编辑器容器内部，文案含章号/维度显示名/操作词/值', () => {
    const html = renderToStaticMarkup(
      <CharacterStatePanelView
        snapshot={snapshot()}
        controller={controller({ activeEditor: 'card:cultivation_level' })}
        futurePlans={[plannedRow()]}
      />,
    )
    expect(html).toContain('data-future-plans-hint="true"')
    expect(hintInsideEditor(html)).toBe(true)
    expect(html).toContain('该角色已有未来计划')
    expect(html).toContain('第 12 章')
    expect(html).toContain('境界')
    expect(html).toContain('变为')
    expect(html).toContain('金丹')
  })

  test('提示在页面靠后的编辑器（时间线修正编辑器）内同样就地渲染，不固定绑在首个编辑器', () => {
    const html = renderToStaticMarkup(
      <CharacterStatePanelView
        snapshot={snapshot()}
        controller={controller({ activeEditor: 'tl-correct:f2' })}
        futurePlans={[plannedRow()]}
      />,
    )
    expect(hintInsideEditor(html)).toBe(true)
  })

  test('多条未来计划以「；」拼接展示', () => {
    const html = renderToStaticMarkup(
      <CharacterStatePanelView
        snapshot={snapshot()}
        controller={controller({ activeEditor: 'card:cultivation_level' })}
        futurePlans={[
          plannedRow(),
          plannedRow({ id: 'p2', chapter: 15, dimension: 'inventory', operation: 'add', value: '玉简' }),
        ]}
      />,
    )
    expect(html).toContain('第 12 章 境界 变为「金丹」；第 15 章 持有物 获得「玉简」')
  })

  test('无未来计划（默认空数组）：编辑器打开也不渲染提示', () => {
    const html = renderToStaticMarkup(
      <CharacterStatePanelView snapshot={snapshot()} controller={controller({ activeEditor: 'card:cultivation_level' })} />,
    )
    expect(html).not.toContain('data-future-plans-hint')
    expect(html).not.toContain('该角色已有未来计划')
  })

  test('编辑器未打开（activeEditor 为空）：即便传入未来计划也不渲染提示', () => {
    const html = renderToStaticMarkup(
      <CharacterStatePanelView snapshot={snapshot()} controller={controller()} futurePlans={[plannedRow()]} />,
    )
    expect(html).not.toContain('data-future-plans-hint')
  })

  test('维度 key 在词表中缺映射时回退显示 key 本身', () => {
    const html = renderToStaticMarkup(
      <CharacterStatePanelView
        snapshot={snapshot()}
        controller={controller({ activeEditor: 'card:cultivation_level' })}
        futurePlans={[plannedRow({ dimension: 'unknown_dim' })]}
      />,
    )
    expect(html).toContain('unknown_dim')
  })
})

// ---------------------------------------------------------------------------
// Task 7（A4×D2 片4）：secret「本人已知晓」打标开关
// ---------------------------------------------------------------------------

function secretSnapshot(overrides: Partial<CharacterStateSnapshot> = {}): CharacterStateSnapshot {
  return snapshot({
    card: [
      {
        key: 'hidden_secret',
        displayName: '隐藏血脉',
        cardinality: 'one',
        values: [{ value: '身怀隐藏血脉', source: 'authored', chapter: 3, factId: 'f-secret', secretKnown: false }],
      },
    ],
    timeline: [],
    relationships: [],
    ...overrides,
  })
}

describe('CharacterStatePanelView（SSR 结构断言：secret 知晓开关，Task 7）', () => {
  test('非 secret 条目（secretKnown=null）不渲染知晓开关', () => {
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snapshot()} controller={controller()} />)
    expect(html).not.toContain('data-character-state-secret-known')
    expect(html).not.toContain('data-character-state-secret-toggle')
  })

  test('secret 条目显示知晓开关：卡面 factId 齐全 + controller 启用 → 可点按钮，文案含「本人未知晓」', () => {
    const snap = secretSnapshot()
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snap} controller={controller({}, snap)} />)
    const button = html.match(/<button[^>]*data-character-state-secret-toggle[^>]*>[^<]*/)?.[0] ?? ''
    expect(button).toContain('本人未知晓')
  })

  test('时间线事件 secret 条目（未撤回）：可点按钮，文案含「本人已知晓」，与卡面同构', () => {
    const snap = secretSnapshot({
      card: [],
      timeline: [
        {
          key: 'hidden_secret',
          displayName: '隐藏血脉',
          cardinality: 'one',
          events: [
            {
              factId: 'f-secret-tl',
              value: '身怀隐藏血脉',
              chapter: 3,
              source: 'authored',
              invalidated: false,
              invalidatedAtChapter: null,
              revoked: null,
              secretKnown: true,
            },
          ],
        },
      ],
    })
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snap} controller={controller({}, snap)} />)
    const button = html.match(/<button[^>]*data-character-state-secret-toggle[^>]*>[^<]*/)?.[0] ?? ''
    expect(button).toContain('本人已知晓')
  })

  test('factId=null 的 secret 条目只读展示：出徽标不出按钮', () => {
    const snap = secretSnapshot({
      card: [
        {
          key: 'hidden_secret',
          displayName: '隐藏血脉',
          cardinality: 'one',
          values: [{ value: '身怀隐藏血脉', source: 'authored', chapter: 3, factId: null, secretKnown: false }],
        },
      ],
    })
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snap} controller={controller({}, snap)} />)
    expect(html).toContain('data-character-state-secret-known')
    expect(html).toContain('本人未知晓')
    expect(html).not.toContain('data-character-state-secret-toggle')
  })

  test('无 controller（只读）：secret 条目出徽标不出按钮', () => {
    const snap = secretSnapshot()
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snap} />)
    expect(html).toContain('data-character-state-secret-known')
    expect(html).not.toContain('data-character-state-secret-toggle')
  })

  test('时间线事件 revoked 非空：secret 徽标只读展示，不出可点按钮（对齐 canOperate 口径，避免必错点击）', () => {
    const snap = secretSnapshot({
      card: [],
      timeline: [
        {
          key: 'hidden_secret',
          displayName: '隐藏血脉',
          cardinality: 'one',
          events: [
            {
              factId: 'f-secret-2',
              value: '身怀隐藏血脉',
              chapter: 3,
              source: 'authored',
              invalidated: true,
              invalidatedAtChapter: 3,
              revoked: 'retracted',
              secretKnown: true,
            },
          ],
        },
      ],
    })
    const html = renderToStaticMarkup(<CharacterStatePanelView snapshot={snap} controller={controller({}, snap)} />)
    expect(html).toContain('data-character-state-secret-known')
    expect(html).toContain('本人已知晓')
    expect(html).not.toContain('data-character-state-secret-toggle')
  })
})

// ---------------------------------------------------------------------------
// PR#458 P2（产品拍板 2026-07-15）：secret 开关脱离词表门，fact 锚定不需词表
// ---------------------------------------------------------------------------

describe('CharacterStatePanelView（PR#458 P2：secret 开关脱离词表门）', () => {
  test('无词表存量书（hasVocabulary=false→controller.enabled=false）+ 带 factId 的 secret 条目：知晓开关仍渲染可点按钮，不降级为只读徽标', () => {
    const snap = secretSnapshot({ hasVocabulary: false, dimensions: [] })
    const html = renderToStaticMarkup(
      <CharacterStatePanelView snapshot={snap} controller={controller({ enabled: false, dimensions: [] }, snap)} />,
    )
    const button = html.match(/<button[^>]*data-character-state-secret-toggle[^>]*>[^<]*/)?.[0] ?? ''
    expect(button).toContain('本人未知晓')
    // 按钮渲染即代表未降级为只读徽标（只读态用 data-character-state-secret-known 的 span，无 button）
    expect(html).not.toContain('data-character-state-secret-known')
  })

  test('同一 fixture 下维度编辑入口仍不出现：词表门只对维度锚定编辑放开，不影响 secret 开关', () => {
    const snap = secretSnapshot({ hasVocabulary: false, dimensions: [] })
    const html = renderToStaticMarkup(
      <CharacterStatePanelView snapshot={snap} controller={controller({ enabled: false, dimensions: [] }, snap)} />,
    )
    expect(html).not.toContain('aria-label="编辑境界"')
    expect(html).not.toContain('aria-label="补录记录"')
    expect(html).not.toContain('data-character-state-endorse')
  })
})

// 点击→submitState 的行为验证走纯函数 buildSecretTogglePayload（StateValueChip/时间线事件行
// onToggle 共用），而非真实 DOM fireEvent.click：本仓库真实 DOM 测试文件（happy-dom 经
// @happy-dom/global-registrator 全局注册）当时经验证同进程内安全共存上限已到（StateChangesLedger.
// test.tsx 等 3 个既有文件），实测追加第 4 个会导致 GlobalRegistrator 生命周期互相冲盖，
// `bun test ./electron ./src` 全量跑时 StateChangesLedger 的 18 个真实 DOM 用例全灭
// （document 查不到挂载节点）——因此当时改用纯函数覆盖「known 取反」核心逻辑，按钮渲染态与文案
// 由上面的 SSR 断言覆盖，两段合起来等价覆盖 brief 描述的「点按发出 mark_secret_known」行为。
//
// 【2026-07-29 复测更新】上面「上限=3」的结论已被 PR#501 评审修复推翻：BookVoiceAnchors.test.tsx
// 新增为本仓第 4 个注册 GlobalRegistrator 的真实 DOM 测试文件，连续 10 次 `bun --no-cache run test`
// （全量，2564 test / 275 files）实测 10/10 全绿，含本条注释记录过失败的 StateChangesLedger 全部
// 用例在内，一次没崩。当前依赖版本（bun 1.3.14、@happy-dom/global-registrator ^20.10.6）下 4 个
// 文件可安全共存——历史失败大概率是当时更早版本的问题，不是「文件数」本身的硬限制。本文件继续用
// 纯函数打法是既有实现足够、没有必要为验证同一逻辑重写，不代表新增真实 DOM 用例仍受阻；新增第 5 个
// 注册文件前，仍建议按同样方法（连续 10 次全量跑）实测验证，不要直接假设可无限扩容。
describe('buildSecretTogglePayload（Task 7：secret 知晓开关取反逻辑）', () => {
  test('未知晓 → 点按发出 known:true', () => {
    expect(buildSecretTogglePayload('f-secret', false)).toEqual({
      action: 'mark_secret_known',
      target_fact_id: 'f-secret',
      known: true,
    })
  })

  test('已知晓 → 点按发出 known:false（撤销标记）', () => {
    expect(buildSecretTogglePayload('f-secret-tl', true)).toEqual({
      action: 'mark_secret_known',
      target_fact_id: 'f-secret-tl',
      known: false,
    })
  })
})
