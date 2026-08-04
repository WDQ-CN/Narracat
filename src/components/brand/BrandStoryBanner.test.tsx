import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrandStoryBanner } from './BrandStoryBanner'

describe('BrandStoryBanner', () => {
  test('renders the governed About story banner asset', () => {
    const html = renderToStaticMarkup(<BrandStoryBanner />)

    expect(html).toContain('data-brand-story-banner="true"')
    expect(html).toContain('narracat-about-banner.webp')
    expect(html).toContain('alt="NarraCat 品牌故事横幅"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
  })
})
