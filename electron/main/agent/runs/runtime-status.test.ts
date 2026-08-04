import { describe, expect, test } from 'bun:test'
import {
  createDirectChatPrompt,
  createRuntimeStatusPrompt,
  DIRECT_CHAT_SYSTEM_PROMPT,
  isRuntimeStatusCommand,
} from './runtime-status'

describe('runtime status prompt', () => {
  test('routes command chips to runtime status but keeps freeform as direct chat', () => {
    expect(isRuntimeStatusCommand({ threadId: 'thread-1', command: 'write-next', prompt: '继续写15章' })).toBe(false)
    expect(isRuntimeStatusCommand({ threadId: 'thread-1', command: 'review', prompt: '审修当前章' })).toBe(false)
    expect(isRuntimeStatusCommand({ threadId: 'thread-1', command: 'rewrite', prompt: '重写当前章' })).toBe(false)
    expect(isRuntimeStatusCommand({ threadId: 'thread-1', command: 'adjust-style', prompt: '调整风格' })).toBe(true)
    expect(isRuntimeStatusCommand({ threadId: 'thread-1', command: 'freeform', prompt: '你好' })).toBe(false)
  })

  test('builds a safe prompt that forbids file writes', () => {
    const prompt = createRuntimeStatusPrompt({ threadId: 'thread-1', command: 'adjust-style', prompt: '调整风格' })

    expect(prompt).toContain('NarraCat runtime status')
    expect(prompt).toContain('Do not write, edit, delete, or persist files')
    expect(prompt).toContain('调整风格')
  })

  test('builds a direct chat prompt that does not inspect runtime by default', () => {
    const prompt = createDirectChatPrompt({ threadId: 'thread-1', command: 'freeform', prompt: '你好' })

    expect(prompt).toContain('NarraCat direct conversation')
    expect(prompt).toContain('Do not inspect the project setup or NarraCat Agent Core status')
    expect(prompt).toContain('User message:\n你好')
    expect(prompt).not.toContain('NarraCat runtime status')
  })

  test('direct-chat 系统提示含指令引导段：列出可推荐指令并要求输出可点击的指令原文', () => {
    // 六条指令词必须逐字出现（胶囊正则按 /narracat:xxx 原文匹配）
    for (const command of [
      '/narracat:setup',
      '/narracat:reference',
      '/narracat:world',
      '/narracat:plan',
      '/narracat:write',
      '/narracat:review',
    ]) {
      expect(DIRECT_CHAT_SYSTEM_PROMPT).toContain(command)
    }
    // 引导规则：识别到流程意图时输出指令原文而非自己执行
    expect(DIRECT_CHAT_SYSTEM_PROMPT).toContain('可点击按钮')
    expect(DIRECT_CHAT_SYSTEM_PROMPT).toContain('不要试图自己执行')
    // 既有禁写文件约束不得被删
    expect(DIRECT_CHAT_SYSTEM_PROMPT).toContain('Do not write, edit, delete, or persist files.')
  })
})
