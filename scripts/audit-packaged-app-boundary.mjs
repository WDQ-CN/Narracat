#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listPackage } from '@electron/asar'
import {
  FORBIDDEN_RELATIVE_PATHS,
  hasPrunedMcpNodeModuleDirectory,
  shouldPruneMcpDistFile,
  shouldPruneMcpNodeModuleFile,
} from './stage-narracat-agent-core.mjs'

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(scriptDir, '..')

export const ALLOWED_ASAR_TOP_LEVEL = new Set(['out', 'node_modules', 'package.json'])
export const ALLOWED_ELECTRON_LOCALES = new Set(['en.lproj', 'zh_CN.lproj'])

export const FORBIDDEN_ASAR_PATHS = [
  '.agents',
  '.claude',
  '.env.example',
  '.nvmrc',
  'AGENTS.md',
  'CLAUDE.md',
  'CONTEXT.md',
  'README.md',
  'agent-core',
  'build',
  'components.json',
  'corpus-factory-data',
  'dist',
  'docs',
  'electron',
  'electron.vite.config.ts',
  'poc',
  'resources',
  'scripts',
  'src',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.node.tsbuildinfo',
  'tsconfig.web.json',
  'tsconfig.web.tsbuildinfo',
  'workers',
]

// 仅在 staged Agent Core 资源树才需额外拦截的 MCP 开发型路径（不属于通用研发痕迹黑名单）。
const ADDITIONAL_FORBIDDEN_MCP_DEV_PATHS = [
  'mcp-server/package-lock.json',
  'mcp-server/src',
  'mcp-server/node_modules/.bin',
  'mcp-server/node_modules/typescript',
]

// 打包后审计的禁入清单 = stage 暂存阶段的研发痕迹黑名单（FORBIDDEN_RELATIVE_PATHS 为 SSOT，
// 避免两份手抄列表漂移）＋ MCP 开发型路径。stage 加新痕迹，审计自动同步拦截。
export const FORBIDDEN_AGENT_CORE_RESOURCE_PATHS = [
  ...FORBIDDEN_RELATIVE_PATHS,
  ...ADDITIONAL_FORBIDDEN_MCP_DEV_PATHS,
]

