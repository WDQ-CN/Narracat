import { describe, expect, test } from 'bun:test'
import { isSameProjectPath, normalizeProjectPathForCompare } from './project-path'

describe('normalizeProjectPathForCompare', () => {
  test('去掉末尾分隔符', () => {
    expect(normalizeProjectPathForCompare('/Users/a/novel/')).toBe('/Users/a/novel')
  })

  test('统一反斜杠为正斜杠', () => {
    expect(normalizeProjectPathForCompare('C:\\Users\\a\\novel')).toBe('C:/Users/a/novel')
  })

  test('压缩多重分隔符', () => {
    expect(normalizeProjectPathForCompare('/Users//a///novel')).toBe('/Users/a/novel')
  })

  test('去首尾空白', () => {
    expect(normalizeProjectPathForCompare('  /Users/a/novel  ')).toBe('/Users/a/novel')
  })

  test('空值归一为空串', () => {
    expect(normalizeProjectPathForCompare(undefined)).toBe('')
    expect(normalizeProjectPathForCompare(null)).toBe('')
    expect(normalizeProjectPathForCompare('')).toBe('')
  })
})

describe('isSameProjectPath', () => {
  test('尾分隔符差异视为同一项目', () => {
    expect(isSameProjectPath('/Users/a/novel', '/Users/a/novel/')).toBe(true)
  })

  test('分隔符与多重斜杠差异视为同一项目', () => {
    expect(isSameProjectPath('/Users/a/novel', '/Users//a/novel')).toBe(true)
  })

  test('不同项目返回 false', () => {
    expect(isSameProjectPath('/Users/a/novel', '/Users/a/other')).toBe(false)
  })

  test('任一方为空一律返回 false（未打开项目不刷新）', () => {
    expect(isSameProjectPath(undefined, '/Users/a/novel')).toBe(false)
    expect(isSameProjectPath('/Users/a/novel', undefined)).toBe(false)
    expect(isSameProjectPath('', '')).toBe(false)
  })
})
