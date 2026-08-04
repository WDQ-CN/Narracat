import { describe, expect, test } from 'bun:test'
// release-guard.ts 是纯逻辑、不依赖 electron，可直接静态 import（副作用层在 release-guard-runtime.ts）。
import { compareSemver, decideReleaseGate } from './release-guard.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-06-21T00:00:00Z')

describe('compareSemver', () => {
  test('比较主次补三段', () => {
    expect(compareSemver('0.1.300', '0.1.301')).toBe(-1)
    expect(compareSemver('0.1.301', '0.1.300')).toBe(1)
    expect(compareSemver('0.1.300', '0.1.300')).toBe(0)
    expect(compareSemver('0.2.0', '0.1.999')).toBe(1)
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1)
  })

  test('容忍 v 前缀与缺段', () => {
    expect(compareSemver('v0.1.5', '0.1.5')).toBe(0)
    expect(compareSemver('0.1', '0.1.0')).toBe(0)
    expect(compareSemver('0.2', '0.1.9')).toBe(1)
  })
})

describe('decideReleaseGate', () => {
  const base = { currentVersion: '0.1.300', nowMs: NOW, buildTimeMs: null }

  test('远程拉取失败 → fail-open（不拦）', () => {
    const v = decideReleaseGate({ ...base, remote: null })
    expect(v.blocked).toBe(false)
    expect(v.reason).toBeNull()
  })

  test('正常配置且未过期 → 放行', () => {
    const v = decideReleaseGate({
      ...base,
      remote: { minVersion: '0.1.200', deadline: '2026-12-31T00:00:00Z', kill: false },
    })
    expect(v.blocked).toBe(false)
  })

  test('急刹车 kill → 立即拦截，带文案', () => {
    const v = decideReleaseGate({ ...base, remote: { kill: true, notice: '紧急下线' } })
    expect(v.blocked).toBe(true)
    expect(v.reason).toBe('kill')
    expect(v.notice).toBe('紧急下线')
  })

  test('过了截止日 → expired', () => {
    const v = decideReleaseGate({ ...base, remote: { deadline: '2026-06-20T00:00:00Z' } })
    expect(v.blocked).toBe(true)
    expect(v.reason).toBe('expired')
  })

  test('未到截止日 → 放行', () => {
    const v = decideReleaseGate({ ...base, remote: { deadline: '2026-06-22T00:00:00Z' } })
    expect(v.blocked).toBe(false)
  })

  test('低于最低版本 → min-version', () => {
    const v = decideReleaseGate({ ...base, currentVersion: '0.1.100', remote: { minVersion: '0.1.300' } })
    expect(v.blocked).toBe(true)
    expect(v.reason).toBe('min-version')
  })

  test('等于最低版本 → 放行', () => {
    const v = decideReleaseGate({ ...base, currentVersion: '0.1.300', remote: { minVersion: '0.1.300' } })
    expect(v.blocked).toBe(false)
  })

  test('硬过期兜底：过了构建+90天即便远程放行也拦', () => {
    const buildTimeMs = NOW - 91 * DAY_MS
    const v = decideReleaseGate({ ...base, buildTimeMs, remote: { kill: false } })
    expect(v.blocked).toBe(true)
    expect(v.reason).toBe('hard-expired')
  })

  test('硬过期兜底：构建+90天内不拦', () => {
    const buildTimeMs = NOW - 30 * DAY_MS
    const v = decideReleaseGate({ ...base, buildTimeMs, remote: null })
    expect(v.blocked).toBe(false)
  })

  test('硬过期优先于远程拉取失败（断网也能兜底）', () => {
    const buildTimeMs = NOW - 100 * DAY_MS
    const v = decideReleaseGate({ ...base, buildTimeMs, remote: null })
    expect(v.blocked).toBe(true)
    expect(v.reason).toBe('hard-expired')
  })

  test('空 notice 回退到默认文案', () => {
    const v = decideReleaseGate({ ...base, remote: { kill: true } })
    expect(v.notice.length).toBeGreaterThan(0)
  })
})
