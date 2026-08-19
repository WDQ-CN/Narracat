import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const WRITING_AGENT_DIRS = new Set(['narracat-chapter-writer', 'narracat-continuity-editor'])
const MEMORY_KEEPER_DIR = 'narracat-memory-keeper'

const ALLOWED_TYPES = new Set([
  'user',
  'user-preference',
  'stable-style',
  'project',
  'project-style',
  'review-pattern',
  'process-guard',
])
const TRANSIENT_TYPES = new Set(['feedback', 'chapter-transient', 'run-transient', 'draft', 'experiment'])

const CHAPTER_SCOPED_PATTERNS = [
  /\bch(?:apter)?\s*[-_]?\s*\d+\b/i,
  /第\s*\d+\s*章/u,
  /章号\s*[:：]?\s*\d+/u,
  /场景\s*\d+/u,
  /本章/u,
  /单章/u,
  /dogfood/i,
  /重跑/u,
  /旧草稿/u,
  /失败草稿/u,
]

function parseFrontmatter(source) {
  if (!source.startsWith('---\n')) return {}
  const end = source.indexOf('\n---', 4)
  if (end === -1) return {}

  const frontmatter = source.slice(4, end).trim()
  const result = {}
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    result[key] = rawValue.trim().replace(/^['"]|['"]$/g, '')
  }

  return result
}

function detectChapterScopedSignals(source, filePath) {
  const target = `${filePath}\n${source}`
  return CHAPTER_SCOPED_PATTERNS.flatMap((pattern) => {
    const match = target.match(pattern)
    return match ? [match[0]] : []
  })
}

function classifyMemoryEntry({ agentName, relativePath, source }) {
  const frontmatter = parseFrontmatter(source)
  const type = typeof frontmatter.type === 'string' ? frontmatter.type.trim() : ''
  const chapterScopedSignals = detectChapterScopedSignals(source, relativePath)

  if (agentName === MEMORY_KEEPER_DIR) {
    return {
      status: 'blocked',
      category: 'stale',
      reason: 'memory-keeper must not use .claude/agent-memory; NovelMemory MCP is its only persisted memory surface',
      type,
      chapterScopedSignals,
    }
  }

  if (!WRITING_AGENT_DIRS.has(agentName)) {
    return {
      status: 'blocked',
      category: 'stale',
      reason: 'agent is outside the writing-agent memory policy',
      type,
      chapterScopedSignals,
    }
  }

  if (ALLOWED_TYPES.has(type)) {
    return {
      status: 'allowed',
      category: type,
      reason:
        chapterScopedSignals.length > 0
          ? 'allowed type; chapter references are treated only as provenance, not chapter-specific instructions'
          : 'allowed stable memory type',
      type,
      chapterScopedSignals,
    }
  }

  if (TRANSIENT_TYPES.has(type) || chapterScopedSignals.length > 0) {
    return {
      status: 'blocked',
      category: 'chapter-transient',
      reason: type ? `transient memory type: ${type}` : 'chapter-scoped or run-scoped signals detected',
      type,
      chapterScopedSignals,
    }
  }

  return {
    status: 'blocked',
    category: 'stale',
    reason: 'unclassified legacy memory must be promoted before it can influence writing runs',
    type,
    chapterScopedSignals,
  }
}

async function listMarkdownFiles(root) {
  const entries = []
  if (!existsSync(root)) return entries

  async function walk(dir) {
    for (const name of await readdir(dir)) {
      const path = join(dir, name)
      const stats = await stat(path)
      if (stats.isDirectory()) {
        await walk(path)
        continue
      }
      if (stats.isFile() && name.toLowerCase().endsWith('.md')) entries.push(path)
    }
  }

  await walk(root)
  return entries.sort()
}

export async function auditAgentMemoryProject(projectRoot) {
  const normalizedProjectRoot = resolve(projectRoot)
  const memoryRoot = join(normalizedProjectRoot, '.claude', 'agent-memory')
  const files = await listMarkdownFiles(memoryRoot)
  const entries = []

  for (const filePath of files) {
    const relativeToMemory = relative(memoryRoot, filePath)
    const [agentName] = relativeToMemory.split(/[\\/]/)
    const source = await readFile(filePath, 'utf-8')
    const classification = classifyMemoryEntry({
      agentName,
      relativePath: relativeToMemory,
      source,
    })
    entries.push({
      agentName,
      // 统一正斜杠：path 是跨平台契约（测试与报告消费），Windows 的 relative() 返回反斜杠
      path: relativeToMemory.split('\\').join('/'),
      ...classification,
    })
  }

  return {
    projectRoot: normalizedProjectRoot,
    memoryRoot,
    entries,
    totals: {
      allowed: entries.filter((entry) => entry.status === 'allowed').length,
      blocked: entries.filter((entry) => entry.status === 'blocked').length,
      total: entries.length,
    },
  }
}

export function formatAgentMemoryAuditReport(report) {
  const allowedEntries = report.entries.filter((entry) => entry.status === 'allowed')
  const blockedEntries = report.entries.filter((entry) => entry.status === 'blocked')
  const lines = [
    '# Agent Memory Audit',
    '',
    `Project: ${report.projectRoot}`,
    `Memory root: ${report.memoryRoot}`,
    `Summary: ${report.totals.allowed} allowed, ${report.totals.blocked} blocked, ${report.totals.total} total`,
    '',
    '## Allowed memory sources',
  ]

  if (allowedEntries.length === 0) {
    lines.push('- None')
  } else {
    for (const entry of allowedEntries) {
      lines.push(`- ${entry.path} (${entry.category}) — ${entry.reason}`)
    }
  }

  lines.push('', '## Blocked or quarantined memory sources')
  if (blockedEntries.length === 0) {
    lines.push('- None')
  } else {
    for (const entry of blockedEntries) {
      const signals = entry.chapterScopedSignals.length > 0 ? `; signals: ${entry.chapterScopedSignals.join(', ')}` : ''
      lines.push(`- ${entry.path} (${entry.category}) — ${entry.reason}${signals}`)
    }
  }

  lines.push('', '## Policy')
  lines.push('- Allowed memory may be used only as stable preference, style, review-pattern, or process guidance.')
  lines.push('- Blocked memory must not influence future writing runs until manually promoted or removed.')
  lines.push('- Story facts remain in WritingContextPack, NovelMemory, and project files, not agent memory.')

  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2)
  const failOnBlocked = args.includes('--fail-on-blocked')
  const projectRoot = args.find((arg) => arg !== '--fail-on-blocked')
  if (!projectRoot) {
    console.error('Usage: node scripts/audit-agent-memory.mjs <novel-project-root> [--fail-on-blocked]')
    process.exitCode = 1
    return
  }

  const report = await auditAgentMemoryProject(projectRoot)
  process.stdout.write(formatAgentMemoryAuditReport(report))
  if (failOnBlocked && report.totals.blocked > 0) process.exitCode = 2
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
