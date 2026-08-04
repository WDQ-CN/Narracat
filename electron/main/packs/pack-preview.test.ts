// electron/main/packs/pack-preview.test.ts
import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { previewDraftCard, type AuthoringToolName } from './pack-preview'
import { createPackDraft } from './pack-drafts'
import type { DraftCard } from '@shared/types/capability-pack'

let tmp: string, userDataPath: string
const paths = { appRoot: '/app', userDataPath: '' }

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pack-preview-'))
  userDataPath = join(tmp, 'userData')
  paths.userDataPath = userDataPath
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const structureCard: DraftCard = {
  cardId: 'c-structure',
  type: 'structure',
  name: '开局钩子',
  oneLine: '三章内抛出核心冲突',
  body: '开局要在三章内亮出主角的核心目标与阻碍。',
  intent: 'stage-1',
  compiled: {
    fields: { stage: 'stage-1', dimension: 'user-defined' },
    echo: '系统的理解：全书布局阶段的编排方法',
    engineVersion: '4.0.0',
    compiledAt: '2026-07-19T00:00:00.000Z',
  },
}

const craftCard: DraftCard = {
  cardId: 'c-craft',
  type: 'craft',
  name: '战斗前夕紧张感',
  oneLine: '战斗前的静默铺垫',
  body: '在大战开始前，用环境细节铺垫紧张感。',
  intent: '战斗前夕要有紧张感铺垫',
  compiled: {
    fields: { triggers: ['战斗前夕'], emotion_tags: ['紧张'], exclusions: [], technique_tags: ['伏笔'], priority: 50, beat_types: [] },
    echo: '系统的理解：会在出现「战斗前夕」的章节出场；情绪贴合：紧张；不用于：无',
    engineVersion: '4.0.0',
    compiledAt: '2026-07-19T00:00:00.000Z',
  },
}

// 缺 emotion_tags/exclusions 字段（模拟旧编译产物残缺，T2 遗留适配须补 []，不是拒绝预演）
const craftCardMissingArrays: DraftCard = {
  cardId: 'c-craft-missing',
  type: 'craft',
  name: '缺字段技法卡',
  oneLine: '一句话',
  body: '正文',
  intent: '触发意图',
  compiled: {
    fields: { triggers: ['危险'] },
    echo: '系统的理解：会在出现「危险」的章节出场',
    engineVersion: '4.0.0',
    compiledAt: '2026-07-19T00:00:00.000Z',
  },
}

const personaCard: DraftCard = {
  cardId: 'c-persona',
  type: 'persona',
  name: '气质卡',
  oneLine: '热血轻松',
  body: '这本书整体气质热血又轻松。',
  intent: '一本热血轻松的书',
  compiled: {
    fields: { keywords: ['热血', '轻松'] },
    echo: '系统的理解：适合「热血、轻松」气质的书',
    engineVersion: '4.0.0',
    compiledAt: '2026-07-19T00:00:00.000Z',
  },
}

const uncompiledCard: DraftCard = {
  cardId: 'c-uncompiled',
  type: 'craft',
  name: '未编译卡',
  oneLine: '',
  body: '正文',
  intent: '还没编译',
  compiled: null,
}

async function makeDraft(cards: DraftCard[]): Promise<string> {
  const meta = await createPackDraft({ userDataPath, name: '测试草稿', seed: { cards } })
  return meta.draftId
}

