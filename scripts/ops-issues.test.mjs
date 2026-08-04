import { describe, expect, test } from 'bun:test'

import { formatIssues, groupIssuesByStatus } from './ops-issues.mjs'

const issues = [
  {
    number: 12,
    title: 'P1: Lock NarraCat plugin version',
    url: 'https://github.com/org/repo/issues/12',
    labels: [{ name: 'ready-for-agent' }, { name: 'priority:p1' }, { name: 'mode:afk' }],
  },
  {
    number: 13,
    title: 'P2: Golden Path HITL checkpoint',
    url: 'https://github.com/org/repo/issues/13',
    labels: [{ name: 'needs-info' }, { name: 'priority:p2' }, { name: 'mode:hitl' }],
  },
]

describe('ops issues', () => {
  test('groups issues by OPS status labels', () => {
    expect(groupIssuesByStatus(issues)).toEqual({
      'ready-for-agent': [issues[0]],
      'needs-info': [issues[1]],
      'needs-triage': [],
      'ready-for-human': [],
      blocked: [],
      other: [],
    })
  })

  test('formats a compact issue report', () => {
    const report = formatIssues(issues)

    expect(report).toContain('# OPS Issues')
    expect(report).toContain('ready-for-agent')
    expect(report).toContain('#12')
    expect(report).toContain('P1: Lock NarraCat plugin version')
    expect(report).toContain('needs-info')
    expect(report).toContain('#13')
  })
})
