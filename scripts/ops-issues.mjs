#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const statusLabels = ['ready-for-agent', 'needs-info', 'needs-triage', 'ready-for-human', 'blocked']

function labelNames(issue) {
  return (issue.labels ?? []).map((label) => label.name).filter(Boolean)
}

function primaryStatus(issue) {
  const labels = labelNames(issue)
  return statusLabels.find((status) => labels.includes(status)) ?? 'other'
}

function compactLabels(issue) {
  const labels = labelNames(issue).filter((label) => !statusLabels.includes(label))
  return labels.length > 0 ? ` [${labels.join(', ')}]` : ''
}

export function groupIssuesByStatus(issues) {
  const groups = Object.fromEntries([...statusLabels, 'other'].map((status) => [status, []]))

  for (const issue of issues) {
    groups[primaryStatus(issue)].push(issue)
  }

  return groups
}

export function formatIssues(issues) {
  const groups = groupIssuesByStatus(issues)
  const lines = ['# OPS Issues']

  for (const status of [...statusLabels, 'other']) {
    const items = groups[status]
    if (items.length === 0) continue

    lines.push('', `## ${status}`)
    for (const issue of items) {
      lines.push(`- #${issue.number} ${issue.title}${compactLabels(issue)} ${issue.url}`)
    }
  }

  if (lines.length === 1) lines.push('', 'No open issues.')

  return lines.join('\n')
}

export function collectIssues() {
  const output = execFileSync(
    'gh',
    ['issue', 'list', '--limit', '100', '--json', 'number,title,url,labels'],
    { encoding: 'utf8' },
  )

  return JSON.parse(output)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(formatIssues(collectIssues()))
}
