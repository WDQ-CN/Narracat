import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PackDetailContent } from './PackDetailContent'
import type { CapabilityPackDetail } from '@shared/types/capability-pack'

const BASE_DETAIL: CapabilityPackDetail = {
  origin: 'user',
  installedVersions: ['1.1.0', '1.0.0'],
  readme: '# 说明\n这是长文正文',
  manifest: {
    pack_format_version: 1,
    id: 'demo-pack',
    name: '演示包',
    author: '某作者',
    version: '1.1.0',
    description: '一句话简介',
    changelog: '1.1.0：修了东西',
    cards: [
      { type: 'persona', id: 'p1', name: '声音甲', path: 'cards/p1.md', keywords: ['冷静', '克制'] },
      { type: 'craft', id: 'c1', path: 'cards/c1.md', triggers: ['转场'], beat_types: [], technique_tags: ['转场设计'], emotion_tags: [], exclusions: [], priority: 3 },
      { type: 'structure', id: 's1', path: 'cards/s1.md', dimension: 'D1', stage: 'stage-1', one_line: '章尾留钩子' },
    ],
  },
}

function html(el: ReactElement): string {
  return renderToStaticMarkup(el)
}

describe('PackDetailContent', () => {
  test('渲染包头/简介/卡清单元数据/changelog/README', () => {
    const markup = html(
      <PackDetailContent detail={BASE_DETAIL} selectedVersion="1.1.0" onSelectVersion={() => {}} />,
    )
    expect(markup).toContain('演示包')
    expect(markup).toContain('某作者')
    expect(markup).toContain('一句话简介')
    expect(markup).toContain('声音甲')
    expect(markup).toContain('章尾留钩子')
    expect(markup).toContain('1.1.0：修了东西')
    expect(markup).toContain('这是长文正文')
  })

  test('多版本渲染版本切换；单版本不渲染', () => {
    const multi = html(<PackDetailContent detail={BASE_DETAIL} selectedVersion="1.1.0" onSelectVersion={() => {}} />)
    expect(multi).toContain('data-pack-version-switch')
    const single = html(
      <PackDetailContent
        detail={{ ...BASE_DETAIL, installedVersions: ['1.1.0'] }}
        selectedVersion="1.1.0"
        onSelectVersion={() => {}}
      />,
    )
    expect(single).not.toContain('data-pack-version-switch')
  })

  test('官方包展示「随引擎更新」，无 README 不渲染正文区，卡正文永不出现', () => {
    const official = html(
      <PackDetailContent
        detail={{ ...BASE_DETAIL, origin: 'official', installedVersions: ['1.1.0'], readme: undefined }}
        selectedVersion="1.1.0"
        onSelectVersion={() => {}}
      />,
    )
    expect(official).toContain('随引擎更新')
    expect(official).not.toContain('data-pack-readme')
    // 官方包卡清单降维：只露类别与数量，不逐卡展示选卡元数据（具体规则不外露）
    expect(official).toContain('data-pack-card-summary')
    expect(official).not.toContain('章尾留钩子')
    expect(official).not.toContain('data-pack-card=')
  })

  test('导入包（origin=user 且未传 localSource）标「署名未验证」；官方包不标', () => {
    const imported = html(
      <PackDetailContent detail={BASE_DETAIL} selectedVersion="1.1.0" onSelectVersion={() => {}} />,
    )
    expect(imported).toContain('data-pack-unverified-author')
    expect(imported).toContain('署名未验证')

    const official = html(
      <PackDetailContent
        detail={{ ...BASE_DETAIL, origin: 'official' }}
        selectedVersion="1.1.0"
        onSelectVersion={() => {}}
      />,
    )
    expect(official).not.toContain('data-pack-unverified-author')
  })

  test('传 localSource（本机产物）不标「署名未验证」', () => {
    const markup = html(
      <PackDetailContent
        detail={{ ...BASE_DETAIL, localSource: 'created' }}
        selectedVersion="1.1.0"
        onSelectVersion={() => {}}
        localSource="created"
      />,
    )
    expect(markup).not.toContain('data-pack-unverified-author')
  })

  test('传 localCards 渲染卡内容折叠区；不传则不渲染', () => {
    const withLocal = html(
      <PackDetailContent
        detail={{ ...BASE_DETAIL, localSource: 'created' }}
        selectedVersion="1.1.0"
        onSelectVersion={() => {}}
        localSource="created"
        localCards={[{ fileName: 'cards/p1.md', body: '# 声音甲正文\n这是卡片正文内容' }]}
      />,
    )
    expect(withLocal).toContain('data-pack-local-content')
    expect(withLocal).toContain('cards/p1.md')
    expect(withLocal).toContain('这是卡片正文内容')
    // created 来源不标「仅本机使用」
    expect(withLocal).not.toContain('data-pack-local-external-pill')

    const withoutLocal = html(
      <PackDetailContent detail={BASE_DETAIL} selectedVersion="1.1.0" onSelectVersion={() => {}} />,
    )
    expect(withoutLocal).not.toContain('data-pack-local-content')
  })

  test('learned-external 卡内容区顶部标「仅本机使用 · 不可分享」', () => {
    const markup = html(
      <PackDetailContent
        detail={{ ...BASE_DETAIL, localSource: 'learned-external' }}
        selectedVersion="1.1.0"
        onSelectVersion={() => {}}
        localSource="learned-external"
        localCards={[{ fileName: 'cards/p1.md', body: '正文' }]}
      />,
    )
    expect(markup).toContain('data-pack-local-external-pill')
    expect(markup).toContain('仅本机使用 · 不可分享')
  })
})
