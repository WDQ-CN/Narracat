#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveClientBuildVersion } from './client-build-version.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const binExt = process.platform === 'win32' ? '.cmd' : ''
const agentCorePath = join(repoRoot, 'agent-core', 'narracat')

function bin(name) {
  return join(repoRoot, 'node_modules', '.bin', `${name}${binExt}`)
}

export function createPackageRcSteps({ clientVersion = resolveClientBuildVersion({ root: repoRoot }) } = {}) {
  return [
    {
      label: 'check node runtime',
      command: process.execPath,
      args: [join(repoRoot, 'scripts', 'check-node-runtime.mjs')],
    },
    {
      label: 'verify NarraCat Agent Core',
      command: process.execPath,
      args: [join(repoRoot, 'scripts', 'prepare-narracat-agent-core.mjs'), '--check-version', '--source', agentCorePath],
    },
    {
      label: 'prepare NarraCat Agent Core',
      command: process.execPath,
      args: [join(repoRoot, 'scripts', 'prepare-narracat-agent-core.mjs'), '--if-missing', '--optional'],
    },
    {
      label: 'stage NarraCat Agent Core (whitelist)',
      command: process.execPath,
      args: [join(repoRoot, 'scripts', 'stage-narracat-agent-core.mjs')],
    },
    {
      label: 'ensure Electron-ABI native modules',
      command: process.execPath,
      args: [join(repoRoot, 'scripts', 'ensure-electron-native.mjs')],
    },
    {
      label: 'prepare embedding model',
      command: process.execPath,
      args: [join(repoRoot, 'scripts', 'prepare-embedding-model.mjs')],
    },
    {
      label: 'probe staged Agent Core runtime',
      command: process.execPath,
      args: [join(repoRoot, 'scripts', 'probe-staged-agent-core-runtime.mjs')],
    },
    {
      label: 'build Electron bundles',
      command: bin('electron-vite'),
      args: ['build'],
    },
    {
      label: 'package macOS arm64 DMG',
      command: bin('electron-builder'),
      args: ['--mac', 'dmg', '--arm64', `--config.extraMetadata.version=${clientVersion}`],
    },
    {
      label: 'audit packaged app boundary',
      command: process.execPath,
      args: [join(repoRoot, 'scripts', 'audit-packaged-app-boundary.mjs')],
    },
  ]
}

export function runPackageRc({ cwd = repoRoot, stdio = 'inherit' } = {}) {
  const clientVersion = resolveClientBuildVersion({ root: cwd })
  for (const step of createPackageRcSteps({ clientVersion })) {
    execFileSync(step.command, step.args, { cwd, stdio })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPackageRc()
}
