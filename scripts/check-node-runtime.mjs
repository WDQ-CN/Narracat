#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

export const REQUIRED_NODE_RANGE = '^22.12.0'

function parseNodeVersion(version) {
  const match = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function atLeast(version, required) {
  if (version.major !== required.major) return version.major > required.major
  if (version.minor !== required.minor) return version.minor > required.minor
  return version.patch >= required.patch
}

export function isSupportedNodeVersion(version = process.version) {
  const parsed = parseNodeVersion(version)
  if (!parsed) return false

  if (parsed.major === 22) return atLeast(parsed, { major: 22, minor: 12, patch: 0 })
  return false
}

export function formatUnsupportedNodeMessage(version = process.version) {
  return [
    `当前 Node.js 版本是 ${version}，不满足 NarraCat-app 开发环境要求。`,
    `需要 Node.js ${REQUIRED_NODE_RANGE}。Vite / electron-vite / rolldown 在 Node 18 下会缺少 node:util.styleText，NarraCat MCP native runtime 当前不支持 Node 26。`,
    '如果使用 nvm，可以运行：nvm install 22 && nvm use 22',
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!isSupportedNodeVersion(process.version)) {
    process.stderr.write(`${formatUnsupportedNodeMessage(process.version)}\n`)
    process.exit(1)
  }
}
