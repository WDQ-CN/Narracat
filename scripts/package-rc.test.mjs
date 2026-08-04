import { describe, expect, test } from 'bun:test'

import { createPackageRcSteps } from './package-rc.mjs'

describe('RC package script', () => {
  test('builds the macOS arm64 RC with the derived client build version', () => {
    const steps = createPackageRcSteps({ clientVersion: '0.1.42' })

    expect(steps.map((step) => step.label)).toEqual([
      'check node runtime',
      'verify NarraCat Agent Core',
      'prepare NarraCat Agent Core',
      'stage NarraCat Agent Core (whitelist)',
      'ensure Electron-ABI native modules',
      'prepare embedding model',
      'probe staged Agent Core runtime',
      'build Electron bundles',
      'package macOS arm64 DMG',
      'audit packaged app boundary',
    ])
    expect(steps[1].args).toContain('--check-version')
    expect(steps[1].args).toContain('--source')
    expect(steps[1].args.some((arg) => arg.endsWith('/agent-core/narracat'))).toBe(true)
    expect(steps[3].args.some((arg) => arg.endsWith('/scripts/stage-narracat-agent-core.mjs'))).toBe(true)
    expect(steps[4].args.some((arg) => arg.endsWith('/scripts/ensure-electron-native.mjs'))).toBe(true)
    expect(steps[5].args.some((arg) => arg.endsWith('/scripts/prepare-embedding-model.mjs'))).toBe(true)
    expect(steps[6].args.some((arg) => arg.endsWith('/scripts/probe-staged-agent-core-runtime.mjs'))).toBe(true)
    expect(steps[8].args).toContain('--mac')
    expect(steps[8].args).toContain('dmg')
    expect(steps[8].args).toContain('--arm64')
    expect(steps[8].args).toContain('--config.extraMetadata.version=0.1.42')
    expect(steps[9].args.some((arg) => arg.endsWith('/scripts/audit-packaged-app-boundary.mjs'))).toBe(true)
  })
})