describe('previewDraftCard', () => {
  test('卡片不存在 → status error', async () => {
    const draftId = await makeDraft([])
    const result = await previewDraftCard({ userDataPath, draftId, cardId: 'nope', paths })
    expect(result).toEqual({ status: 'error', message: '卡片不存在。' })
  })

  test('未完成意图理解（compiled 为空）→ status error 提示先完成意图理解', async () => {
    const draftId = await makeDraft([uncompiledCard])
    const result = await previewDraftCard({ userDataPath, draftId, cardId: uncompiledCard.cardId, paths })
    expect(result).toEqual({ status: 'error', message: '先完成意图理解' })
  })

  test('structure 卡本地返回 stage，零出网（假 callAuthoringTool 断言零调用）', async () => {
    const draftId = await makeDraft([structureCard])
    const callAuthoringTool = mock(async () => ({ type: 'craft', results: [] }))
    const result = await previewDraftCard(
      { userDataPath, draftId, cardId: structureCard.cardId, paths },
      { callAuthoringTool: callAuthoringTool as unknown as typeof callAuthoringTool },
    )
    expect(result).toEqual({ status: 'ok', kind: 'structure', stage: 'stage-1' })
    expect(callAuthoringTool).not.toHaveBeenCalled()
  })

  test('craft 卡透传引擎结果，payload 补齐缺省数组字段', async () => {
    const draftId = await makeDraft([craftCard])
    let seenToolName: AuthoringToolName | undefined
    let seenPayload: unknown
    const callAuthoringTool = mock(async (toolName: AuthoringToolName, payload: Record<string, unknown>) => {
      seenToolName = toolName
      seenPayload = payload
      return { type: 'craft', results: [{ id: 's1', name: '典型情境一', selected: true, reason: '触发词命中' }] }
    })
    const result = await previewDraftCard(
      { userDataPath, draftId, cardId: craftCard.cardId, paths },
      { callAuthoringTool: callAuthoringTool as unknown as typeof callAuthoringTool },
    )
    expect(result).toEqual({
      status: 'ok',
      kind: 'craft',
      results: [{ id: 's1', name: '典型情境一', selected: true, reason: '触发词命中' }],
    })
    expect(seenToolName).toBe('novel_pack_authoring_preview')
    expect(seenPayload).toEqual({
      card: { type: 'craft', id: 'c-craft', triggers: ['战斗前夕'], emotion_tags: ['紧张'], exclusions: [], priority: 50 },
    })
  })

  test('craft 卡缺 emotion_tags/exclusions 字段 → payload 补空数组（T2 遗留适配）', async () => {
    const draftId = await makeDraft([craftCardMissingArrays])
    let seenPayload: unknown
    const callAuthoringTool = mock(async (_toolName: AuthoringToolName, payload: Record<string, unknown>) => {
      seenPayload = payload
      return { type: 'craft', results: [] }
    })
    await previewDraftCard(
      { userDataPath, draftId, cardId: craftCardMissingArrays.cardId, paths },
      { callAuthoringTool: callAuthoringTool as unknown as typeof callAuthoringTool },
    )
    expect(seenPayload).toEqual({
      card: { type: 'craft', id: 'c-craft-missing', triggers: ['危险'], emotion_tags: [], exclusions: [], priority: 50 },
    })
  })

  test('persona 卡透传引擎结果', async () => {
    const draftId = await makeDraft([personaCard])
    let seenPayload: unknown
    const callAuthoringTool = mock(async (_toolName: AuthoringToolName, payload: Record<string, unknown>) => {
      seenPayload = payload
      return { type: 'persona', results: [{ id: 'v1', name: '典型声音一', selected: false, reason: '会选中「别的画像」' }] }
    })
    const result = await previewDraftCard(
      { userDataPath, draftId, cardId: personaCard.cardId, paths },
      { callAuthoringTool: callAuthoringTool as unknown as typeof callAuthoringTool },
    )
    expect(result).toEqual({
      status: 'ok',
      kind: 'persona',
      results: [{ id: 'v1', name: '典型声音一', selected: false, reason: '会选中「别的画像」' }],
    })
    expect(seenPayload).toEqual({ card: { type: 'persona', id: 'c-persona', name: '气质卡', keywords: ['热血', '轻松'] } })
  })

  test('引擎调用抛错 → status error 携带人话 message', async () => {
    const draftId = await makeDraft([craftCard])
    const callAuthoringTool = mock(async () => {
      throw new Error('工具执行失败：连接超时')
    })
    const result = await previewDraftCard(
      { userDataPath, draftId, cardId: craftCard.cardId, paths },
      { callAuthoringTool: callAuthoringTool as unknown as typeof callAuthoringTool },
    )
    expect(result).toEqual({ status: 'error', message: '工具执行失败：连接超时' })
  })

  test('引擎返回结构异常（缺 results）→ status error', async () => {
    const draftId = await makeDraft([craftCard])
    const callAuthoringTool = mock(async () => ({ type: 'craft' }))
    const result = await previewDraftCard(
      { userDataPath, draftId, cardId: craftCard.cardId, paths },
      { callAuthoringTool: callAuthoringTool as unknown as typeof callAuthoringTool },
    )
    expect(result.status).toBe('error')
  })
})

describe('previewDraftCard · 草稿不存在', () => {
  test('draft 不存在直接 status error，不触发 stub 项目创建', async () => {
    // 格式合法但不存在的 draftId（同 pack-drafts.test.ts NONEXISTENT_DRAFT_ID 先例）——
    // 区分「不存在」语义与「格式非法/穿越」语义，后者由 getPackDraft 自身 fail-loud 拒绝。
    const result = await previewDraftCard({
      userDataPath,
      draftId: '00000000-0000-0000-0000-000000000000',
      cardId: 'x',
      paths,
    })
    expect(result).toEqual({ status: 'error', message: '卡片不存在。' })
  })
})

/**
 * 走生产默认 deps（真实 callAuthoringTool → character-state-edit.ts 的 callEngineToolRaw），
 * 不 mock 掉传输层——用 NARRACAT_AGENT_RUNTIME_NODE 环境变量（既有 dev-runtime 覆盖口子，见
 * headless-agent-runtime.ts）把子进程命令钦定成一个必然不存在的路径，制造真实 spawn ENOENT，
 * 验证 callEngineToolRaw 新补的 catch：技术错误不能原样冒泡到 UI，且要 console.error 留痕。
 */
describe('previewDraftCard · 真实 callAuthoringTool 走 stub 项目，连接层失败兜底', () => {
  const NONEXISTENT_NODE = '/definitely/nonexistent/dir/node'
  let originalRuntimeNode: string | undefined
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    originalRuntimeNode = process.env.NARRACAT_AGENT_RUNTIME_NODE
    process.env.NARRACAT_AGENT_RUNTIME_NODE = NONEXISTENT_NODE
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    if (originalRuntimeNode === undefined) delete process.env.NARRACAT_AGENT_RUNTIME_NODE
    else process.env.NARRACAT_AGENT_RUNTIME_NODE = originalRuntimeNode
    errorSpy.mockRestore()
  })

  test('引擎子进程起不来 → status error，message 是人话，不含 ENOENT/spawn/堆栈', async () => {
    const draftId = await makeDraft([craftCard])
    const result = await previewDraftCard({ userDataPath, draftId, cardId: craftCard.cardId, paths })
    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.message).toBe('novel_pack_authoring_preview 调用失败，请稍后重试。')
    expect(result.message).not.toMatch(/ENOENT|spawn|at\s+\S+:\d+:\d+/i)
  })

  test('console.error 留痕原始错误（供 T14 真机踩坑排查）', async () => {
    const draftId = await makeDraft([craftCard])
    await previewDraftCard({ userDataPath, draftId, cardId: craftCard.cardId, paths })
    expect(errorSpy).toHaveBeenCalled()
    const logged = errorSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
    expect(logged).toContain('novel_pack_authoring_preview')
  })
})
