import { describe, expect, it } from 'bun:test'
import { createMemoryWorkerRuntime } from './memory-worker-runtime.ts'

describe('createMemoryWorkerRuntime', () => {
  it('tool-call 走 runTool 并回 tool-result', async () => {
    const runtime = createMemoryWorkerRuntime({
      runTool: async (name, args) => ({ text: JSON.stringify({ name, args }), isError: false }),
    })
    const outbound = await runtime.handleMessage({ type: 'tool-call', id: 7, tool: 'novel_query', args: { query: 'x' } })
    expect(outbound).toEqual({ type: 'tool-result', id: 7, text: JSON.stringify({ name: 'novel_query', args: { query: 'x' } }), isError: false })
  })

  it('runTool reject 转 tool-failure（不抛出）', async () => {
    const runtime = createMemoryWorkerRuntime({
      runTool: async () => {
        throw new Error('boom')
      },
    })
    const outbound = await runtime.handleMessage({ type: 'tool-call', id: 1, tool: 'novel_query', args: {} })
    expect(outbound).toEqual({ type: 'tool-failure', id: 1, error: 'boom' })
  })

  it('形状不合法的消息返回 null 忽略', async () => {
    const runtime = createMemoryWorkerRuntime({ runTool: async () => ({ text: '', isError: false }) })
    expect(await runtime.handleMessage(null)).toBeNull()
    expect(await runtime.handleMessage({ type: 'other' })).toBeNull()
    expect(await runtime.handleMessage({ type: 'tool-call', id: 'x', tool: 'a', args: {} })).toBeNull()
    expect(await runtime.handleMessage({ type: 'tool-call', id: 1, tool: 2, args: {} })).toBeNull()
  })
})