function readOption(args, name) {
  const equalsPrefix = `${name}=`
  const inline = args.find((arg) => arg.startsWith(equalsPrefix))
  if (inline) return inline.slice(equalsPrefix.length)

  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function resolveFromRoot(root, path) {
  return path.startsWith('/') ? path : resolve(root, path)
}

export function resolvePackagedAppPath(args = process.argv.slice(2), root = repoRoot) {
  const appPath = readOption(args, '--app') ?? join('dist', 'mac-arm64', 'NarraCat.app')
  return resolveFromRoot(root, appPath)
}

export function resolvePackagedAsarPath(args = process.argv.slice(2), root = repoRoot) {
  const explicitAsarPath = readOption(args, '--asar')
  if (explicitAsarPath) return resolveFromRoot(root, explicitAsarPath)

  return join(resolvePackagedAppPath(args, root), 'Contents', 'Resources', 'app.asar')
}

export function normalizeAsarEntry(entry) {
  return entry
    .replace(/^(pack|unpack)\s*:\s*/, '')
    .replace(/^\/+/, '')
    .trim()
}

function hasForbiddenPathPrefix(entry, prefix) {
  return entry === prefix || entry.startsWith(`${prefix}/`)
}

export function classifyAsarEntry(entry) {
  const normalized = normalizeAsarEntry(entry)
  if (!normalized) return { ok: true, path: normalized }

  if (!normalized.startsWith('node_modules/') && normalized.endsWith('.tsbuildinfo')) {
    return { ok: false, path: normalized, reason: 'TypeScript incremental build cache must not be packaged' }
  }

  if (normalized.startsWith('out/') && normalized.endsWith('.map')) {
    return { ok: false, path: normalized, reason: 'renderer/main source maps must not be packaged in app.asar' }
  }

  const forbidden = FORBIDDEN_ASAR_PATHS.find((prefix) => hasForbiddenPathPrefix(normalized, prefix))
  if (forbidden) {
    return { ok: false, path: normalized, reason: `forbidden development artifact: ${forbidden}` }
  }

  const topLevel = normalized.split('/')[0]
  if (!ALLOWED_ASAR_TOP_LEVEL.has(topLevel)) {
    return { ok: false, path: normalized, reason: `unexpected top-level app.asar entry: ${topLevel}` }
  }

  return { ok: true, path: normalized }
}

export function classifyPackagedResourceEntry(entry) {
  const normalized = normalizeAsarEntry(entry)
  if (!normalized) return { ok: true, path: normalized }

  const topLevel = normalized.split('/')[0]
  if (topLevel.endsWith('.lproj') && !ALLOWED_ELECTRON_LOCALES.has(topLevel)) {
    return { ok: false, path: normalized, reason: `unexpected Electron locale resource: ${topLevel}` }
  }

  if (!normalized.startsWith('NarraCatAgentCore/')) return { ok: true, path: normalized }

  const agentCorePath = normalized.slice('NarraCatAgentCore/'.length)
  const forbidden = FORBIDDEN_AGENT_CORE_RESOURCE_PATHS.find((prefix) =>
    hasForbiddenPathPrefix(agentCorePath, prefix),
  )
  if (forbidden) {
    return { ok: false, path: normalized, reason: `forbidden Agent Core development artifact: ${forbidden}` }
  }

  if (hasForbiddenPathPrefix(agentCorePath, 'mcp-server/node_modules/onnxruntime-web')) {
    return { ok: false, path: normalized, reason: 'onnxruntime-web must not be packaged for Node-only MCP runtime' }
  }

  const distPrefix = 'mcp-server/dist/'
  if (agentCorePath.startsWith(distPrefix) && shouldPruneMcpDistFile(agentCorePath.slice(distPrefix.length))) {
    return { ok: false, path: normalized, reason: 'MCP dist TypeScript declaration must not be packaged' }
  }

  const nodeModulesPrefix = 'mcp-server/node_modules/'
  if (agentCorePath.startsWith(nodeModulesPrefix)) {
    const nodeModulePath = agentCorePath.slice(nodeModulesPrefix.length)
    if (hasPrunedMcpNodeModuleDirectory(nodeModulePath)) {
      return { ok: false, path: normalized, reason: 'MCP dependency development directory must not be packaged' }
    }
    if (shouldPruneMcpNodeModuleFile(nodeModulePath)) {
      return { ok: false, path: normalized, reason: 'MCP dependency development file must not be packaged' }
    }
  }

  return { ok: true, path: normalized }
}

export function auditAsarEntries(entries) {
  const violations = []
  for (const entry of entries) {
    const result = classifyAsarEntry(entry)
    if (!result.ok) violations.push(result)
  }

  return {
    ok: violations.length === 0,
    entryCount: entries.length,
    violations,
  }
}

export function auditPackagedResourceEntries(entries) {
  const violations = []
  for (const entry of entries) {
    const result = classifyPackagedResourceEntry(entry)
    if (!result.ok) violations.push(result)
  }

  return {
    ok: violations.length === 0,
    entryCount: entries.length,
    violations,
  }
}

export function auditPackagedAsar(asarPath) {
  if (!existsSync(asarPath)) {
    throw new Error(`找不到 packaged app.asar：${asarPath}`)
  }

  return auditAsarEntries(listPackage(asarPath, { isPack: false }))
}

function listDirectoryEntries(root) {
  if (!existsSync(root)) return []
  const entries = []

  function walk(absPath, relPath) {
    for (const dirent of readdirSync(absPath, { withFileTypes: true })) {
      const childRelPath = relPath ? `${relPath}/${dirent.name}` : dirent.name
      entries.push(childRelPath)
      if (dirent.isDirectory()) walk(join(absPath, dirent.name), childRelPath)
    }
  }

  walk(root, '')
  return entries
}

export function auditPackagedExtraResources(appPath) {
  const resourcesPath = join(appPath, 'Contents', 'Resources')
  if (!existsSync(resourcesPath)) {
    throw new Error(`找不到 packaged Resources 目录：${resourcesPath}`)
  }

  return auditPackagedResourceEntries(listDirectoryEntries(resourcesPath))
}

export function auditPackagedApp(appPath) {
  const asarReport = auditPackagedAsar(join(appPath, 'Contents', 'Resources', 'app.asar'))
  const resourcesReport = auditPackagedExtraResources(appPath)
  const violations = [
    ...asarReport.violations.map((violation) => ({ ...violation, scope: 'app.asar' })),
    ...resourcesReport.violations.map((violation) => ({ ...violation, scope: 'extraResources' })),
  ]

  return {
    ok: violations.length === 0,
    asarEntryCount: asarReport.entryCount,
    resourceEntryCount: resourcesReport.entryCount,
    violations,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const explicitAsarPath = readOption(process.argv.slice(2), '--asar')

  try {
    const report = explicitAsarPath
      ? auditPackagedAsar(resolvePackagedAsarPath())
      : auditPackagedApp(resolvePackagedAppPath())
    if (!report.ok) {
      console.error('Packaged app boundary audit failed')
      for (const violation of report.violations.slice(0, 80)) {
        const scope = violation.scope ? `[${violation.scope}] ` : ''
        console.error(`- ${scope}${violation.path}: ${violation.reason}`)
      }
      if (report.violations.length > 80) {
        console.error(`... ${report.violations.length - 80} more violations omitted`)
      }
      process.exitCode = 1
    } else {
      if (explicitAsarPath) {
        console.log(`Packaged app.asar boundary OK: ${report.entryCount} entries`)
      } else {
        console.log(
          `Packaged app boundary OK: ${report.asarEntryCount} asar entries, ${report.resourceEntryCount} resource entries`,
        )
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
