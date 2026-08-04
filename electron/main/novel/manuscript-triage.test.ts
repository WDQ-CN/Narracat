import { describe, expect, test } from 'bun:test'
import {
  MANUSCRIPT_EDIT_CHAR_THRESHOLD,
  diffSequences,
  splitManuscriptParagraphs,
  splitManuscriptSentences,
  triageManuscriptEdit,
} from './manuscript-triage.ts'

const OLD_TEXT = ['林昭推开门，屋里一片漆黑。', '他摸索着点燃了油灯。', '窗外传来更夫的梆子声。'].join('\n\n')

describe('splitManuscriptParagraphs / splitManuscriptSentences', () => {
  test('按行切段，忽略空行与首尾空白', () => {
    expect(splitManuscriptParagraphs(OLD_TEXT)).toEqual([
      '林昭推开门，屋里一片漆黑。',
      '他摸索着点燃了油灯。',
      '窗外传来更夫的梆子声。',
    ])
  })

  test('按中文句读切句', () => {
    expect(splitManuscriptSentences('他愣住了。怎么会是她？！风停了……')).toEqual([
      '他愣住了。',
      '怎么会是她？！',
      '风停了……',
    ])
  })
})

describe('diffSequences · 段落级 LCS', () => {
  test('中段替换产出单个双侧 hunk', () => {
    const hunks = diffSequences(['a', 'b', 'c'], ['a', 'x', 'c'])
    expect(hunks).toEqual([{ removed: ['b'], added: ['x'] }])
  })

  test('纯插入产出 added-only hunk', () => {
    expect(diffSequences(['a', 'c'], ['a', 'b', 'c'])).toEqual([{ removed: [], added: ['b'] }])
  })

  test('完全相同无 hunk', () => {
    expect(diffSequences(['a', 'b'], ['a', 'b'])).toEqual([])
  })
})

describe('triageManuscriptEdit · 三信号', () => {
  test('错别字级小改（不含实体、无整段增删、低于阈值）→ silent', () => {
    const newText = OLD_TEXT.replace('摸索着', '摸黑')
    const result = triageManuscriptEdit({ oldText: OLD_TEXT, newText, entityNames: ['苏晚'] })
    expect(result.tier).toBe('silent')
    expect(result.reasons).toEqual([])
  })

  test('改动句含实体名 → impact + 理由带名字', () => {
    const newText = OLD_TEXT.replace('林昭推开门，屋里一片漆黑。', '林昭推开门，苏晚已经等在屋里。')
    const result = triageManuscriptEdit({ oldText: OLD_TEXT, newText, entityNames: ['林昭', '苏晚'] })
    expect(result.tier).toBe('impact')
    expect(result.reasons.some((r) => r.includes('林昭') || r.includes('苏晚'))).toBe(true)
  })

  test('整段删除 → impact（结构信号）', () => {
    const newText = OLD_TEXT.split('\n\n').slice(0, 2).join('\n\n')
    const result = triageManuscriptEdit({ oldText: OLD_TEXT, newText, entityNames: [] })
    expect(result.tier).toBe('impact')
    expect(result.reasons).toContain('有整段增删')
  })

  test('超阈值大改 → impact（体量信号）', () => {
    const bigParagraph = '闲笔'.repeat(MANUSCRIPT_EDIT_CHAR_THRESHOLD)
    // 段内改写（同 hunk 双侧都有），不触发结构信号，只触发体量
    const newText = OLD_TEXT.replace('他摸索着点燃了油灯。', `他${bigParagraph}点燃了油灯。`)
    const result = triageManuscriptEdit({ oldText: OLD_TEXT, newText, entityNames: [] })
    expect(result.tier).toBe('impact')
    expect(result.reasons.some((r) => r.includes(String(MANUSCRIPT_EDIT_CHAR_THRESHOLD)))).toBe(true)
  })

  test('未变句子不参与实体判定', () => {
    // 只改第 2 段；第 1 段虽含「林昭」但未改动，不应触发实体信号
    const newText = OLD_TEXT.replace('油灯', '蜡烛')
    const result = triageManuscriptEdit({ oldText: OLD_TEXT, newText, entityNames: ['林昭'] })
    expect(result.tier).toBe('silent')
  })
})
