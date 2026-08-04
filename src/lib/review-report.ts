import { getReviewSeverityLabel, getReviewVerdictLabel } from '@shared/lib/schema-field-labels'

export interface ReviewIssue {
  severity: string
  where: string
  what: string
  fix_hint: string
}

export interface ReviewReportData {
  chapter?: number
  verdict?: string
  issues?: ReviewIssue[]
  /** 引擎机械补充：成稿可见正文字数（剥 chapter_metadata 后计） */
  word_count?: number
  /** 引擎机械补充：字数缺口（低于目标 70% 时在场；机械度量，不属审校存疑项） */
  word_count_warning?: { actual: number; target: number; ratio: number }
}

/**
 * 审校报告数据契约（ADR-0018）→ 人读 markdown，由 App 从 DTO 渲染。
 * verdict / severity 经 #243 ID→人话映射成中文徽标，机器字段不裸露用户通道。
 */
export function renderReviewReportMarkdown(data: ReviewReportData): string {
  const lines: string[] = [`## 审修结论：${getReviewVerdictLabel(data.verdict ?? '')}`, '']

  const issues = data.issues ?? []
  const blockers = issues.filter((issue) => issue.severity === 'blocker')
  const notes = issues.filter((issue) => issue.severity === 'note')

  if (blockers.length > 0) {
    lines.push(`### ${getReviewSeverityLabel('blocker')}（${blockers.length}）`, '')
    for (const issue of blockers) {
      lines.push(`- 【${issue.where}】${issue.what}`)
      lines.push(`  - 修复建议：${issue.fix_hint}`)
    }
    lines.push('')
  }

  if (notes.length > 0) {
    lines.push(`### ${getReviewSeverityLabel('note')}（${notes.length}）`, '')
    for (const issue of notes) {
      lines.push(`- 【${issue.where}】${issue.what}`)
      lines.push(`  - 建议：${issue.fix_hint}`)
    }
    lines.push('')
  }

  if (issues.length === 0) {
    lines.push('本章未发现客观错误。')
  }

  // 字数提醒是引擎的机械度量，与审校员的「存疑」判断分开呈现
  const warning = data.word_count_warning
  if (warning && warning.target > 0) {
    lines.push('', '### 字数提醒', '')
    lines.push(
      `- 成稿 ${warning.actual} 字，为目标 ${warning.target} 字的 ${Math.round(warning.ratio * 100)}%（缺口 ${warning.target - warning.actual} 字）`,
    )
    lines.push('  - 机械度量，不构成客观错误，不影响审修结论')
  }

  return lines.join('\n').trimEnd()
}
