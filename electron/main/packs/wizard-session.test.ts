/**
 * 向导会话执行单测（拆旧刀2 起 runtime 中立）：假 adapter DI（不用 mock.module——天然避开活绑定
 * 自引用死循环 footgun），逐条验沙盒契约入参、sessionId 捕获、resume 契约字段传递、三态 outcome
 * 映射、流中途抛错不外溢。SDK 最终 Options 形状（permissionMode/persistSession 等）归 claude-sdk
 * adapter 自己的测试管，此处只锁传给 adapter 的 RuntimeSandboxRunConfig。
 */
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import {
  WIZARD_TURN_MAX_TURNS,
  createWizardProvider,
  createWizardTurnRunner,
  type WizardSessionEnv,
} from './wizard-session'
import type { WizardTurnInput } from './pack-wizard'
import type { AgentEvent } from '@shared/types/agent'
import type { AgentRuntimeAdapter, RuntimeCanUseTool, RuntimeSandboxRunConfig } from '../agent/runtime/types'
import type { AppConfig } from '@shared/types/config'
import { POOL_DEFAULT_FIELDS } from '@shared/types/config'

let workspaceDir: string
beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), 'narracat-wizard-session-test-'))
})
afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true })
})

const apiKeyUpdatedAt = '2026-07-21T00:00:00.000Z'

const config: AppConfig = {
  ...POOL_DEFAULT_FIELDS,
  apiKeyMetadata: {
    deepseek: { updatedAt: apiKeyUpdatedAt },
  },
  novelRootDir: '/tmp/novels',
  recentNovelPaths: [],
  systemNotificationsEnabled: true,
}

const at = '2026-08-02T00:00:00.000Z'
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

/** 一次 startRun 的脚本：首个 raw 上可读出 sessionId，batches 逐批经 mapMessage 变 AgentEvent。 */
interface FakeRun {
  sessionId?: string
  batches: AgentEvent[][]
  throwMidStream?: boolean
}

function makeEnv(input: { runs?: FakeRun[]; overrides?: Partial<WizardSessionEnv> }) {
  const captured: RuntimeSandboxRunConfig[] = []
  const prompts: string[] = []
  const runtime: AgentRuntimeAdapter = {
    id: 'pi',
    createRunOptions: async () => ({}),
    createSandboxedRunOptions: async (args) => {
      captured.push(args)
      return { run: captured.length - 1 }
    },
    async *startRun(args) {
      prompts.push(args.prompt as string)
      const index = (args.options as { run: number }).run
      const run = input.runs?.[index]
      if (!run) return
      for (let batch = 0; batch < run.batches.length; batch += 1) {
        yield { run: index, batch }
        if (run.throwMidStream) throw new Error('socket hang up')
      }
    },
    mapMessage: (message) => {
      const raw = message as { run: number; batch: number }
      return input.runs?.[raw.run]?.batches[raw.batch] ?? []
    },
    readSessionId: (message) => {
      const raw = message as { run: number; batch: number }
      return raw.batch === 0 ? input.runs?.[raw.run]?.sessionId : undefined
    },
  }
  const env: WizardSessionEnv = {
    readConfig: async () => config,
    getApiKey: async () => 'sk-test-key',
    appRoot: () => '/app',
    resourcesPath: () => undefined,
    userDataPath: () => '/tmp/user-data',
    runtime,
    ...input.overrides,
  }
  return { env, captured, prompts }
}

function makeTurnInput(overrides: Partial<WizardTurnInput> = {}): WizardTurnInput & { assistantTexts: string[] } {
  const assistantTexts: string[] = []
  return {
    workspaceDir,
    resumeSessionId: null,
    prompt: '开始访谈。',
    signal: new AbortController().signal,
    onAssistantText: (text) => assistantTexts.push(text),
    assistantTexts,
    ...overrides,
  }
}

