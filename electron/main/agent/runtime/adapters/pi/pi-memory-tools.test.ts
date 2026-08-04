import { describe, expect, it } from 'bun:test'
import { MEMORY_TOOL_PREFIX, createMemoryTools } from './pi-memory-tools.ts'
import type { MemoryToolDefinition } from '../../../../memory/memory-tool-definitions.ts'

const definitions: MemoryToolDefinition[] = [
  {
    name: 'novel_query',
    description: '检索小说记忆',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
]

describe('createMemoryTools', () => {
  it('剥前缀调 channel，结果原文回给模型', async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
    const [tool] = createMemoryTools({
      definitions,
      allowedNames: [`${MEMORY_TOOL_PREFIX}novel_query`],
      channel: async (toolName, args) => {
        calls.push({ tool: toolName, args })
        return { text: '{"hits":[]}', isError: false }
      },
    })
    expect(tool.name).toBe(`${MEMORY_TOOL_PREFIX}novel_query`)
    const result = await tool.execute('tc-1', { query: '主角' }, undefined as never)
    expect(calls).toEqual([{ tool: 'novel_query', args: { query: '主角' } }])
    expect(result.content).toEqual([{ type: 'text', text: '{"hits":[]}' }])
  })

  it('execute 第三参 AbortSignal 透传进 channel（门前项④：父 run abort 时在途 RPC 立即解除等待）', async () => {
    let seenSignal: AbortSignal | undefined
    const [tool] = createMemoryTools({
      definitions,
      allowedNames: [`${MEMORY_TOOL_PREFIX}novel_query`],
      channel: async (_toolName, _args, signal) => {
        seenSignal = signal
        return { text: '{}', isError: false }
      },
    })
    const abortController = new AbortController()
    await tool.execute('tc-1', { query: '主角' }, abortController.signal as never)
    expect(seenSignal).toBe(abortController.signal)
  })

  it('isError 信封 → throw（agent-loop 转 isError 工具结果）', async () => {
    const [tool] = createMemoryTools({
      definitions,
      allowedNames: [`${MEMORY_TOOL_PREFIX}novel_query`],
      channel: async () => ({ text: '{"status":"error"}', isError: true }),
    })
    await expect(tool.execute('tc-1', { query: 'x' }, undefined as never)).rejects.toThrow('{"status":"error"}')
  })

  it('白名单名在定义里缺失 → 构造期 throw（漂移 fail-loud）', () => {
    expect(() =>
      createMemoryTools({ definitions, allowedNames: [`${MEMORY_TOOL_PREFIX}novel_missing`], channel: async () => ({ text: '', isError: false }) }),
    ).toThrow(/novel_missing/)
  })
})
