import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'

const globals = readFileSync('src/styles/globals.css', 'utf8')
const input = readFileSync('src/components/ui/input.tsx', 'utf8')

describe('interaction design tokens', () => {
  test('uses the governed text selection token instead of active gray', () => {
    expect(globals).toContain('--color-text-selection: var(--text-selection);')
    expect(globals).toContain('--text-selection: oklch(0.86 0.06 250 / 64%);')
    expect(globals).toContain('--text-selection: oklch(0.64 0.12 250 / 46%);')
    expect(globals).toContain('background: var(--text-selection);')
    expect(globals).not.toContain('background: var(--active);')
  })

  test('keeps form selection styling on the shared text selection token', () => {
    expect(input).toContain('selection:bg-text-selection')
    expect(input).not.toContain('selection:bg-active')
  })

  test('defines a stronger near-field shadow for text selection handoff controls', () => {
    expect(globals).toContain(
      '--shadow-selection-toolbar: 0 10px 22px oklch(0 0 0 / 14%), 0 2px 8px oklch(0 0 0 / 9%);',
    )
    expect(globals).toContain(
      '--shadow-selection-toolbar: 0 14px 30px oklch(0 0 0 / 42%), 0 2px 10px oklch(0 0 0 / 24%);',
    )
  })
})
