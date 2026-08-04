import { describe, expect, test } from 'bun:test'
import { stripEvidenceSections, extractNonEvidenceText } from './pack-card-sections'

const BODY = `[runtime]
机制名：留白收尾
注解：情绪顶点前一拍停笔。

[evidence]
他推门进来，雪没说话，刀先说了。
第二段摘录。
`

describe('pack-card-sections', () => {
  test('stripEvidenceSections 保留标记、清空内容', () => {
    const out = stripEvidenceSections(BODY)
    expect(out).toContain('[evidence]')
    expect(out).not.toContain('刀先说了')
    expect(out).toContain('机制名：留白收尾')
  })
  test('多个 evidence 段全部清空', () => {
    const multi = `${BODY}\n[runtime]\n又一段\n\n[evidence]\n第二摘录区内容\n`
    const out = stripEvidenceSections(multi)
    expect(out).not.toContain('第二摘录区内容')
    expect(out).toContain('又一段')
  })
  test('extractNonEvidenceText 连标记一起移除', () => {
    const out = extractNonEvidenceText(BODY)
    expect(out).not.toContain('[evidence]')
    expect(out).not.toContain('刀先说了')
    expect(out).toContain('留白收尾')
  })
  test('无 evidence 段时原样通过', () => {
    expect(stripEvidenceSections('纯正文')).toBe('纯正文')
    expect(extractNonEvidenceText('纯正文')).toBe('纯正文')
  })
})
