import { describe, expect, test } from 'bun:test'
import { renderReviewReportMarkdown } from './review-report'

describe('renderReviewReportMarkdown', () => {
  test('verdict 渲染为中文徽标，空 issues 提示无错', () => {
    const md = renderReviewReportMarkdown({ chapter: 2, verdict: 'pass', issues: [] })
    expect(md).toContain('审修结论：通过')
    expect(md).toContain('本章未发现客观错误')
    expect(md).not.toMatch(/\b(pass|fail)\b/i)
  })

  test('blocker/note 分区 + severity 中文，不裸露英文枚举', () => {
    const md = renderReviewReportMarkdown({
      chapter: 3,
      verdict: 'fail',
      issues: [
        { severity: 'blocker', where: '第3段', what: '时间线矛盾', fix_hint: '对齐前章' },
        { severity: 'note', where: '李远台词', what: '语气存疑', fix_hint: '可酌情' },
      ],
    })
    expect(md).toContain('审修结论：未通过')
    expect(md).toContain('硬伤（1）')
    expect(md).toContain('存疑（1）')
    expect(md).toContain('【第3段】时间线矛盾')
    expect(md).toContain('修复建议：对齐前章')
    expect(md).not.toMatch(/\b(blocker|note)\b/)
  })

  test('verdict 缺失降级不报错', () => {
    expect(typeof renderReviewReportMarkdown({})).toBe('string')
  })

  test('word_count_warning → 独立「字数提醒」区块，不混入存疑', () => {
    const md = renderReviewReportMarkdown({
      chapter: 2,
      verdict: 'pass',
      issues: [],
      word_count: 1903,
      word_count_warning: { actual: 1903, target: 3000, ratio: 1903 / 3000 },
    })
    expect(md).toContain('### 字数提醒')
    expect(md).toContain('成稿 1903 字，为目标 3000 字的 63%（缺口 1097 字）')
    expect(md).toContain('不影响审修结论')
    expect(md).not.toContain('存疑')
  })

  test('无 word_count_warning 时不渲染字数提醒区块', () => {
    const md = renderReviewReportMarkdown({ chapter: 2, verdict: 'pass', issues: [], word_count: 2900 })
    expect(md).not.toContain('字数提醒')
  })
})
