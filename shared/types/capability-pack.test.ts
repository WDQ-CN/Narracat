import { describe, expect, test } from 'bun:test'
import { compareSemver, PACK_LICENSE_LABELS, SEMVER_RE, STRUCTURE_STAGE_LABELS } from './capability-pack'

describe('compareSemver', () => {
  test('1.0.0 < 1.1.0', () => {
    expect(compareSemver('1.0.0', '1.1.0')).toBeLessThan(0)
  })
  test('1.0.0-beta.1 < 1.0.0（预发布版本优先级低于正式版）', () => {
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
  })
  test('1.0.0-alpha < 1.0.0-beta', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
  })
  test('1.0.0-alpha.1 < 1.0.0-alpha.2', () => {
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.2')).toBeLessThan(0)
  })
  test('1.0.0-9 < 1.0.0-a（数字标识符恒低于字母数字标识符）', () => {
    expect(compareSemver('1.0.0-9', '1.0.0-a')).toBeLessThan(0)
  })
  test('相等版本 → 0', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
    expect(compareSemver('1.0.0-beta.1', '1.0.0-beta.1')).toBe(0)
  })
  test('1.10.0 > 1.9.0（数值比较非字典序）', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })
})

describe('SEMVER_RE', () => {
  test('合法 SemVer 通过', () => {
    expect(SEMVER_RE.test('1.0.0')).toBe(true)
    expect(SEMVER_RE.test('1.0.0-beta.1')).toBe(true)
    expect(SEMVER_RE.test('1.10.0')).toBe(true)
  })
  test('非法字符串拒绝', () => {
    expect(SEMVER_RE.test('banana')).toBe(false)
    expect(SEMVER_RE.test('1.0')).toBe(false)
    expect(SEMVER_RE.test('v1.0.0')).toBe(false)
  })
  test('build metadata 不支持（+ 在目录名不安全）', () => {
    expect(SEMVER_RE.test('1.0.0+build.1')).toBe(false)
  })
})

describe('PACK_LICENSE_LABELS', () => {
  test('三档授权文案逐字对应', () => {
    expect(PACK_LICENSE_LABELS['personal-only']).toBe('仅供个人使用')
    expect(PACK_LICENSE_LABELS['share-no-derivatives']).toBe('可自由分享·不可修改再发')
    expect(PACK_LICENSE_LABELS['free-use']).toBe('可自由使用和修改')
  })
})

describe('STRUCTURE_STAGE_LABELS', () => {
  test('三档结构阶段文案逐字对应', () => {
    expect(STRUCTURE_STAGE_LABELS['stage-opening']).toBe('开局设计')
    expect(STRUCTURE_STAGE_LABELS['stage-1']).toBe('全书布局')
    expect(STRUCTURE_STAGE_LABELS['stage-2']).toBe('逐章编排')
  })
})
