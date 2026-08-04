import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'

const globals = readFileSync('src/styles/globals.css', 'utf8')

describe('brand design tokens', () => {
  test('bundles MiSans as the governed desktop font face', () => {
    expect(globals).toContain('@font-face')
    expect(globals).toContain('font-family: "MiSans";')
    expect(globals).toContain('MiSansVF.woff2')
    expect(globals).toContain('font-weight: 150 700;')
    expect(globals).toContain('--font-sans: MiSans, "MiSans VF", "MiSans Latin", Inter')
  })

  test('exposes brand tokens as independent Tailwind color aliases', () => {
    expect(globals).toContain('--color-brand: var(--brand);')
    expect(globals).toContain('--color-brand-foreground: var(--brand-foreground);')
    expect(globals).toContain('--color-brand-soft: var(--brand-soft);')
    expect(globals).toContain('--color-brand-border: var(--brand-border);')
  })

  test('defines light and dark brand values without remapping semantic colors', () => {
    expect(globals).toContain('--brand: #04c853;')
    expect(globals).toContain('--brand-foreground: #03130a;')
    expect(globals).toContain('--brand-soft: color-mix(in oklch, var(--brand) 10%, transparent);')
    expect(globals).toContain('--brand-border: color-mix(in oklch, var(--brand) 24%, transparent);')
    expect(globals).toContain('--brand-soft: color-mix(in oklch, var(--brand) 12%, transparent);')
    expect(globals).toContain('--brand-border: color-mix(in oklch, var(--brand) 28%, transparent);')

    const semanticAssignments = globals.match(/--(primary|active|success|warning|info):[^;]+;/g) ?? []
    expect(semanticAssignments.length).toBeGreaterThan(0)
    for (const assignment of semanticAssignments) {
      expect(assignment).not.toContain('var(--brand)')
      expect(assignment).not.toContain('#04c853')
    }
  })

  test('defines the Agent profile enter animation as a real utility with reduced-motion fallback', () => {
    expect(globals).toContain('.animate-agent-profile-enter')
    expect(globals).toContain('animation: slide-up-fade 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;')
    expect(globals).toContain('@media (prefers-reduced-motion: reduce)')
    expect(globals).toContain('animation: none;')
  })
})
