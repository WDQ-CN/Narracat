import { describe, expect, test } from 'bun:test'
import { diffManuscriptRevision } from './manuscript-revision-diff.ts'

describe('diffManuscriptRevision', () => {
  test('输出 revision 到当前正文的上下文、删除与新增行号', () => {
    expect(diffManuscriptRevision('第一行\n旧第二行\n第三行', '第一行\n新第二行\n第三行')).toEqual({
      lines: [
        { type: 'context', text: '第一行', oldLine: 1, newLine: 1 },
        { type: 'removed', text: '旧第二行', oldLine: 2 },
        { type: 'added', text: '新第二行', newLine: 2 },
        { type: 'context', text: '第三行', oldLine: 3, newLine: 3 },
      ],
      addedLines: 1,
      removedLines: 1,
      simplified: false,
    })
  })

  test('CRLF 与 LF 等价，空正文不产生假行', () => {
    expect(diffManuscriptRevision('正文\r\n第二行', '正文\n第二行').lines.every((line) => line.type === 'context')).toBe(
      true,
    )
    expect(diffManuscriptRevision('', '')).toEqual({
      lines: [],
      addedLines: 0,
      removedLines: 0,
      simplified: false,
    })
  })

  test('超长正文使用有界首尾降级，不建立无界 LCS 矩阵', () => {
    const before = Array.from({ length: 801 }, (_, index) => `旧 ${index}`).join('\n')
    const after = before.replace('旧 400', '新 400')
    const diff = diffManuscriptRevision(before, after)
    expect(diff.simplified).toBe(true)
    expect(diff.addedLines).toBe(1)
    expect(diff.removedLines).toBe(1)
  })
})
