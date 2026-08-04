import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrandLockup } from './BrandLockup'
import { BrandMark } from './BrandMark'

describe('BrandMark', () => {
  test('renders the NarraCat mark as the original asset without a decorative container', () => {
    const html = renderToStaticMarkup(<BrandMark size="md" tone="brand" />)

    expect(html).toContain('data-brand-mark="true"')
    expect(html).toContain('data-size="md"')
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="NarraCat"')
    expect(html).toContain('narracat-mark.webp')
    expect(html).toContain('decoding="async"')
    expect(html).toContain('size-8')
    expect(html).not.toContain('bg-brand-soft')
    expect(html).not.toContain('border-brand-border')
    expect(html).not.toContain('bg-active')
    expect(html).not.toContain('rounded-row')
    expect(html).not.toContain('p-1.5')
    expect(html).not.toContain('dark:invert')
    expect(html).not.toContain('opacity-90')
  })

  test('can be decorative when paired with visible brand text', () => {
    const html = renderToStaticMarkup(<BrandMark decorative />)

    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('role="img"')
    expect(html).not.toContain('aria-label="NarraCat"')
  })
})

describe('BrandLockup', () => {
  test('combines a decorative mark with the product name', () => {
    const html = renderToStaticMarkup(<BrandLockup size="sm" />)

    expect(html).toContain('data-brand-lockup="true"')
    expect(html).toContain('NarraCat')
    expect(html).toContain('data-brand-mark="true"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('select-none')
  })
})
