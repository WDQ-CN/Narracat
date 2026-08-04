import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveMemoryEngineEntries } from './memory-core-entries.ts'

function makeAgentCore(manifest: unknown, withDist = true): string {
  const root = mkdtempSync(join(tmpdir(), 'narracat-entries-'))
  writeFileSync(join(root, 'narracat.manifest.json'), JSON.stringify(manifest))
  if (withDist) {
    mkdirSync(join(root, 'mcp-server', 'dist'), { recursive: true })
    writeFileSync(join(root, 'mcp-server', 'dist', 'core.js'), '')
    writeFileSync(join(root, 'mcp-server', 'dist', 'tools.js'), '')
  }
  return root
}

const manifest = { mcpServer: { entry: 'mcp-server/dist/index.js', coreEntry: 'mcp-server/dist/core.js', toolsEntry: 'mcp-server/dist/tools.js' } }

describe('resolveMemoryEngineEntries', () => {
  it('解析为绝对路径', () => {
    const root = makeAgentCore(manifest)
    const entries = resolveMemoryEngineEntries(root)
    expect(entries.coreEntry).toBe(join(root, 'mcp-server', 'dist', 'core.js'))
    expect(entries.toolsEntry).toBe(join(root, 'mcp-server', 'dist', 'tools.js'))
  })
  it('manifest 缺字段 → throw（fail-loud）', () => {
    const root = makeAgentCore({ mcpServer: { entry: 'x' } })
    expect(() => resolveMemoryEngineEntries(root)).toThrow(/coreEntry/)
  })
  it('入口文件不存在 → throw', () => {
    const root = makeAgentCore(manifest, false)
    expect(() => resolveMemoryEngineEntries(root)).toThrow(/core\.js/)
  })
})
