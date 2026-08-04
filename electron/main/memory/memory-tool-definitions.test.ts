import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadMemoryToolDefinitions } from './memory-tool-definitions.ts'

function makeAgentCore(toolsJs: string): string {
  const root = mkdtempSync(join(tmpdir(), 'narracat-tooldefs-'))
  mkdirSync(join(root, 'mcp-server', 'dist'), { recursive: true })
  writeFileSync(
    join(root, 'narracat.manifest.json'),
    JSON.stringify({ mcpServer: { entry: 'mcp-server/dist/index.js', coreEntry: 'mcp-server/dist/core.js', toolsEntry: 'mcp-server/dist/tools.js' } }),
  )
  writeFileSync(join(root, 'mcp-server', 'dist', 'core.js'), '')
  writeFileSync(join(root, 'mcp-server', 'dist', 'tools.js'), toolsJs)
  return root
}

describe('loadMemoryToolDefinitions', () => {
  it('从引擎 dist 读定义并缓存', async () => {
    const root = makeAgentCore(
      'export const TOOL_DEFINITIONS = [{ name: "novel_query", description: "d", inputSchema: { type: "object", properties: {} } }]',
    )
    const defs = await loadMemoryToolDefinitions(root)
    expect(defs).toHaveLength(1)
    expect(defs[0].name).toBe('novel_query')
    expect(await loadMemoryToolDefinitions(root)).toBe(defs)
  })
  it('空定义 fail-loud', async () => {
    const root = makeAgentCore('export const TOOL_DEFINITIONS = []')
    await expect(loadMemoryToolDefinitions(root)).rejects.toThrow(/TOOL_DEFINITIONS/)
  })
})
