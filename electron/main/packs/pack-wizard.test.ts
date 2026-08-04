import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPackWizard,
  buildWizardOpeningPrompt,
  validateWizardCards,
  DEFAULT_WIZARD_PACK_NAME,
  type PackWizardDeps,
  type WizardTurnInput,
  type WizardTurnResult,
} from './pack-wizard'
import { parseLearnOutput } from './pack-learn-output'
import { getPackDraft, listPackDrafts, packDraftsDir } from './pack-drafts'
import { SOURCE_FINGERPRINT_FILENAME } from './pack-learn'
import type { PackWizardEvent } from '@shared/types/capability-pack'

let tmp: string
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'narracat-wizard-test-')) })
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

const VALID_OUTPUT = {
  pack_name: '我的写法',
  cards: [
    {
      type: 'craft',
      name: '留白收尾',
      one_line: '顶点前停笔',
      body: '[runtime]\n机制名：留白收尾\n\n[evidence]\n「顶点前一句停」（来自访谈）',
      intent: '高潮章用',
    },
    {
      type: 'structure',
      name: '双线咬合',
      one_line: '两线交替',
      body: '机制……\n\n[evidence]\n「两条线轮着推」（来自访谈）',
      intent: 'stage-1',
    },
  ],
}

type TurnHandler = (input: WizardTurnInput) => Promise<WizardTurnResult>

async function writeCards(input: WizardTurnInput, content: unknown): Promise<void> {
  const raw = typeof content === 'string' ? content : JSON.stringify(content)
  await writeFile(join(input.workspaceDir, 'output', 'cards.json'), raw, 'utf8')
}

/** 假会话：按调用序执行 turns 里的处理器（超出用最后一个），记录每轮入参。 */
function makeDeps(turns: TurnHandler[], overrides: Partial<PackWizardDeps> = {}) {
  const events: PackWizardEvent[] = []
  const turnInputs: WizardTurnInput[] = []
  const compileCalls: Array<{ userDataPath: string; draftId: string; cardId: string }> = []
  const previewCalls: Array<{ userDataPath: string; draftId: string; cardId: string }> = []
  const deps: PackWizardDeps = {
    userDataPath: () => tmp,
    runTurn: async (input) => {
      turnInputs.push(input)
      const handler = turns[Math.min(turnInputs.length - 1, turns.length - 1)]
      return handler(input)
    },
    compileCard: async (input) => {
      compileCalls.push(input)
      return { status: 'ok' }
    },
    previewCard: async (input) => {
      previewCalls.push(input)
      return {
        status: 'ok',
        kind: 'craft',
        results: [{ id: 's1', name: '典型场景', selected: true, reason: '触发词「留白」' }],
      }
    },
    readWizardPrompt: async () => '# writer-wizard 命令正文',
    emit: (e) => events.push(e),
    ...overrides,
  }
  return { deps, events, turnInputs, compileCalls, previewCalls }
}

const phasesOf = (events: PackWizardEvent[]) => events.filter((e) => e.kind === 'phase').map((e) => (e.kind === 'phase' ? e.phase : ''))
const countKind = (events: PackWizardEvent[], kind: PackWizardEvent['kind']) => events.filter((e) => e.kind === kind).length
const terminalCount = (events: PackWizardEvent[]) => countKind(events, 'done') + countKind(events, 'error') + countKind(events, 'cancelled')

/** 首轮正常聊天（不产文件）的处理器。 */
const chatTurn = (text: string, sessionId?: string): TurnHandler => async (input) => {
  input.onAssistantText(text)
  return sessionId ? { outcome: 'success', sessionId } : { outcome: 'success' }
}

