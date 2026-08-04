#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const progressPath = join(repoRoot, 'docs', 'agents', 'progress.md')
const wantedSections = ['Now', 'Next', 'Blockers']

function runGit(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trimEnd()
  } catch {
    return ''
  }
}

export function parseProgressSections(markdown) {
  const sections = Object.fromEntries(wantedSections.map((section) => [section, []]))
  let currentSection = ''

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      currentSection = wantedSections.includes(heading[1]) ? heading[1] : ''
      continue
    }

    if (!currentSection) continue

    const bullet = line.match(/^-\s+(.+?)\s*$/)
    if (bullet) sections[currentSection].push(bullet[1])
  }

  return sections
}

function formatList(items, emptyText = '无') {
  if (items.length === 0) return `- ${emptyText}`
  return items.map((item) => `- ${item}`).join('\n')
}

export function formatOpsStatus({ branchLine, changes, latestCommit, sections }) {
  const branch = branchLine.replace(/^##\s*/, '') || 'unknown'
  const changedFiles = changes.length === 0 ? ['clean'] : changes

  return [
    '# OPS Status',
    '',
    '## Branch',
    branch,
    '',
    '## Changed Files',
    formatList(changedFiles),
    '',
    '## Latest Commit',
    latestCommit || 'unknown',
    '',
    '## Now',
    formatList(sections.Now ?? []),
    '',
    '## Next',
    formatList(sections.Next ?? []),
    '',
    '## Blockers',
    formatList(sections.Blockers ?? []),
  ].join('\n')
}

export function collectOpsStatus() {
  const statusLines = runGit(['status', '--short', '--branch']).split('\n').filter(Boolean)
  const branchLine = statusLines[0] ?? ''
  const changes = statusLines.slice(1)
  const latestCommit = runGit(['log', '-1', '--oneline'])
  const progress = existsSync(progressPath) ? readFileSync(progressPath, 'utf8') : ''

  return {
    branchLine,
    changes,
    latestCommit,
    sections: parseProgressSections(progress),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(formatOpsStatus(collectOpsStatus()))
}