describe('createWizardTurnRunner', () => {
  test('success 全径：sessionId 中立捕获、文本按段落透出、沙盒契约入参齐', async () => {
    const { env, captured, prompts } = makeEnv({
      runs: [
        {
          sessionId: 'session-1',
          batches: [[delta('你想沉淀什么写法？')], [toolStarted()], [delta('举个例子也行。'), completed()]],
        },
      ],
    })
    const turnInput = makeTurnInput()
    const result = await createWizardTurnRunner(env)(turnInput)

    expect(result).toEqual({ outcome: 'success', sessionId: 'session-1' })
    // 文本段落语义：tool.started 边界 flush，末段随终态 flush
    expect(turnInput.assistantTexts).toEqual(['你想沉淀什么写法？', '举个例子也行。'])

    expect(prompts).toEqual(['开始访谈。'])
    expect(captured.length).toBe(1)
    const args = captured[0]
    // 沙盒契约（传给 adapter 的 RuntimeSandboxRunConfig）
    expect(args.sandbox).toEqual({ tools: ['Read', 'Write', 'Glob'], workspaceDir })
    expect(args.projectPath).toBe(workspaceDir)
    expect(args.maxTurns).toBe(WIZARD_TURN_MAX_TURNS)
    expect(args.loadNarraCatRuntime).toBe(false)
    expect(args.resume).toBeUndefined() // 首轮不带 resume
    expect(args.apiKey).toBe('sk-test-key')

    // canUseTool 是绑定本工作区的路径守卫：越界 Write 被 deny，界内放行
    const guard = args.canUseTool as RuntimeCanUseTool
    const guardOptions = { toolUseID: 'tool-1', signal: new AbortController().signal }
    const denied = await guard('Write', { file_path: '/etc/hosts' }, guardOptions)
    expect(denied.behavior).toBe('deny')
    const allowed = await guard('Write', { file_path: join(realpathSync(workspaceDir), 'output', 'cards.json') }, guardOptions)
    expect(allowed.behavior).toBe('allow')
  })

  test('resume 续轮：RuntimeRunConfig.resume 契约字段透传 sessionId，全套沙盒配置每轮完整重建', async () => {
    const { env, captured } = makeEnv({
      runs: [
        { sessionId: 'session-1', batches: [[completed()]] },
        { sessionId: 'session-1', batches: [[completed()]] },
      ],
    })
    const runTurn = createWizardTurnRunner(env)
    await runTurn(makeTurnInput())
    const result = await runTurn(makeTurnInput({ resumeSessionId: 'session-1', prompt: '接着说' }))

    expect(result).toEqual({ outcome: 'success', sessionId: 'session-1' })
    expect(captured.length).toBe(2)
    expect(captured[0].resume).toBeUndefined()
    expect(captured[1].resume).toBe('session-1')
    // resume 只恢复对话历史，不恢复 options——续轮沙盒必须完整重建
    expect(captured[1]).not.toBe(captured[0])
    expect(captured[1].sandbox).toEqual({ tools: ['Read', 'Write', 'Glob'], workspaceDir })
    expect(captured[1].canUseTool).toBeFunction()
    expect(captured[1].maxTurns).toBe(WIZARD_TURN_MAX_TURNS)
  })

  test('run.failed reason=max-turns → truncated（sessionId 保留可续）', async () => {
    const { env } = makeEnv({
      runs: [{ sessionId: 'session-t', batches: [[failed('Agent 本次运行达到回合上限，请稍后重试或提高运行上限。', 'max-turns')]] }],
    })
    const result = await createWizardTurnRunner(env)(makeTurnInput())
    expect(result).toEqual({ outcome: 'truncated', sessionId: 'session-t' })
  })

  test('普通 run.failed → error：mapper 产出的人话文案直接透传', async () => {
    const { env } = makeEnv({
      runs: [{ sessionId: 'session-e', batches: [[failed('模型接口 500')]] }],
    })
    const result = await createWizardTurnRunner(env)(makeTurnInput())
    expect(result).toEqual({ outcome: 'error', error: '模型接口 500' })
  })

  test('流中途抛错（未到终态）→ error 兜底文案；signal 已 abort → 「已取消。」', async () => {
    const crashing = makeEnv({
      runs: [{ sessionId: 'session-c', batches: [[delta('半截')], [completed()]], throwMidStream: true }],
    })
    const crashed = await createWizardTurnRunner(crashing.env)(makeTurnInput())
    expect(crashed).toEqual({ outcome: 'error', error: '这轮访谈出了问题，请重试。' })

    const abortController = new AbortController()
    abortController.abort()
    const abortingEnv = makeEnv({
      runs: [{ sessionId: 'session-c', batches: [[delta('半截')]], throwMidStream: true }],
    })
    const aborted = await createWizardTurnRunner(abortingEnv.env)(makeTurnInput({ signal: abortController.signal }))
    expect(aborted).toEqual({ outcome: 'error', error: '已取消。' })
  })

  test('流正常结束但没有终态事件 → error（没有正常收尾）', async () => {
    const { env } = makeEnv({ runs: [{ sessionId: 'session-n', batches: [[delta('只说了一半')]] }] })
    const result = await createWizardTurnRunner(env)(makeTurnInput())
    expect(result).toEqual({ outcome: 'error', error: '会话没有正常收尾，请重试。' })
  })

  test('缺 API Key / 缺模型 → error，且不发起会话', async () => {
    const noKey = makeEnv({ runs: [], overrides: { getApiKey: async () => null } })
    const noKeyResult = await createWizardTurnRunner(noKey.env)(makeTurnInput())
    expect(noKeyResult.outcome).toBe('error')
    expect(noKey.captured.length).toBe(0)

    const noModel = makeEnv({
      runs: [],
      overrides: { readConfig: async () => ({ ...config, modelPool: [], primaryModelKey: null }) },
    })
    const noModelResult = await createWizardTurnRunner(noModel.env)(makeTurnInput())
    expect(noModelResult.outcome).toBe('error')
    expect(noModel.captured.length).toBe(0)
  })
})

