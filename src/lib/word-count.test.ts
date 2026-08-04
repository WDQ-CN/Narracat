import { describe, expect, test } from 'bun:test'
import { countBodyChars } from './word-count'

describe('countBodyChars 纯文字口径', () => {
  test('只数文字，不含标点', () => {
    // 10 个文字 + 4 个标点（，。，！）→ 10
    expect(countBodyChars('你好，世界。今天，天气真好！')).toBe(10)
  })

  test('剔除所有空白（含全角空格与换行）', () => {
    // 第一行(3) 第二行(3) 末尾(2) = 8
    expect(countBodyChars('第一行\n第二行　末尾 ')).toBe(8)
  })

  test('保留中英文与数字，剔除符号', () => {
    // 雨夜=2 + abc=3 + 2024=4 → 9；#、空格、～、！全部不算
    expect(countBodyChars('# 雨夜 abc～2024！')).toBe(9)
  })

  test('纯标点 / 空字符串计 0', () => {
    expect(countBodyChars('，。！？……——')).toBe(0)
    expect(countBodyChars('')).toBe(0)
  })
})
