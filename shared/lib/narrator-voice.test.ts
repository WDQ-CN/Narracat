import { describe, expect, test } from 'bun:test'
import { extractNarratorVoiceSection, parseNarratorVoiceSummary } from './narrator-voice'

const masterOutline = [
  '# 星辰大海 — 全书大纲',
  '',
  '## 主题',
  '选择代价。',
  '',
  '## 叙述者腔调（required，双路产出）',
  '- **archetype**: 猛文热血',
  '- **dimensions**:',
  '  - pacing: 急',
  '  - ornamentation: mid',
  '  - digression: 谨慎',
  '  - address: 限知',
  '  - tone: 冷硬但有爆发力',
  '  - style_keywords: [压迫感, 爽点放写]',
  '- **reference_inspiration**: [无参考作品，按题材推演]',
  '- **reference_examples**（1-3 段去文本化范例块）:',
  '  1. source_excerpt: 机制描述',
  '     mechanism_note: 章末释放。',
  '',
  '## 主要叙事弧线',
  '### 主线',
].join('\n')

describe('narrator voice parsing', () => {
  test('extracts the narrator voice section from master outline markdown', () => {
    const section = extractNarratorVoiceSection(masterOutline)

    expect(section).toContain('## 叙述者腔调')
    expect(section).toContain('猛文热血')
    expect(section).not.toContain('## 主要叙事弧线')
  })

  test('parses display fields from the narrator voice section', () => {
    expect(parseNarratorVoiceSummary(masterOutline)).toMatchObject({
      archetype: '猛文热血',
      pacing: '急',
      ornamentation: 'mid',
      digression: '谨慎',
      address: '限知',
      tone: '冷硬但有爆发力',
      styleKeywords: '压迫感, 爽点放写',
      referenceInspiration: '无参考作品，按题材推演',
    })
  })

  test('captures the reference_examples block with source excerpt and mechanism note', () => {
    expect(parseNarratorVoiceSummary(masterOutline)?.referenceExamples).toEqual([
      { sourceExcerpt: '机制描述', mechanismNote: '章末释放。' },
    ])
  })

  test('captures multiple reference examples in order', () => {
    const section = [
      '## 叙述者腔调（required，双路产出）',
      '- **archetype**: 悬疑冷叙',
      '- **reference_examples**（1-3 段去文本化范例块）:',
      '  1. source_excerpt: 短句堆压',
      '     mechanism_note: 制造窒息感。',
      '  2. source_excerpt: 冷处理对白',
      '     mechanism_note: 留白给读者。',
      '  3. source_excerpt: 信息延迟',
      '     mechanism_note: 章末才揭。',
      '',
      '## 主要叙事弧线',
    ].join('\n')

    expect(parseNarratorVoiceSummary(section)?.referenceExamples).toEqual([
      { sourceExcerpt: '短句堆压', mechanismNote: '制造窒息感。' },
      { sourceExcerpt: '冷处理对白', mechanismNote: '留白给读者。' },
      { sourceExcerpt: '信息延迟', mechanismNote: '章末才揭。' },
    ])
  })

  test('keeps a reference example whose mechanism note is missing', () => {
    const section = [
      '## 叙述者腔调',
      '- **reference_examples**:',
      '  1. source_excerpt: 只有摘录',
    ].join('\n')

    expect(parseNarratorVoiceSummary(section)?.referenceExamples).toEqual([{ sourceExcerpt: '只有摘录' }])
  })

  test('omits referenceExamples when the section has no such block', () => {
    const section = ['## 叙述者腔调', '- **archetype**: 言情沉浸'].join('\n')

    expect(parseNarratorVoiceSummary(section)?.referenceExamples).toBeUndefined()
  })
})
