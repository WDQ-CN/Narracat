import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import {
  auditAsarEntries,
  auditPackagedResourceEntries,
  classifyAsarEntry,
  classifyPackagedResourceEntry,
  resolvePackagedAppPath,
  resolvePackagedAsarPath,
} from './audit-packaged-app-boundary.mjs'

describe('packaged app.asar boundary audit', () => {
  test('allows only runtime top-level entries', () => {
    const report = auditAsarEntries([
      '/package.json',
      '/out/main/index.js',
      '/out/preload/index.cjs',
      '/out/renderer/index.html',
      '/node_modules/keytar/package.json',
      '/node_modules/@anthropic-ai/claude-agent-sdk/cli.js',
      '/node_modules/hono/dist/tsconfig.build.tsbuildinfo',
    ])

    expect(report).toEqual({
      ok: true,
      entryCount: 7,
      violations: [],
    })
  })

  test('rejects development directories and repository metadata', () => {
    const report = auditAsarEntries([
      '/src/App.tsx',
      '/electron/main/index.ts',
      '/docs/adr/0001-app-orchestrates-narracat-plugin.md',
      '/agent-core/narracat/commands/write.md',
      '/corpus-factory-data/normalized/books.index.json',
      '/workers/release-guard/src/index.ts',
      '/.agents/skills/narracat-ops/SKILL.md',
      '/.env.example',
      '/tsconfig.web.tsbuildinfo',
    ])

    expect(report.ok).toBe(false)
    expect(report.violations.map((violation) => violation.path)).toEqual([
      'src/App.tsx',
      'electron/main/index.ts',
      'docs/adr/0001-app-orchestrates-narracat-plugin.md',
      'agent-core/narracat/commands/write.md',
      'corpus-factory-data/normalized/books.index.json',
      'workers/release-guard/src/index.ts',
      '.agents/skills/narracat-ops/SKILL.md',
      '.env.example',
      'tsconfig.web.tsbuildinfo',
    ])
  })

  test('rejects unexpected top-level files even when not explicitly blacklisted', () => {
    expect(classifyAsarEntry('/LICENSE')).toEqual({
      ok: false,
      path: 'LICENSE',
      reason: 'unexpected top-level app.asar entry: LICENSE',
    })
  })

  test('rejects source maps inside build output', () => {
    expect(classifyAsarEntry('/out/main/index.js.map')).toEqual({
      ok: false,
      path: 'out/main/index.js.map',
      reason: 'renderer/main source maps must not be packaged in app.asar',
    })
  })

  test('rejects staged Agent Core runtime development payloads', () => {
    const report = auditPackagedResourceEntries([
      'NarraCatAgentCore/mcp-server/node_modules/onnxruntime-web/package.json',
      'NarraCatAgentCore/mcp-server/dist/handlers/readers.d.ts',
      'NarraCatAgentCore/mcp-server/node_modules/zod/README.md',
      'NarraCatAgentCore/mcp-server/node_modules/@huggingface/transformers/dist/transformers.node.mjs.map',
      'NarraCatAgentCore/mcp-server/node_modules/@scope/pkg/examples/demo.js',
      'NarraCatAgentCore/mcp-server/src/index.ts',
      'NarraCatAgentCore/docs/adr/0026-staged-distribution-for-internal-test-and-beta.md',
      'fr.lproj',
    ])

    expect(report.ok).toBe(false)
    expect(report.violations.map((violation) => violation.path)).toEqual([
      'NarraCatAgentCore/mcp-server/node_modules/onnxruntime-web/package.json',
      'NarraCatAgentCore/mcp-server/dist/handlers/readers.d.ts',
      'NarraCatAgentCore/mcp-server/node_modules/zod/README.md',
      'NarraCatAgentCore/mcp-server/node_modules/@huggingface/transformers/dist/transformers.node.mjs.map',
      'NarraCatAgentCore/mcp-server/node_modules/@scope/pkg/examples/demo.js',
      'NarraCatAgentCore/mcp-server/src/index.ts',
      'NarraCatAgentCore/docs/adr/0026-staged-distribution-for-internal-test-and-beta.md',
      'fr.lproj',
    ])
  })

  test('allows staged Agent Core runtime files and selected Electron locales', () => {
    const report = auditPackagedResourceEntries([
      'NarraCatAgentCore/.claude-plugin/plugin.json',
      'NarraCatAgentCore/commands/write.md',
      'NarraCatAgentCore/skills/novel-style-reference/references/corpus/index.json',
      'NarraCatAgentCore/docs/contracts/world-guided.md',
      'NarraCatAgentCore/mcp-server/dist/index.js',
      'NarraCatAgentCore/mcp-server/node_modules/onnxruntime-node/package.json',
      'NarraCatAgentCore/mcp-server/node_modules/zod/LICENSE.md',
      'NarraCatAgentCore/mcp-server/node_modules/foo/src/runtime.js',
      'en.lproj',
      'zh_CN.lproj',
    ])

    expect(report).toEqual({
      ok: true,
      entryCount: 10,
      violations: [],
    })
  })

  test('classifies unexpected Electron locales explicitly', () => {
    expect(classifyPackagedResourceEntry('/zh_TW.lproj')).toEqual({
      ok: false,
      path: 'zh_TW.lproj',
      reason: 'unexpected Electron locale resource: zh_TW.lproj',
    })
  })

  test('resolves the default packaged app.asar path', () => {
    expect(resolvePackagedAppPath([], '/repo')).toBe(join('/repo', 'dist', 'mac-arm64', 'NarraCat.app'))
    expect(resolvePackagedAsarPath([], '/repo')).toBe(
      join('/repo', 'dist', 'mac-arm64', 'NarraCat.app', 'Contents', 'Resources', 'app.asar'),
    )
    expect(resolvePackagedAsarPath(['--app', 'dist/custom/NarraCat.app'], '/repo')).toBe(
      join('/repo', 'dist', 'custom', 'NarraCat.app', 'Contents', 'Resources', 'app.asar'),
    )
    expect(resolvePackagedAsarPath(['--asar=dist/app.asar'], '/repo')).toBe(join('/repo', 'dist', 'app.asar'))
  })
})
