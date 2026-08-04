#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

export const CLIENT_BUILD_VERSION_PREFIX = '0.1'

export function formatClientBuildVersion(commitCount) {
  const count = Number(commitCount)
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Invalid git commit count for client build version: ${commitCount}`)
  }

  return `${CLIENT_BUILD_VERSION_PREFIX}.${count}`
}

export function readGitCommitCount(root = repoRoot, { execFile = execFileSync } = {}) {
  const args = ['rev-list', '--count', 'HEAD']
  let value

  try {
    value = execFile('git', args, { cwd: root, encoding: 'utf8' })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    value = execFile('/usr/bin/git', args, { cwd: root, encoding: 'utf8' })
  }

  value = String(value).trim()
  return Number(value)
}

export function resolveClientBuildVersion({ root = repoRoot, readCommitCount = readGitCommitCount } = {}) {
  return formatClientBuildVersion(readCommitCount(root))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${resolveClientBuildVersion({ root: process.cwd() })}\n`)
}
