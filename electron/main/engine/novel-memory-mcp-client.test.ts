import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { MemoryHost, MemoryToolCallOptions } from '../memory/memory-host.ts'
import {
  NOVEL_MEMORY_READONLY_TOOL_NAMES,
  createNovelCharacterStatusesMcpClient,
  createNovelMemoryReadonlyMcpClient,
} from './novel-memory-mcp-client.ts'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')

interface RecordedCall {
  projectPath: string
  tool: string
  args: Record<string, unknown>
  options?: MemoryToolCallOptions
}

function makeFakeHost(text = '{"ok":true}') {
  const calls: RecordedCall[] = []
  const host: MemoryHost = {
    async callTool(projectPath, tool, args, options) {
      calls.push({ projectPath, tool, args, options })
      return { text, isError: false }
    },
    shutdown() {},
  }
  return { host, calls }
}

describe('createNovelMemoryReadonlyMcpClient（host 通道）', () => {
  test('callTool 白名单内经 host 转发（chat-secret-filter 档），返回 text 原文', async () => {
    const { host, calls } = makeFakeHost('{"state":"在逃"}')
    const client = createNovelMemoryReadonlyMcpClient(
      { projectPath: '/novels/a', appRoot: REPO_ROOT },
      host,
    )
    const text = await client.callTool('novel_character_state', { name: '陆明河' })
    expect(text).toBe('{"state":"在逃"}')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      projectPath: '/novels/a',
      tool: 'novel_character_state',
      options: { profile: 'chat-secret-filter' },
    })
  })

  test('白名单外工具一律拒绝，不触达 host', async () => {
    const { host, calls } = makeFakeHost()
    const client = createNovelMemoryReadonlyMcpClient({ projectPath: '/novels/a', appRoot: REPO_ROOT }, host)
    await expect(client.callTool('novel_submit_premise', {})).rejects.toThrow('非只读工具')
    expect(calls).toHaveLength(0)
  })

  test('listReadonlyTools 从引擎工具定义本地过滤出恰好 4 个只读工具（零 RPC）', async () => {
    const { host, calls } = makeFakeHost()
    const client = createNovelMemoryReadonlyMcpClient({ projectPath: '/novels/a', appRoot: REPO_ROOT }, host)
    const tools = await client.listReadonlyTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([...NOVEL_MEMORY_READONLY_TOOL_NAMES].sort())
    for (const tool of tools) expect(tool.input_schema).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  test('close 幂等 no-op（worker 生命周期归 host 管）', async () => {
    const { host } = makeFakeHost()
    const client = createNovelMemoryReadonlyMcpClient({ projectPath: '/novels/a', appRoot: REPO_ROOT }, host)
    await client.close()
    await client.close()
  })
})

describe('createNovelCharacterStatusesMcpClient（host 通道）', () => {
  test('走默认档调 novel_character_statuses，返回 text 原文', async () => {
    const { host, calls } = makeFakeHost('{"ok":true,"statuses":{}}')
    const client = createNovelCharacterStatusesMcpClient({ projectPath: '/novels/b', appRoot: REPO_ROOT }, host)
    const text = await client.callTool({ character_uids: ['u1'] })
    expect(text).toBe('{"ok":true,"statuses":{}}')
    expect(calls).toHaveLength(1)
    expect(calls[0].tool).toBe('novel_character_statuses')
    expect(calls[0].options?.profile).toBeUndefined()
  })
})
