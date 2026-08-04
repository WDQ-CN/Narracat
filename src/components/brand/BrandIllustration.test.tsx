import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrandIllustration } from './BrandIllustration'

describe('BrandIllustration', () => {
  test('renders purpose-based decorative illustrations by default', () => {
    const html = renderToStaticMarkup(<BrandIllustration purpose="empty-library" size="lg" />)

    expect(html).toContain('data-brand-illustration="empty-library"')
    expect(html).toContain('data-size="lg"')
    expect(html).toContain('reading-book-pile.webp')
    expect(html).toContain('alt=""')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
    expect(html).toContain('size-36')
  })

  test('allows explicit accessible alt text when an illustration carries unique meaning', () => {
    const html = renderToStaticMarkup(
      <BrandIllustration purpose="checkpoint" alt="未完成任务检查点" />,
    )

    expect(html).toContain('alt="未完成任务检查点"')
    expect(html).not.toContain('aria-hidden="true"')
  })
})
