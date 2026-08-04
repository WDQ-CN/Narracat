import { describe, expect, test } from 'bun:test'
import { buildSyncChapterMemoryPrompt } from './manuscript-impact-evaluation'

describe('buildSyncChapterMemoryPrompt', () => {
  test('带章号与分诊理由，声明先报告后确认', () => {
    const prompt = buildSyncChapterMemoryPrompt({ chapter: 13, reasons: ['改动涉及「林昭」', '有整段增删'] })
    expect(prompt).toContain('第 13 章')
    expect(prompt).toContain('改动涉及「林昭」')
    expect(prompt).toContain('确认')
  })

  test('无理由时也能生成完整 prompt', () => {
    const prompt = buildSyncChapterMemoryPrompt({ chapter: 5, reasons: [] })
    expect(prompt).toContain('第 5 章')
  })
})
