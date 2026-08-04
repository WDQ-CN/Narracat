import { describe, expect, test } from 'bun:test'
import {
  commandNeedsManuscriptDraftCheck,
  inferChapterNumber,
  resolveManuscriptDraftGate,
} from './manuscript-draft-gate'

const drafts = [
  { chapter: 2, updatedAt: '2026-07-23T00:00:00.000Z' },
  { chapter: 8, updatedAt: '2026-07-23T00:00:00.000Z' },
]

describe('manuscript draft gate', () => {
  test('同章 rewrite / review / sync-memory 硬拦截，别章放行', () => {
    for (const command of ['rewrite', 'review', 'sync-chapter-memory'] as const) {
      expect(resolveManuscriptDraftGate({ command, drafts, selectedChapter: 2 }).kind).toBe('block')
      expect(resolveManuscriptDraftGate({ command, drafts, selectedChapter: 3 })).toEqual({ kind: 'allow' })
    }
  })

  test('目标章不明确时不冒险消费有草稿的正文', () => {
    const gate = resolveManuscriptDraftGate({ command: 'review', drafts })
    expect(gate.kind).toBe('block')
    if (gate.kind === 'block') expect(gate.message).toContain('先明确目标章')
  })

  test('write-next 只软提醒并列出所有草稿章', () => {
    const gate = resolveManuscriptDraftGate({ command: 'write-next', drafts })
    expect(gate.kind).toBe('warn')
    if (gate.kind === 'warn') {
      expect(gate.message).toContain('第 2 章')
      expect(gate.message).toContain('第 8 章')
    }
  })

  test('普通对话和不消费正文的操作不受影响', () => {
    expect(resolveManuscriptDraftGate({ command: undefined, drafts })).toEqual({ kind: 'allow' })
    expect(resolveManuscriptDraftGate({ command: 'world', drafts })).toEqual({ kind: 'allow' })
    expect(commandNeedsManuscriptDraftCheck('world')).toBe(false)
  })

  test('从常见中文和命令文本识别目标章', () => {
    expect(inferChapterNumber('请审修第 12 章')).toBe(12)
    expect(inferChapterNumber('review ch-008')).toBe(8)
    expect(inferChapterNumber('看看这一章')).toBeUndefined()
  })
})
