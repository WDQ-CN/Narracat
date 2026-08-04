import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { hasNarraCatAgentCoreManifest, resolveNarraCatAgentCorePath, resolveNarraCatEngine } from './engine'
import { createNarraCatPluginFixture } from './test-plugin-fixture'

function manifestExistsAt(path: string): (candidate: string) => boolean {
  return (candidate) => candidate === join(path, 'narracat.manifest.json')
}

describe('NarraCat engine resolution', () => {
  test('uses explicit Agent Core path override when provided', () => {
    const engine = resolveNarraCatEngine({
      appRoot: '/app',
      envPath: '/custom/NarraCat',
      fileExists: () => false,
    })

    expect(engine).toEqual({
      agentCorePath: '/custom/NarraCat',
      source: 'env',
    })
  })

  test('prefers the packaged app Agent Core resource when its manifest exists', () => {
    const agentCorePath = '/Applications/NarraCat.app/Contents/Resources/NarraCatAgentCore'
    const engine = resolveNarraCatEngine({
      appRoot: '/Applications/NarraCat.app/Contents/Resources/app.asar',
      resourcesPath: '/Applications/NarraCat.app/Contents/Resources',
      envPath: '',
      fileExists: manifestExistsAt(agentCorePath),
    })

    expect(engine).toEqual({
      agentCorePath,
      source: 'packaged-resource',
    })
  })

  test('uses the internal Agent Core source before legacy sibling candidates', () => {
    const appRoot = '/workspace/narracat-decktop'
    const agentCorePath = join(appRoot, 'agent-core', 'narracat')
    const legacyPath = join(appRoot, '..', 'NarraCat')
    const engine = resolveNarraCatEngine({
      appRoot,
      envPath: '',
      fileExists: (candidate) =>
        candidate === join(agentCorePath, 'narracat.manifest.json') ||
        candidate === join(legacyPath, 'narracat.manifest.json'),
    })

    expect(engine).toEqual({
      agentCorePath,
      source: 'agent-core-source',
    })
  })

  test('keeps the internal Agent Core source path when only legacy sibling candidates exist', () => {
    const appRoot = '/workspace/narracat-decktop'
    const legacyPath = join(appRoot, '..', 'ai-plugin', 'NarraCat')

    const engine = resolveNarraCatEngine({
      appRoot,
      envPath: '',
      fileExists: manifestExistsAt(legacyPath),
    })

    expect(engine).toEqual({
      agentCorePath: join(appRoot, 'agent-core', 'narracat'),
      source: 'fallback',
    })
  })

  test('uses the internal Agent Core source before Electron binary resources in dev mode', () => {
    const appRoot = '/workspace/narracat-decktop'
    const resourcesPath = join(appRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Resources')
    const agentCorePath = join(appRoot, 'agent-core', 'narracat')
    const electronResourcePath = join(resourcesPath, 'NarraCatAgentCore')
    const engine = resolveNarraCatEngine({
      appRoot,
      resourcesPath,
      envPath: '',
      fileExists: (candidate) =>
        candidate === join(agentCorePath, 'narracat.manifest.json') ||
        candidate === join(electronResourcePath, 'narracat.manifest.json'),
    })

    expect(engine).toEqual({
      agentCorePath,
      source: 'agent-core-source',
    })
  })

  test('falls back to the internal Agent Core source path instead of Electron binary resources in dev mode', () => {
    const appRoot = '/workspace/narracat-decktop'
    const resourcesPath = join(appRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Resources')

    expect(resolveNarraCatAgentCorePath({ appRoot, resourcesPath, envPath: '', fileExists: () => false })).toBe(
      join(appRoot, 'agent-core', 'narracat'),
    )
  })

  test('falls back to the packaged Agent Core resource path so diagnostics point at the bundled contract', () => {
    const appRoot = '/Applications/NarraCat.app/Contents/Resources/app.asar'
    const resourcesPath = '/Applications/NarraCat.app/Contents/Resources'

    expect(resolveNarraCatAgentCorePath({ appRoot, resourcesPath, envPath: '', fileExists: () => false })).toBe(
      join(resourcesPath, 'NarraCatAgentCore'),
    )
  })

  test('detects a real plugin fixture manifest on disk', async () => {
    const root = await createNarraCatPluginFixture('narracat-engine-')

    expect(hasNarraCatAgentCoreManifest(root)).toBe(true)
    expect(hasNarraCatAgentCoreManifest(join(root, 'missing'))).toBe(false)
  })
})