describe('createPackWizard', () => {
  test('正常两轮→产卡全径：opening prompt 内联命令、sessionId 续轮、确定性探测收卡、created 工程、编译逐卡、done 单发、工作区清理', async () => {
    const { deps, events, turnInputs, compileCalls, previewCalls } = makeDeps([
      chatTurn('你想沉淀什么写法？', 'session-1'),
      async (input) => {
        input.onAssistantText('完成了，一共 2 张卡。')
        await writeCards(input, VALID_OUTPUT)
        return { outcome: 'success', sessionId: 'session-1' }
      },
    ])
    const wizard = createPackWizard(deps)
    const startAck = await wizard.start()
    expect(startAck).toEqual({ ok: true })
    // 首轮：prompt 内联命令正文 + 开场指令，resumeSessionId 为 null
    expect(turnInputs[0].prompt).toContain('# writer-wizard 命令正文')
    expect(turnInputs[0].prompt).toContain('开始访谈')
    expect(turnInputs[0].resumeSessionId).toBeNull()
    expect(phasesOf(events)).toEqual(['preparing', 'thinking', 'awaiting_user'])
    expect(wizard.isBusy()).toBe(true)

    const sendAck = await wizard.send('我想沉淀打脸场面的铺法')
    expect(sendAck).toEqual({ ok: true })
    // 续轮：用户文本原样作为 prompt，带上首轮捕获的 sessionId
    expect(turnInputs[1].prompt).toBe('我想沉淀打脸场面的铺法')
    expect(turnInputs[1].resumeSessionId).toBe('session-1')
    expect(phasesOf(events)).toEqual(['preparing', 'thinking', 'awaiting_user', 'thinking', 'saving'])
    expect(events.filter((e) => e.kind === 'assistant').map((e) => (e.kind === 'assistant' ? e.text : ''))).toEqual([
      '你想沉淀什么写法？',
      '完成了，一共 2 张卡。',
    ])

    const done = events.find((e) => e.kind === 'done')
    if (!done || done.kind !== 'done') throw new Error('缺 done 事件')
    expect(done.cardCount).toBe(2)
    expect(done.draftId).not.toBeNull()
    expect(terminalCount(events)).toBe(1)
    // 卡级摘要（刀5 修复波诚实完成页）：craft 卡带预览命中数；structure 装载语义 previewHits=null
    expect(done.cards).toEqual([
      { name: '留白收尾', type: 'craft', compiled: true, previewHits: 1 },
      { name: '双线咬合', type: 'structure', compiled: true, previewHits: null },
    ])
    expect(done.droppedCount).toBe(0)
    // 代表性预览只跑 craft/persona（structure 跳过）
    expect(previewCalls.length).toBe(1)

    // created 工程：名字取 pack_name，无 localSource/learnedFrom、无指纹文件
    const draft = await getPackDraft({ userDataPath: tmp, draftId: done.draftId as string })
    expect(draft?.meta.name).toBe('我的写法')
    expect(draft?.meta.localSource).toBeUndefined()
    expect(draft?.meta.learnedFrom).toBeUndefined()
    expect(draft?.cards.length).toBe(2)
    expect(existsSync(join(packDraftsDir(tmp), done.draftId as string, SOURCE_FINGERPRINT_FILENAME))).toBe(false)
    // 逐卡编译（真实例由 T4 注入；此处验前向调用形态）
    expect(compileCalls.length).toBe(2)
    expect(compileCalls.map((c) => c.cardId).sort()).toEqual(draft!.cards.map((c) => c.cardId).sort())

    // 工作区清理 + 终态后拒绝
    expect(existsSync(turnInputs[0].workspaceDir)).toBe(false)
    expect(wizard.isBusy()).toBe(false)
    expect(wizard.isFinished()).toBe(true)
    expect((await wizard.send('还在吗')).ok).toBe(false)
    expect((await wizard.start()).ok).toBe(false)
  })

  test('pack_name 缺省 → 兜底工程名', async () => {
    const { cards } = VALID_OUTPUT
    const { deps, events } = makeDeps([
      chatTurn('聊聊？'),
      async (input) => {
        await writeCards(input, { cards })
        return { outcome: 'success' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    const done = events.find((e) => e.kind === 'done')
    if (!done || done.kind !== 'done') throw new Error('缺 done 事件')
    const draft = await getPackDraft({ userDataPath: tmp, draftId: done.draftId as string })
    expect(draft?.meta.name).toBe(DEFAULT_WIZARD_PACK_NAME)
  })

  test('cards 为空数组（明示没聊出）→ done(draftId:null, cardCount:0)，不落工程', async () => {
    const { deps, events, compileCalls } = makeDeps([
      chatTurn('聊聊？'),
      async (input) => {
        input.onAssistantText('这场访谈没聊出可炼的写法。')
        await writeCards(input, { cards: [] })
        return { outcome: 'success' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('算了')
    const done = events.find((e) => e.kind === 'done')
    expect(done).toMatchObject({ kind: 'done', draftId: null, cardCount: 0 })
    expect(terminalCount(events)).toBe(1)
    expect(await listPackDrafts({ userDataPath: tmp })).toEqual([])
    expect(compileCalls.length).toBe(0)
  })

  test('纠错一轮：第一次非法 → 纠错 prompt 携带原因再跑一轮 → 第二次合法产卡', async () => {
    const { deps, events, turnInputs } = makeDeps([
      chatTurn('聊聊？'),
      async (input) => {
        await writeCards(input, '{这不是合法 JSON')
        return { outcome: 'success' }
      },
      async (input) => {
        await writeCards(input, VALID_OUTPUT)
        return { outcome: 'success' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    expect(turnInputs.length).toBe(3)
    // 纠错 prompt：带上解析失败原因，要求按契约重写；原因主语走访谈口径（T3 评审 Minor-1），
    // learn 措辞「学习结果」不得泄入向导语境
    expect(turnInputs[2].prompt).toContain('没有通过校验')
    expect(turnInputs[2].prompt).toContain('访谈产出不是合法 JSON')
    expect(turnInputs[2].prompt).not.toContain('学习结果')
    expect(phasesOf(events)).toEqual(['preparing', 'thinking', 'awaiting_user', 'thinking', 'saving', 'thinking', 'saving'])
    const done = events.find((e) => e.kind === 'done')
    if (!done || done.kind !== 'done') throw new Error('缺 done 事件')
    expect(done.draftId).not.toBeNull()
    expect(terminalCount(events)).toBe(1)
  })

  test('两次非法 → error（纠错只给一次），不落工程、工作区清理', async () => {
    const { deps, events, turnInputs } = makeDeps([
      chatTurn('聊聊？'),
      async (input) => {
        await writeCards(input, '{第一次坏')
        return { outcome: 'success' }
      },
      async (input) => {
        await writeCards(input, '{第二次还是坏')
        return { outcome: 'success' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    expect(turnInputs.length).toBe(3) // 不会有第二次纠错
    const error = events.find((e) => e.kind === 'error')
    if (!error || error.kind !== 'error') throw new Error('缺 error 事件')
    expect(error.message).toContain('重试一次也没成功')
    // error 终态里的原因同样走访谈口径（T3 评审 Minor-1）
    expect(error.message).toContain('访谈产出不是合法 JSON')
    expect(error.message).not.toContain('学习结果')
    expect(countKind(events, 'error')).toBe(1)
    expect(countKind(events, 'done')).toBe(0)
    expect(await listPackDrafts({ userDataPath: tmp })).toEqual([])
    expect(existsSync(turnInputs[0].workspaceDir)).toBe(false)
  })

  test('纠错轮 cards.json 消失（模型删了没重写）→ error，不回 awaiting_user', async () => {
    const { deps, events } = makeDeps([
      chatTurn('聊聊？'),
      async (input) => {
        await writeCards(input, '{坏的')
        return { outcome: 'success' }
      },
      async (input) => {
        rmSync(join(input.workspaceDir, 'output', 'cards.json'), { force: true })
        return { outcome: 'success' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    expect(countKind(events, 'error')).toBe(1)
    expect(phasesOf(events).filter((p) => p === 'awaiting_user').length).toBe(1) // 只有首轮那次
  })

  test('cancel 中途：cancelled 恰好一次（重复 cancel 不双发），迟到 runTurn 结果不复活、无残留', async () => {
    let releaseTurn: () => void = () => {}
    const turnGate = new Promise<void>((r) => { releaseTurn = r })
    let turnEntered: () => void = () => {}
    const turnEnteredPromise = new Promise<void>((r) => { turnEntered = r })
    const { deps, events, turnInputs } = makeDeps([
      chatTurn('聊聊？'),
      async (input) => {
        turnEntered()
        await turnGate
        input.onAssistantText('迟到的回复')
        // 迟到结果把合法 cards.json 真的摆上桌（工作区被 cancel 清理过就重建）——
        // 判别力：任何「复活」路径要么被 finished 拦截，要么落了工程也必须回滚，下方断言双卡
        await mkdir(join(input.workspaceDir, 'output'), { recursive: true })
        await writeCards(input, VALID_OUTPUT)
        return { outcome: 'success' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    const pendingSend = wizard.send('好了')
    await turnEnteredPromise
    await wizard.cancel()
    await wizard.cancel() // 第二次 cancel 必须是 no-op
    expect(countKind(events, 'cancelled')).toBe(1)
    expect(existsSync(turnInputs[0].workspaceDir)).toBe(false) // cancel 即清工作区
    releaseTurn()
    await pendingSend
    // 迟到结果全被拦下：无 assistant/saving/done，唯一终态是那一次 cancelled，工程零残留
    expect(events.some((e) => e.kind === 'assistant' && e.text === '迟到的回复')).toBe(false)
    expect(phasesOf(events)).not.toContain('saving')
    expect(countKind(events, 'done')).toBe(0)
    expect(terminalCount(events)).toBe(1)
    expect(await listPackDrafts({ userDataPath: tmp })).toEqual([])
    expect((await wizard.send('还在吗')).ok).toBe(false)
    expect(wizard.isFinished()).toBe(true)
    rmSync(turnInputs[0].workspaceDir, { recursive: true, force: true }) // 清掉测试假件重建的目录
  })

  test('awaiting_user 时 cancel：cancelled 单发 + 工作区清理', async () => {
    const { deps, events, turnInputs } = makeDeps([chatTurn('聊聊？')])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.cancel()
    expect(countKind(events, 'cancelled')).toBe(1)
    expect(terminalCount(events)).toBe(1)
    expect(existsSync(turnInputs[0].workspaceDir)).toBe(false)
    expect((await wizard.send('还在吗')).ok).toBe(false)
  })

  test('saving 中途抛错回滚：损坏的工程读不回来 → deletePackDraft 连根拔掉，error 单发、零残留', async () => {
    // 故障注入：compileCard 把已建工程的 draft.json 写坏（模拟落盘中途盘面异常），
    // done 前完整性核验读不回工程 → 抛错 → 整体回滚。判别力在「回滚代码真删了目录」：
    // 删掉 deletePackDraft 回滚或完整性核验任一处，本用例都会红。
    let corruptedDraftDir = ''
    const { deps, events, turnInputs } = makeDeps(
      [
        chatTurn('聊聊？'),
        async (input) => {
          await writeCards(input, VALID_OUTPUT)
          return { outcome: 'success' }
        },
      ],
      {
        compileCard: async ({ userDataPath, draftId }) => {
          corruptedDraftDir = join(packDraftsDir(userDataPath), draftId)
          writeFileSync(join(corruptedDraftDir, 'draft.json'), '{not valid json', 'utf8')
          return { status: 'ok' }
        },
      },
    )
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    expect(countKind(events, 'error')).toBe(1)
    expect(countKind(events, 'done')).toBe(0)
    expect(terminalCount(events)).toBe(1)
    expect(corruptedDraftDir).not.toBe('')
    expect(existsSync(corruptedDraftDir)).toBe(false)
    expect(await listPackDrafts({ userDataPath: tmp })).toEqual([])
    expect(existsSync(turnInputs[0].workspaceDir)).toBe(false)
  })

  test('saving 段编译阻塞时 cancel → 回滚已建工程，不 emit done（cancelled 已由 cancel 单发）', async () => {
    let releaseCompile: () => void = () => {}
    const compileGate = new Promise<void>((r) => { releaseCompile = r })
    let compileEntered: () => void = () => {}
    const compileEnteredPromise = new Promise<void>((r) => { compileEntered = r })
    const { deps, events } = makeDeps(
      [
        chatTurn('聊聊？'),
        async (input) => {
          await writeCards(input, VALID_OUTPUT)
          return { outcome: 'success' }
        },
      ],
      {
        compileCard: async () => {
          compileEntered()
          await compileGate
          return { status: 'ok' }
        },
      },
    )
    const wizard = createPackWizard(deps)
    await wizard.start()
    const pendingSend = wizard.send('好了')
    await compileEnteredPromise
    await wizard.cancel()
    releaseCompile()
    await pendingSend
    expect(countKind(events, 'cancelled')).toBe(1)
    expect(countKind(events, 'done')).toBe(0)
    expect(terminalCount(events)).toBe(1)
    expect(await listPackDrafts({ userDataPath: tmp })).toEqual([])
  })

  test('单卡编译失败容忍：compileCard 抛错不中断，工程照常落、done 照发且摘要如实 compiled=false、预览跳过', async () => {
    const { deps, events, previewCalls } = makeDeps(
      [
        chatTurn('聊聊？'),
        async (input) => {
          await writeCards(input, VALID_OUTPUT)
          return { outcome: 'success' }
        },
      ],
      { compileCard: async () => { throw new Error('编译模型不可用') } },
    )
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    const done = events.find((e) => e.kind === 'done')
    if (!done || done.kind !== 'done') throw new Error('缺 done 事件')
    expect(done.cardCount).toBe(2)
    expect((await listPackDrafts({ userDataPath: tmp })).length).toBe(1)
    // 诚实摘要：没编译成的卡 compiled=false、previewHits=null；未编译卡不进预览（前置条件缺失）
    expect(done.cards?.every((card) => !card.compiled && card.previewHits === null)).toBe(true)
    expect(previewCalls.length).toBe(0)
  })

  test('compileCard 返回 error 结果（不抛错）→ 摘要 compiled=false（不只看没抛异常）', async () => {
    const { deps, events } = makeDeps(
      [
        chatTurn('聊聊？'),
        async (input) => {
          await writeCards(input, VALID_OUTPUT)
          return { outcome: 'success' }
        },
      ],
      { compileCard: async () => ({ status: 'error', message: '未配置 API Key' }) },
    )
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    const done = events.find((e) => e.kind === 'done')
    if (!done || done.kind !== 'done') throw new Error('缺 done 事件')
    expect(done.cards?.every((card) => !card.compiled)).toBe(true)
  })

  test('预览异常容忍：previewCard 抛错 → previewHits=null，done 照发不阻断', async () => {
    const { deps, events } = makeDeps(
      [
        chatTurn('聊聊？'),
        async (input) => {
          await writeCards(input, VALID_OUTPUT)
          return { outcome: 'success' }
        },
      ],
      { previewCard: async () => { throw new Error('引擎子进程没起来') } },
    )
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    const done = events.find((e) => e.kind === 'done')
    if (!done || done.kind !== 'done') throw new Error('缺 done 事件')
    expect(done.draftId).not.toBeNull()
    expect(done.cards).toEqual([
      { name: '留白收尾', type: 'craft', compiled: true, previewHits: null },
      { name: '双线咬合', type: 'structure', compiled: true, previewHits: null },
    ])
    expect(terminalCount(events)).toBe(1)
  })

  test('典型场景零命中如实上报：预览全不选 → previewHits=0（完成页警示的数据源）', async () => {
    const { deps, events } = makeDeps(
      [
        chatTurn('聊聊？'),
        async (input) => {
          await writeCards(input, VALID_OUTPUT)
          return { outcome: 'success' }
        },
      ],
      {
        previewCard: async () => ({
          status: 'ok',
          kind: 'craft',
          results: [
            { id: 's1', name: '场景一', selected: false, reason: '触发词未命中或竞争落选' },
            { id: 's2', name: '场景二', selected: false, reason: '触发词未命中或竞争落选' },
          ],
        }),
      },
    )
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    const done = events.find((e) => e.kind === 'done')
    if (!done || done.kind !== 'done') throw new Error('缺 done 事件')
    expect(done.cards?.find((card) => card.type === 'craft')?.previewHits).toBe(0)
  })

  test('runTurn 失败 → error 终态 + 工作区清理', async () => {
    const { deps, events, turnInputs } = makeDeps([async () => ({ outcome: 'error', error: '模型断了' })])
    const wizard = createPackWizard(deps)
    await wizard.start()
    const error = events.find((e) => e.kind === 'error')
    if (!error || error.kind !== 'error') throw new Error('缺 error 事件')
    expect(error.message).toContain('模型断了')
    expect(terminalCount(events)).toBe(1)
    expect(existsSync(turnInputs[0].workspaceDir)).toBe(false)
    expect(wizard.isFinished()).toBe(true)
  })

  test('truncated（error_max_turns 可续）→ 回 awaiting_user 不进终态，可继续说话且 sessionId 保持', async () => {
    const { deps, events, turnInputs } = makeDeps([
      async (input) => {
        input.onAssistantText('说到一半被截断了')
        return { outcome: 'truncated', sessionId: 'session-t' }
      },
      chatTurn('继续聊'),
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    expect(phasesOf(events)).toEqual(['preparing', 'thinking', 'awaiting_user'])
    expect(terminalCount(events)).toBe(0)
    expect(wizard.isBusy()).toBe(true)
    // 截断轮捕获的 sessionId 用于续轮
    expect((await wizard.send('接着说')).ok).toBe(true)
    expect(turnInputs[1].resumeSessionId).toBe('session-t')
    expect(terminalCount(events)).toBe(0)
  })

  test('truncated 轮已写出 cards.json → 确定性探测天然兜住，照常收卡 done', async () => {
    const { deps, events } = makeDeps([
      chatTurn('聊聊？'),
      async (input) => {
        await writeCards(input, VALID_OUTPUT)
        return { outcome: 'truncated' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    const done = events.find((e) => e.kind === 'done')
    if (!done || done.kind !== 'done') throw new Error('缺 done 事件')
    expect(done.draftId).not.toBeNull()
    expect(done.cardCount).toBe(2)
  })

  test('状态门：未 start 先 send 拒 / thinking 中 send 拒 / 跑动中二次 start 拒 / 空文本拒', async () => {
    let releaseTurn: () => void = () => {}
    const turnGate = new Promise<void>((r) => { releaseTurn = r })
    let turnEntered: () => void = () => {}
    const turnEnteredPromise = new Promise<void>((r) => { turnEntered = r })
    const { deps } = makeDeps([
      async (input) => {
        turnEntered()
        await turnGate
        input.onAssistantText('来了')
        return { outcome: 'success' }
      },
    ])
    const wizard = createPackWizard(deps)
    expect((await wizard.send('抢跑')).ok).toBe(false)
    const pendingStart = wizard.start()
    await turnEnteredPromise
    expect((await wizard.send('思考中插话')).ok).toBe(false) // thinking 中拒
    expect((await wizard.start()).ok).toBe(false) // busy 单例
    releaseTurn()
    await pendingStart
    expect((await wizard.send('   ')).ok).toBe(false) // 空文本拒
    expect((await wizard.send('正经问题')).ok).toBe(true)
  })

  test('超长消息拒发不截断（T6 评审 Minor-1）：50001 字拒 + 大白话原因，恰好 50000 字放行', async () => {
    const { deps, turnInputs } = makeDeps([chatTurn('你想沉淀什么写法？'), chatTurn('收到')])
    const wizard = createPackWizard(deps)
    await wizard.start()

    const rejected = await wizard.send('字'.repeat(50_001))
    expect(rejected).toEqual({ ok: false, message: '这条消息太长了，请删减后再发（上限 5 万字）。' })
    // 拒发不动会话状态：没跑轮次（仍只有开场那一轮），边界内消息照常受理
    expect(turnInputs.length).toBe(1)
    expect((await wizard.send('字'.repeat(50_000))).ok).toBe(true)
    expect(turnInputs.length).toBe(2)
  })
})

describe('validateWizardCards · 向导产物契约校验（外审 P2：形式残缺卡不当成功产物）', () => {
  /** 经真实解析器铺路（与 settleCards 消费同形态），单独校验规则红绿。 */
  function outputOf(json: unknown) {
    const parsed = parseLearnOutput(JSON.stringify(json))
    if (!parsed.ok) throw new Error(`测试前置：解析应通过（${parsed.reason}）`)
    return parsed.output
  }

  const okCard = VALID_OUTPUT.cards[0]

  test('合规产出全通过：零违规、零可丢卡、包名合法', () => {
    const validation = validateWizardCards(outputOf(VALID_OUTPUT))
    expect(validation.violations).toEqual([])
    expect(validation.invalidCardIndexes.size).toBe(0)
    expect(validation.packNameInvalid).toBe(false)
  })

  test('缺 [evidence] 段 → 违规且卡进丢弃候选', () => {
    const validation = validateWizardCards(
      outputOf({ cards: [{ ...okCard, body: '[runtime]\n机制名：留白收尾' }] }),
    )
    expect(validation.violations.join()).toContain('缺少非空 [evidence] 摘录段')
    expect(validation.invalidCardIndexes.has(0)).toBe(true)
  })

  test('[evidence] 标记在但段内容为空 → 同判缺非空摘录段', () => {
    const validation = validateWizardCards(
      outputOf({ cards: [{ ...okCard, body: '[runtime]\n机制名：x\n\n[evidence]\n   ' }] }),
    )
    expect(validation.violations.join()).toContain('缺少非空 [evidence] 摘录段')
  })

  test('摘录没有「来自访谈」标注 → 违规', () => {
    const validation = validateWizardCards(
      outputOf({ cards: [{ ...okCard, body: '[runtime]\n机制名：x\n\n[evidence]\n第 3 章的摘录' }] }),
    )
    expect(validation.violations.join()).toContain('来自访谈')
    expect(validation.invalidCardIndexes.has(0)).toBe(true)
  })

  test('craft 卡缺 [runtime] 段 → 违规；structure/persona 不查 [runtime]', () => {
    const craftNoRuntime = validateWizardCards(
      outputOf({ cards: [{ ...okCard, body: '机制散文……\n\n[evidence]\n「原话」（来自访谈）' }] }),
    )
    expect(craftNoRuntime.violations.join()).toContain('[runtime]')
    const structureNoRuntime = validateWizardCards(outputOf({ cards: [VALID_OUTPUT.cards[1]] }))
    expect(structureNoRuntime.violations).toEqual([])
  })

  test('卡名超 12 字 / 一句话超 40 字 → 各自违规', () => {
    const validation = validateWizardCards(
      outputOf({ cards: [{ ...okCard, name: '名'.repeat(13), one_line: '话'.repeat(41) }] }),
    )
    expect(validation.violations.join()).toContain('卡名超过 12 字')
    expect(validation.violations.join()).toContain('一句话说明超过 40 字')
    // 边界值放行
    const boundary = validateWizardCards(
      outputOf({ cards: [{ ...okCard, name: '名'.repeat(12), one_line: '话'.repeat(40) }] }),
    )
    expect(boundary.violations).toEqual([])
  })

  test('pack_name 超 12 字 → packNameInvalid（不指向卡，不丢卡）', () => {
    const validation = validateWizardCards(outputOf({ pack_name: '包'.repeat(13), cards: [okCard] }))
    expect(validation.packNameInvalid).toBe(true)
    expect(validation.violations.join()).toContain('包名')
    expect(validation.invalidCardIndexes.size).toBe(0)
  })
})

describe('createPackWizard · 契约校验入纠错轮（外审点名缺口：此前只有 JSON 非法触发纠错）', () => {
  const BAD_CARD = {
    type: 'craft',
    name: '没摘录的卡',
    one_line: '缺 evidence 段',
    body: '[runtime]\n机制名：残缺',
    intent: '打脸章用',
  }

  test('合法 JSON + 违规卡 → 纠错 prompt 含具体违规与契约要求 → 二次合规产卡 done', async () => {
    const { deps, events, turnInputs } = makeDeps([
      chatTurn('聊聊？'),
      async (input) => {
        await writeCards(input, { pack_name: '我的写法', cards: [BAD_CARD] })
        return { outcome: 'success' }
      },
      async (input) => {
        await writeCards(input, VALID_OUTPUT)
        return { outcome: 'success' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    expect(turnInputs.length).toBe(3)
    // 纠错 prompt：具体违规（哪张卡、什么问题）+ 契约要求（evidence/[runtime]/长度/标注）
    expect(turnInputs[2].prompt).toContain('没有通过校验')
    expect(turnInputs[2].prompt).toContain('没摘录的卡')
    expect(turnInputs[2].prompt).toContain('缺少非空 [evidence] 摘录段')
    expect(turnInputs[2].prompt).toContain('来自访谈')
    expect(turnInputs[2].prompt).toContain('[runtime]')
    const done = events.find((e) => e.kind === 'done')
    if (!done || done.kind !== 'done') throw new Error('缺 done 事件')
    expect(done.cardCount).toBe(2)
    expect(done.droppedCount).toBe(0)
    expect(terminalCount(events)).toBe(1)
  })

  test('纠错后仍有违规卡 → 丢弃计数如实、合规卡照常落工程', async () => {
    const { deps, events } = makeDeps([
      chatTurn('聊聊？'),
      async (input) => {
        await writeCards(input, { pack_name: '我的写法', cards: [BAD_CARD] })
        return { outcome: 'success' }
      },
      async (input) => {
        // 纠错轮：一张仍违规 + 一张合规
        await writeCards(input, { pack_name: '我的写法', cards: [BAD_CARD, VALID_OUTPUT.cards[0]] })
        return { outcome: 'success' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    const done = events.find((e) => e.kind === 'done')
    if (!done || done.kind !== 'done') throw new Error('缺 done 事件')
    expect(done.cardCount).toBe(1)
    expect(done.droppedCount).toBe(1)
    expect(done.cards?.map((card) => card.name)).toEqual(['留白收尾'])
    const draft = await getPackDraft({ userDataPath: tmp, draftId: done.draftId as string })
    expect(draft?.cards.map((card) => card.name)).toEqual(['留白收尾'])
  })

  test('纠错后全部仍违规 → error 终态，不落工程', async () => {
    const { deps, events } = makeDeps([
      chatTurn('聊聊？'),
      async (input) => {
        await writeCards(input, { cards: [BAD_CARD] })
        return { outcome: 'success' }
      },
      async (input) => {
        await writeCards(input, { cards: [BAD_CARD] })
        return { outcome: 'success' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    const error = events.find((e) => e.kind === 'error')
    if (!error || error.kind !== 'error') throw new Error('缺 error 事件')
    expect(error.message).toContain('重试一次也没成功')
    expect(countKind(events, 'done')).toBe(0)
    expect(await listPackDrafts({ userDataPath: tmp })).toEqual([])
  })

  test('JSON 非法与格式违规共享同一次纠错名额：先 JSON 非法纠错，二次输出违规卡 → 直接丢弃不再纠错', async () => {
    const { deps, events, turnInputs } = makeDeps([
      chatTurn('聊聊？'),
      async (input) => {
        await writeCards(input, '{不是合法 JSON')
        return { outcome: 'success' }
      },
      async (input) => {
        await writeCards(input, { pack_name: '我的写法', cards: [BAD_CARD, VALID_OUTPUT.cards[0]] })
        return { outcome: 'success' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    expect(turnInputs.length).toBe(3) // 只有一次纠错，违规卡不再触发第二次
    const done = events.find((e) => e.kind === 'done')
    if (!done || done.kind !== 'done') throw new Error('缺 done 事件')
    expect(done.cardCount).toBe(1)
    expect(done.droppedCount).toBe(1)
  })

  test('pack_name 纠错后仍超长 → 回退兜底包名，卡不因包名丢失', async () => {
    const longName = '包'.repeat(13)
    const { deps, events } = makeDeps([
      chatTurn('聊聊？'),
      async (input) => {
        await writeCards(input, { pack_name: longName, cards: [VALID_OUTPUT.cards[0]] })
        return { outcome: 'success' }
      },
      async (input) => {
        await writeCards(input, { pack_name: longName, cards: [VALID_OUTPUT.cards[0]] })
        return { outcome: 'success' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('好了')
    const done = events.find((e) => e.kind === 'done')
    if (!done || done.kind !== 'done') throw new Error('缺 done 事件')
    expect(done.cardCount).toBe(1)
    expect(done.droppedCount).toBe(0)
    const draft = await getPackDraft({ userDataPath: tmp, draftId: done.draftId as string })
    expect(draft?.meta.name).toBe(DEFAULT_WIZARD_PACK_NAME)
  })
})

describe('createPackWizard · 会话可恢复（seq 盖章 + snapshot）', () => {
  test('seq 盖章：全事件流实例内从 1 单调递增无空洞（phase/assistant/done 全体盖章）', async () => {
    const { deps, events } = makeDeps([
      chatTurn('你想沉淀什么写法？', 'session-1'),
      async (input) => {
        input.onAssistantText('完成了。')
        await writeCards(input, VALID_OUTPUT)
        return { outcome: 'success', sessionId: 'session-1' }
      },
    ])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('打脸铺排')
    expect(events.length).toBeGreaterThan(0)
    expect(events.map((e) => e.seq)).toEqual(events.map((_, index) => index + 1))
  })

  test('snapshot 三态：未开始 null → 进行中含 transcript/phase/lastSeq → 终态含 draftId/cardCount', async () => {
    const { deps, events } = makeDeps([
      chatTurn('你想沉淀什么写法？', 'session-1'),
      async (input) => {
        input.onAssistantText('完成了，一共 2 张卡。')
        await writeCards(input, VALID_OUTPUT)
        return { outcome: 'success', sessionId: 'session-1' }
      },
    ])
    const wizard = createPackWizard(deps)
    // 未开始：没有现场可恢复
    expect(wizard.snapshot()).toBeNull()

    await wizard.start()
    const inProgress = wizard.snapshot()
    if (!inProgress) throw new Error('进行中快照不该为 null')
    expect(inProgress.phase).toBe('awaiting_user')
    expect(inProgress.messages).toEqual([{ role: 'assistant', text: '你想沉淀什么写法？' }])
    expect(inProgress.draftId).toBeNull()
    expect(inProgress.cardCount).toBeNull()
    expect(inProgress.errorMessage).toBeNull()
    // lastSeq = 已发事件数（preparing/thinking/assistant/awaiting_user），与事件流严格一致
    expect(inProgress.lastSeq).toBe(events[events.length - 1]!.seq)

    await wizard.send('打脸铺排')
    const terminal = wizard.snapshot()
    if (!terminal) throw new Error('终态快照不该为 null（重载后终态页要能恢复「查看草稿」）')
    expect(terminal.phase).toBe('done')
    // user 消息在 send 受理时记账，assistant 消息在 emit 时记账，顺序与渲染端消息流一致
    expect(terminal.messages).toEqual([
      { role: 'assistant', text: '你想沉淀什么写法？' },
      { role: 'user', text: '打脸铺排' },
      { role: 'assistant', text: '完成了，一共 2 张卡。' },
    ])
    expect(terminal.draftId).not.toBeNull()
    expect(terminal.cardCount).toBe(2)
    // done 摘要随快照恢复（重载后完成页警示行不丢）
    expect(terminal.cards?.length).toBe(2)
    expect(terminal.droppedCount).toBe(0)
    expect(terminal.lastSeq).toBe(events[events.length - 1]!.seq)
  })

  test('拒收的 send（超限/时机不对）不进 transcript，快照不长脏消息', async () => {
    const { deps } = makeDeps([chatTurn('聊聊？')])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.send('字'.repeat(50_001)) // 超限拒收
    await wizard.send('   ') // 空文本拒收
    expect(wizard.snapshot()?.messages).toEqual([{ role: 'assistant', text: '聊聊？' }])
  })

  test('error 终态快照：phase=error 且 errorMessage 带人话原因', async () => {
    const { deps } = makeDeps([async () => ({ outcome: 'error', error: '模型断了' })])
    const wizard = createPackWizard(deps)
    await wizard.start()
    const snapshot = wizard.snapshot()
    expect(snapshot?.phase).toBe('error')
    expect(snapshot?.errorMessage).toContain('模型断了')
  })

  test('cancel 后快照：phase=cancelled 且 lastSeq 包含 cancelled 事件', async () => {
    const { deps, events } = makeDeps([chatTurn('聊聊？')])
    const wizard = createPackWizard(deps)
    await wizard.start()
    await wizard.cancel()
    const snapshot = wizard.snapshot()
    expect(snapshot?.phase).toBe('cancelled')
    expect(snapshot?.lastSeq).toBe(events[events.length - 1]!.seq)
  })
})

describe('buildWizardOpeningPrompt', () => {
  test('内联命令全文 + 开场指令', () => {
    const p = buildWizardOpeningPrompt('CMD正文')
    expect(p).toContain('<command>')
    expect(p).toContain('CMD正文')
    expect(p).toContain('开始访谈')
  })
})
