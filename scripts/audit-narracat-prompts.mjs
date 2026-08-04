#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const defaultDestination = join(repoRoot, 'agent-core', 'narracat')
const versionLockPath = join(repoRoot, 'agent-core', 'narracat-agent-core.lock.json')
const promptRoots = ['commands', 'agents', 'skills', 'templates']

function readOption(name, argv = process.argv) {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  return argv[index + 1]
}

function readFlag(name, argv = process.argv) {
  return argv.includes(name)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function readManifestVersion(pluginPath) {
  try {
    const manifest = readJson(join(pluginPath, 'narracat.manifest.json'))
    return typeof manifest.version === 'string' ? manifest.version : 'missing'
  } catch {
    return 'missing'
  }
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex')
}

function readPromptFiles(pluginPath, rootName) {
  const root = join(pluginPath, rootName)
  const files = new Map()
  if (!existsSync(root)) return files

  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }

      if (!entry.isFile()) continue

      const relativePath = relative(pluginPath, path).split(sep).join('/')
      files.set(relativePath, hash(readFileSync(path)))
    }
  }

  visit(root)
  return files
}

function hasManifest(pluginPath) {
  try {
    return statSync(join(pluginPath, 'narracat.manifest.json')).isFile()
  } catch {
    return false
  }
}

function resolveSource(explicitSource) {
  const candidates = [
    explicitSource,
	    process.env.NARRACAT_AGENT_CORE_UPSTREAM_PATH,
    resolve(repoRoot, '..', 'NarraCat'),
    resolve(repoRoot, '..', 'ai-plugin', 'NarraCat'),
  ]
    .filter((candidate) => typeof candidate === 'string' && candidate.trim().length > 0)
    .map((candidate) => resolve(candidate))

  for (const candidate of candidates) {
    if (hasManifest(candidate)) return candidate
  }

  throw new Error(
    [
      '无法定位 NarraCat upstream prompt 源目录。',
	      '请设置 NARRACAT_AGENT_CORE_UPSTREAM_PATH，或通过 --source 指定锁定 upstream commit 的 NarraCat checkout。',
      `已检查：${candidates.join(', ') || '无候选路径'}`,
    ].join('\n'),
  )
}

export function auditNarraCatPromptDrift({
  destination = defaultDestination,
  source,
  lock = readJson(versionLockPath),
} = {}) {
  const resolvedSource = resolve(source)
  const resolvedDestination = resolve(destination)
  const rootReports = []

  for (const rootName of promptRoots) {
    const sourceFiles = readPromptFiles(resolvedSource, rootName)
    const destinationFiles = readPromptFiles(resolvedDestination, rootName)
    const allPaths = [...new Set([...sourceFiles.keys(), ...destinationFiles.keys()])].sort()
    const changed = []
    const missing = []
    const added = []

    for (const path of allPaths) {
      const sourceHash = sourceFiles.get(path)
      const destinationHash = destinationFiles.get(path)
      if (!sourceHash && destinationHash) {
        added.push(path)
      } else if (sourceHash && !destinationHash) {
        missing.push(path)
      } else if (sourceHash !== destinationHash) {
        changed.push(path)
      }
    }

    rootReports.push({
      root: rootName,
      changed,
      missing,
      added,
      identical: changed.length === 0 && missing.length === 0 && added.length === 0,
    })
  }

  const driftCount = rootReports.reduce(
    (count, report) => count + report.changed.length + report.missing.length + report.added.length,
    0,
  )

  return {
    source: resolvedSource,
    destination: resolvedDestination,
    upstream: lock.upstream,
    sourceVersion: readManifestVersion(resolvedSource),
    destinationVersion: readManifestVersion(resolvedDestination),
    driftCount,
    roots: rootReports,
    runtimeWrapperNotes: [
      'App runtime wraps raw NarraCat commands with INTERACTIVE_COMMAND_GUARD, MEMORY_MCP_GUARD, and CHAPTER_ARTIFACT_PATH_GUARD.',
      'App runtime normalizes Task(...) agent names to narracat:* for Claude Code SDK plugin agent registration.',
      'write-next and recover-write add App-side extraInstruction around the raw /narracat:write prompt.',
    ],
  }
}

export function formatPromptDriftReport(report) {
  const lines = [
    '# NarraCat Prompt Drift Audit',
    '',
    `Upstream lock: ${report.upstream.repo}@${report.upstream.commit} (${report.upstream.manifestVersion})`,
    `Source: ${report.source} (${report.sourceVersion})`,
    `Destination: ${report.destination} (${report.destinationVersion})`,
    '',
    '## Resource Prompt Diffs',
  ]

  for (const root of report.roots) {
    lines.push('', `### ${root.root}`)
    if (root.identical) {
      lines.push('- identical')
      continue
    }
    for (const path of root.changed) lines.push(`- changed: ${path}`)
    for (const path of root.missing) lines.push(`- missing in destination: ${path}`)
    for (const path of root.added) lines.push(`- added in destination: ${path}`)
  }

  lines.push('', '## Runtime Wrapper Notes')
  for (const note of report.runtimeWrapperNotes) lines.push(`- ${note}`)

  return `${lines.join('\n')}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const source = resolveSource(readOption('--source'))
    const destination = resolve(readOption('--destination') ?? defaultDestination)
    const report = auditNarraCatPromptDrift({ source, destination })

    if (readFlag('--json')) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      process.stdout.write(formatPromptDriftReport(report))
    }

    if (readFlag('--fail-on-drift') && report.driftCount > 0) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
