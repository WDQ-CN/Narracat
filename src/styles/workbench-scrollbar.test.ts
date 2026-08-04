import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

describe('workbench native scrollbars', () => {
  test('matches the sidebar ScrollArea visual language globally', () => {
    const css = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf-8')

    expect(css).toContain('scrollbar-color: var(--border) transparent')
    expect(css).toContain('::-webkit-scrollbar')
    expect(css).toContain('background-clip: content-box')
    expect(css).toContain('::-webkit-scrollbar-thumb:hover')
    expect(css).toContain('var(--border-strong)')
  })
})
