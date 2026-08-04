// electron/main/chat/character-chat-profiler.test.ts
import { describe, expect, it } from 'vitest'
import { buildProfilerPrompt, createCharacterChatProfiler, parseProfilerOutput, selectNewMessages } from './character-chat-profiler.ts'
import { POOL_DEFAULT_FIELDS } from '@shared/types/config'

const m = (id: string, role: 'user' | 'character', text: string) => ({
  id, role, text, status: 'complete' as const, createdAt: '2026-06-24T10:00:00.000Z',
})

describe('selectNewMessages', () => {
  it('无游标取全部 complete', () => {
    expect(selectNewMessages([m('1', 'user', 'a'), m('2', 'character', 'b')], null)).toHaveLength(2)
  })
  it('有游标只取其后', () => {
    const list = [m('1', 'user', 'a'), m('2', 'character', 'b'), m('3', 'user', 'c')]
    expect(selectNewMessages(list, '2').map((x) => x.id)).toEqual(['3'])
  })
  it('游标已是最后一条 → 空', () => {
    expect(selectNewMessages([m('1', 'user', 'a')], '1')).toEqual([])
  })
  it('非 complete 消息被过滤，不混入提炼输入', () => {
    const streaming = { id: '2', role: 'character' as const, text: '...', status: 'streaming' as const, createdAt: '2026-06-24T10:00:00.000Z' }
    const list = [m('1', 'user', 'a'), streaming, m('3', 'user', 'b')]
    const result = selectNewMessages(list, null)
    expect(result.map((x) => x.id)).toEqual(['1', '3'])
    expect(result.every((x) => x.status === 'complete')).toBe(true)
  })
})

describe('buildProfilerPrompt', () => {
  it('含现有画像、新对话、角色名、上限提示', () => {
    const { system, user } = buildProfilerPrompt({
      authorProfile: '旧作者画像',
      impression: '旧印象',
      newMessages: [m('1', 'user', '我喜欢暗黑风')],
      characterName: '苏见',
    })
    expect(system).toContain('===AUTHOR===')
    expect(system).toContain('===IMPRESSION===')
    expect(user).toContain('旧作者画像')
    expect(user).toContain('旧印象')
    expect(user).toContain('我喜欢暗黑风')
    expect(user).toContain('苏见')
  })
  it('newMessages 为空 → user prompt 含兜底「（无）」', () => {
    const { user } = buildProfilerPrompt({
      authorProfile: '',
      impression: '',
      newMessages: [],
      characterName: '苏见',
    })
    expect(user).toContain('（无）')
  })
})

describe('parseProfilerOutput', () => {
  it('切分两段', () => {
    const out = parseProfilerOutput('===AUTHOR===\n爱暗黑\n===IMPRESSION===\n站阿九那边')
    expect(out).toEqual({ authorProfile: '爱暗黑', impression: '站阿九那边' })
  })
  it('缺标记 → null（不污染已有画像）', () => {
    expect(parseProfilerOutput('随便一段没有标记的文字')).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// D2: createCharacterChatProfiler 工厂测试
// ──────────────────────────────────────────────────────────────────────────────

function fakeDeps(overrides: Record<string, unknown> = {}) {
  const writes: unknown[] = []
  return {
    writes,
    deps: {
      readConfig: async () => ({
        ...POOL_DEFAULT_FIELDS,
        apiKeyMetadata: {},
      }),
      getApiKey: async () => 'sk-test',
      readTranscript: async () => ({
        projectPath: '/p', characterUid: 'c', userMode: 'author',
        messages: Array.from({ length: 8 }, (_, i) => ({
          id: `m${i}`, role: i % 2 ? 'character' : 'user', text: `t${i}`, status: 'complete', createdAt: '2026-06-24T10:00:00.000Z',
        })),
        updatedAt: '2026-06-24T10:00:00.000Z',
      }),
      readAuthorProfile: async (_dir: string) => ({ body: '', updatedAt: null }),
      readImpressionMeta: async (_dir: string, _identity: unknown) => ({ body: '', lastProcessedMessageId: null }),
      writeAuthorProfile: async (_dir: string, body: string, opts?: { expectedUpdatedAt?: string | null }) => {
        writes.push(['author', body, opts?.expectedUpdatedAt ?? null])
        return true
      },
      writeImpression: async (_dir: string, input: { body: string; lastProcessedMessageId: string | null }) => {
        writes.push(['impression', input.body, input.lastProcessedMessageId])
      },
      createClient: () => ({
        messages: { create: async () => ({ content: [{ type: 'text', text: '===AUTHOR===\n爱暗黑\n===IMPRESSION===\n站阿九' }] }) },
      }),
      profilesDir: '/prof',
      ...overrides,
    },
  }
}

describe('createCharacterChatProfiler.maybeRefine', () => {
  it('新增消息数达阈值 → 调模型并落盘两份+游标', async () => {
    const { writes, deps } = fakeDeps()
    await createCharacterChatProfiler(deps as any).maybeRefine({ projectPath: '/p', characterUid: 'c', characterName: '苏见', minNewMessages: 6 })
    expect(writes).toContainEqual(['author', '爱暗黑', null]) // 第三项=CAS 基准 expectedUpdatedAt（空画像基准为 null）
    expect((writes.find((w) => (w as unknown[])[0] === 'impression') as unknown[])?.[2]).toBe('m7') // 游标=最后一条
  })

  it('新增不足阈值 → 不调模型不落盘', async () => {
    const { writes, deps } = fakeDeps({ readImpressionMeta: async (_dir: string, _identity: unknown) => ({ body: '', lastProcessedMessageId: 'm6' }) })
    await createCharacterChatProfiler(deps as any).maybeRefine({ projectPath: '/p', characterUid: 'c', characterName: '苏见', minNewMessages: 6 })
    expect(writes).toHaveLength(0)
  })

  it('模型输出无标记 → 不落盘（不污染）', async () => {
    const { writes, deps } = fakeDeps({
      createClient: () => ({ messages: { create: async () => ({ content: [{ type: 'text', text: '乱码无标记' }] }) } }),
    })
    await createCharacterChatProfiler(deps as any).maybeRefine({ projectPath: '/p', characterUid: 'c', characterName: '苏见', minNewMessages: 6 })
    expect(writes).toHaveLength(0)
  })

  it('同会话并发只跑一次', async () => {
    let calls = 0
    const { deps } = fakeDeps({
      createClient: () => ({ messages: { create: async () => { calls += 1; return { content: [{ type: 'text', text: '===AUTHOR===\na\n===IMPRESSION===\nb' }] } } } }),
    })
    const profiler = createCharacterChatProfiler(deps as any)
    await Promise.all([
      profiler.maybeRefine({ projectPath: '/p', characterUid: 'c', characterName: '苏见', minNewMessages: 6 }),
      profiler.maybeRefine({ projectPath: '/p', characterUid: 'c', characterName: '苏见', minNewMessages: 6 }),
    ])
    expect(calls).toBe(1)
  })
})
