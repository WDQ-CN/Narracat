import { describe, expect, test } from 'bun:test'

import type { AgentEvent } from '@shared/types/agent'
import type { AgentRuntimeAdapter } from '../agent/runtime/types.ts'
import { runSandboxSessionLoop } from './sandbox-session.ts'

/** 假 adapter：startRun 逐个 yield 索引，mapMessage 按脚本表返回该索引的 AgentEvent 批，
 * readSessionId 在脚本指定的索引上返回 id（模拟 SDK system:init / pi 首发合成会话消息）。 */
function fakeAdapter(script: AgentEvent[][], sessionIdAt?: { index: number; id: string }): AgentRuntimeAdapter {
  return {
    id: 'pi',
    createRunOptions: async () => ({}),
    createSandboxedRunOptions: async () => ({}),
    async *startRun() {
      for (let index = 0; index < script.length; index += 1) yield index
    },
    mapMessage: (message) => script[message as number] ?? [],
    readSessionId: (message) => (sessionIdAt && message === sessionIdAt.index ? sessionIdAt.id : undefined),
  }
}

const at = new Date().toISOString()
const delta = (text: string): AgentEvent => ({ type: 'message.delta', runId: 'r', messageId: 'm', text, createdAt: at })
const toolStarted = (): AgentEvent => ({
  type: 'tool.started',
  runId: 'r',
  toolCallId: 't-1',
  toolName: 'Write',
  phrase: '写入文件',
  createdAt: at,
})
const completed = (): AgentEvent => ({ type: 'run.completed', runId: 'r', createdAt: at })
const failed = (error: string, reason?: 'max-turns'): AgentEvent => ({
  type: 'run.failed',
  runId: 'r',
  error,
  ...(reason ? { reason } : {}),
  createdAt: at,
})

async function collect(script: AgentEvent[][], sessionIdAt?: { index: number; id: string }) {
  const texts: string[] = []
  const result = await runSandboxSessionLoop({
    adapter: fakeAdapter(script, sessionIdAt),
    prompt: 'p',
    options: {},
    onText: (text) => texts.push(text),
  })
  return { texts, result }
}

describe('runSandboxSessionLoop', () => {
  test('delta 缓冲，tool.started 处 flush 成整段（token 级 delta 不碎段）', async () => {
    const { texts, result } = await collect([
      [delta('我先'), delta('看看章节。')],
      [toolStarted()],
      [delta('看完了。'), completed()],
    ])
    expect(texts).toEqual(['我先看看章节。', '看完了。'])
    expect(result).toEqual({ outcome: 'success' })
  })

  test('run.completed → success 且带 readSessionId 捕获的 sessionId', async () => {
    const { result } = await collect([[completed()]], { index: 0, id: 'session-9' })
    expect(result).toEqual({ outcome: 'success', sessionId: 'session-9' })
  })

  test('run.failed reason=max-turns → max-turns（sessionId 保留可续）', async () => {
    const { result } = await collect([[failed('回合上限', 'max-turns')]], { index: 0, id: 'session-7' })
    expect(result).toEqual({ outcome: 'max-turns', sessionId: 'session-7' })
  })

  test('普通 run.failed → error 透传人话文案', async () => {
    const { result } = await collect([[failed('API Key 无效')]])
    expect(result).toEqual({ outcome: 'error', error: 'API Key 无效' })
  })

  test('流走完无终态 → error「没有正常收尾」', async () => {
    const { result } = await collect([[delta('半截')]])
    expect(result).toEqual({ outcome: 'error', error: '会话没有正常收尾，请重试。' })
  })

  test('终态前残余 delta 也 flush（末段总结不丢）', async () => {
    const { texts } = await collect([[delta('总结：三张卡已写好。')], [failed('回合上限', 'max-turns')]])
    expect(texts).toEqual(['总结：三张卡已写好。'])
  })
})
