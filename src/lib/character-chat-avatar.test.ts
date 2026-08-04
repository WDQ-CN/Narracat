import { describe, expect, test } from 'bun:test'

import { avatarInitial, formatChatTime } from './character-chat-avatar'

describe('avatarInitial', () => {
  test('取名字首个码点', () => {
    expect(avatarInitial('林衍')).toBe('林')
    expect(avatarInitial('  苏暮 ')).toBe('苏')
  })

  test('空名兜底「角」', () => {
    expect(avatarInitial('')).toBe('角')
    expect(avatarInitial('   ')).toBe('角')
  })
})

describe('formatChatTime', () => {
  test('ISO 时间渲染为 24h HH:mm', () => {
    // 用本机时区无关的断言：构造一个含具体分钟的本地时刻再格式化。
    const local = new Date(2026, 5, 15, 9, 5, 0)
    expect(formatChatTime(local.toISOString())).toBe('09:05')
  })

  test('午后用 24h 不带 AM/PM', () => {
    const local = new Date(2026, 5, 15, 21, 30, 0)
    expect(formatChatTime(local.toISOString())).toBe('21:30')
  })

  test('空值或无法解析时返回空串（不渲染占位噪声）', () => {
    expect(formatChatTime(null)).toBe('')
    expect(formatChatTime(undefined)).toBe('')
    expect(formatChatTime('')).toBe('')
    expect(formatChatTime('bad-date')).toBe('')
  })
})
