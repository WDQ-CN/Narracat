import { describe, expect, test } from 'bun:test'
import { readStrictMarkdownDocumentReadiness } from './document-readiness'

const characterTemplate = [
  '# 角色名',
  '',
  '## 基本信息',
  '- 全名:',
  '- 年龄:',
  '',
  '### 语言指纹',
  '（比口头禅更完整的语言画像。包括：句式偏好（长句/短句/反问/祈使）、常用语气词、禁忌话题、情绪激动时的表现变化。目标：遮住名字也能认出是谁在说话。）',
  '',
  '### 核心矛盾',
  '（角色内心最根本的冲突。如"渴望自由但恐惧孤独"。）',
  '',
  '## 背景故事',
  '（200-500字）',
  '',
  '## 关系',
  '- 与 XX 的关系:',
  '',
].join('\n')

const premiseTemplate = [
  '# 核心前提',
  '',
  '## 一句话概要',
  '（用一句话概括整个故事）',
  '',
  '## 核心冲突',
  '（故事的核心矛盾是什么）',
].join('\n')

const relationshipsTemplate = [
  '# 角色关系图谱',
  '',
  '## 核心关系',
  '',
  '| 角色 A | 关系 | 角色 B | 备注 |',
  '|---|---|---|---|',
  '',
  '## 阵营/势力',
  '',
  '（如有阵营划分在此描述）',
].join('\n')

const worldTemplate = [
  '# 设定名称',
  '',
  '## 概述',
  '（一段话概括）',
  '',
  '## 核心规则',
  '1. 规则一',
  '2. 规则二',
  '',
  '## 详细描述',
  '（分段展开）',
].join('\n')

describe('readStrictMarkdownDocumentReadiness', () => {
  test('blank content is blank', () => {
    expect(readStrictMarkdownDocumentReadiness('')).toBe('blank')
    expect(readStrictMarkdownDocumentReadiness('   \n  \n')).toBe('blank')
  })

  test('unfilled templates are detected as template', () => {
    expect(readStrictMarkdownDocumentReadiness(characterTemplate)).toBe('template')
    expect(readStrictMarkdownDocumentReadiness(premiseTemplate)).toBe('template')
    expect(readStrictMarkdownDocumentReadiness(relationshipsTemplate)).toBe('template')
    expect(readStrictMarkdownDocumentReadiness(worldTemplate)).toBe('template')
  })

  test('filled character档案 with prose content is filled', () => {
    const filled = [
      '# 李慎',
      '',
      '## 基本信息',
      '- 全名: 李慎',
      '',
      '### 语言指纹',
      '句式偏好短句，情绪激动时会突然改用敬语。',
      '',
      '### 核心矛盾',
      '渴望被认可，却又抗拒一切评价。',
    ].join('\n')

    expect(readStrictMarkdownDocumentReadiness(filled)).toBe('filled')
  })

  test('does not misclassify filled content that mentions template guidance words', () => {
    // 回归：作者在正文里自然写到「句式偏好 / 核心矛盾 / 200-500字」不应被当成模板
    const filled = '# 角色\n\n## 背景故事\n这一段约 200-500字，描写他的句式偏好与核心矛盾。\n'
    expect(readStrictMarkdownDocumentReadiness(filled)).toBe('filled')
  })

  test('filled relationships table data row is filled', () => {
    const filled = [
      '# 角色关系图谱',
      '',
      '## 核心关系',
      '',
      '| 角色 A | 关系 | 角色 B | 备注 |',
      '|---|---|---|---|',
      '| 李慎 | 师徒 | 沈括 | 亦师亦友 |',
    ].join('\n')

    expect(readStrictMarkdownDocumentReadiness(filled)).toBe('filled')
  })

  test('filled world setting with real rules is filled', () => {
    const filled = '# 灵脉\n\n## 核心规则\n1. 灵脉枯竭即修为倒退\n\n## 详细描述\n灵脉贯穿九州。\n'
    expect(readStrictMarkdownDocumentReadiness(filled)).toBe('filled')
  })
})