describe('createWizardProvider', () => {
  function makeProvider() {
    let builds = 0
    let finished = false
    const provider = createWizardProvider(() => {
      const id = (builds += 1)
      return { id, isFinished: () => finished, snapshot: () => ({ from: id }) }
    })
    return { provider, getBuilds: () => builds, setFinished: (value: boolean) => { finished = value } }
  }

  test('get 惰性单建复用；obtainForStart 只在无实例/终态实例时重建（「再来一次」），进行中实例不换', () => {
    const { provider, getBuilds, setFinished } = makeProvider()

    const first = provider.get()
    expect(getBuilds()).toBe(1)
    expect(provider.get()).toBe(first) // get 复用
    expect(provider.obtainForStart()).toBe(first) // 未终态不重建
    expect(getBuilds()).toBe(1)

    setFinished(true)
    expect(provider.get()).toBe(first) // get 终态也不重建（send/cancel 要拿到原实例照实回终态）
    const second = provider.obtainForStart() // 终态 → start 入口重建
    expect(getBuilds()).toBe(2)
    expect(second).not.toBe(first)
    expect(second.id).toBe(2)

    setFinished(false)
    expect(provider.obtainForStart()).toBe(second)
    expect(getBuilds()).toBe(2)
  })

  test('getSnapshot：无实例返回 null 且不建实例（只读无副作用）；有实例转交实例快照', () => {
    const { provider, getBuilds } = makeProvider()
    expect(provider.getSnapshot()).toBeNull()
    expect(getBuilds()).toBe(0) // 快照通道不许有「建实例」副作用

    provider.get()
    expect(provider.getSnapshot()).toEqual({ from: 1 })
  })

  test('dismiss 仅终态受理：非终态拒绝且实例保留；终态丢引用（快照转 null、get 再取是新实例）；无实例幂等 ok', () => {
    const { provider, getBuilds, setFinished } = makeProvider()
    expect(provider.dismiss()).toEqual({ ok: true }) // 无实例：目标已达成，幂等 ok
    expect(getBuilds()).toBe(0)

    const first = provider.get()
    const rejected = provider.dismiss() // 进行中拒绝，不许把活会话清成孤儿
    expect(rejected.ok).toBe(false)
    expect(provider.get()).toBe(first)

    setFinished(true)
    expect(provider.dismiss()).toEqual({ ok: true })
    expect(provider.getSnapshot()).toBeNull() // 重载后旧终态不再复活
    setFinished(false)
    expect(provider.get().id).toBe(2) // 引用已丢，惰性重建新实例
  })
})
