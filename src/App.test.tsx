import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'

describe('App shell', () => {
  test('mounts the result notification open bridge inside the router', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

    expect(source).toContain('ResultNotificationOpenBridge')
    expect(source).toContain('<ResultNotificationOpenBridge />')
    expect(source).toContain('<WorkLocationStartupGate>')
  })

  test('lazy-loads route bodies while keeping app-level providers eager', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

    expect(source).toContain("import { lazy, Suspense } from 'react'")
    expect(source).toContain("lazy(() => import('./routes/library.tsx')")
    expect(source).toContain("lazy(() => import('./routes/workbench.tsx')")
    expect(source).toContain("lazy(() => import('./routes/settings.tsx')")
    expect(source).not.toContain("import { LibraryRoute } from './routes/library.tsx'")
    expect(source).not.toContain("import { WorkbenchRoute } from './routes/workbench.tsx'")
    expect(source).not.toContain("import { SettingsRoute } from './routes/settings.tsx'")
    expect(source).toContain('<Suspense fallback={<BrandLoading />}>')
    expect(source.indexOf('<ResultNotificationOpenBridge />')).toBeGreaterThan(source.indexOf('</Suspense>'))
    expect(
      source.indexOf('<Toaster position="bottom-right" richColors closeButton theme={effectiveTheme} />'),
    ).toBeGreaterThan(source.indexOf('</Suspense>'))
  })
})
