import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'

describe('ResultNotificationOpenBridge', () => {
  test('keeps notification navigation independent from eager route imports', () => {
    const source = readFileSync(new URL('./ResultNotificationOpenBridge.tsx', import.meta.url), 'utf8')

    expect(source).toContain('useNavigate')
    expect(source).toContain('onOpenResultNotification')
    expect(source).toContain('openResultNotification')
    expect(source).not.toContain('WorkbenchRoute')
    expect(source).not.toContain("from '@/routes/")
  })
})
