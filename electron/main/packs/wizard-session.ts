/**
 * 向导会话执行（拆旧刀2 起 runtime 中立）：pack-wizard.ts 编排层 runTurn 依赖的真实现——
 * resolveAgentRuntime(config) 跟随「创作引擎」配置 + runSandboxSessionLoop 消费归一化事件，
 * 不再碰任何 runtime 原始消息形状。
 *
 * 与 learn-session 同族的沙盒纪律（T1 spike 差异清单落地结论）：
 * - 沙盒收窄：sandbox.tools=['Read','Write','Glob'] / workspaceDir 单目录 / 不设 bypassPermissions
 *   （canUseTool 才会被调用）/ canUseTool=createLearnPathGuard(workspaceDir, { label: '向导' })
 *   运行时路径强制（deny 文案随语境，#482）/
 *   maxTurns=WIZARD_TURN_MAX_TURNS。
 * - 每轮完整重建全套 options（resume 只恢复对话历史，不恢复任何 options）；续轮经
 *   RuntimeRunConfig.resume 契约字段传入、由 adapter 消化（不再手挂 options.resume）。
 * - sessionId 经 adapter.readSessionId 中立捕获（SDK=system:init，pi=首发合成会话消息），error
 *   收尾也不丢、resume 后不变。
 * - 三态映射（T3 契约）：success→success / run.failed reason='max-turns'→truncated（sessionId
 *   保留可续，不是死刑）/ 其余→error（mapper 已产出人话文案，直接透传）。
 *
 * 为什么不放 ipc.ts：比 runLearnSession 多出 sessionId 捕获、assistant 文本透出、三态映射三段逻辑，
 * 且要求对这些行为直接单测——ipc.ts 顶层 import electron，测试进不去；这里用环境依赖注入
 * （WizardSessionEnv）隔离 electron，测试注入假 adapter 走真沙盒入参断言。
 */
import { resolvePrimaryModel } from '@shared/lib/model-slots'
import { createLearnPathGuard } from './learn-path-guard'
import { resolveAgentRuntime } from '../agent/runtime/resolve-runtime'
import type { AgentRuntimeAdapter } from '../agent/runtime/types'
import { runSandboxSessionLoop } from './sandbox-session'
import type { WizardTurnInput, WizardTurnResult } from './pack-wizard'
import type { AppConfig, ProviderId } from '@shared/types/config'

/** 向导单轮最大回合数：一轮=一问一答（顶多加一次产卡 Write），远小于学习会话的通读全书。 */
export const WIZARD_TURN_MAX_TURNS = 16

export interface WizardSessionEnv {
  readConfig: () => Promise<AppConfig>
  getApiKey: (provider: ProviderId) => Promise<string | null>
  appRoot: () => string
  resourcesPath: () => string | undefined
  userDataPath: () => string
  /** 测试注入点（DI 而非 mock.module）：假 adapter 记录 createSandboxedRunOptions 入参 + 脚本化
   * 事件流；生产缺省按「创作引擎」配置逐轮解析。 */
  runtime?: AgentRuntimeAdapter
}

export function createWizardTurnRunner(env: WizardSessionEnv) {
  return async function runWizardTurn(input: WizardTurnInput): Promise<WizardTurnResult> {
    const config = await env.readConfig()
    const primary = resolvePrimaryModel(config)
    const apiKey = primary ? await env.getApiKey(primary.provider) : null
    if (!apiKey) return { outcome: 'error', error: '还没有配置 API Key，请先在设置里填写。' }
    const model = primary?.modelId
    if (!model) return { outcome: 'error', error: '还没有配置可用模型，请先在设置里选择模型。' }

    // abort 桥接（runLearnSession 同款）：内部起新 AbortController 供 runtime 用，转发调用方 signal。
    const abortController = new AbortController()
    const onAbort = () => abortController.abort()
    if (input.signal.aborted) {
      abortController.abort()
    } else {
      input.signal.addEventListener('abort', onAbort, { once: true })
    }

    const runtime = env.runtime ?? resolveAgentRuntime(config)
    try {
      // 每轮完整重建全套沙盒配置（resume 不恢复任何 options）；沙盒收窄纪律与 runLearnSession 一致。
      const options = await runtime.createSandboxedRunOptions({
        config,
        apiKey,
        abortController,
        appRoot: env.appRoot(),
        resourcesPath: env.resourcesPath(),
        userDataPath: env.userDataPath(),
        loadNarraCatRuntime: false,
        projectPath: input.workspaceDir,
        maxTurns: WIZARD_TURN_MAX_TURNS,
        canUseTool: createLearnPathGuard(input.workspaceDir, { label: '向导' }),
        sandbox: { tools: ['Read', 'Write', 'Glob'], workspaceDir: input.workspaceDir },
        ...(input.resumeSessionId ? { resume: input.resumeSessionId } : {}),
      })
      const result = await runSandboxSessionLoop({
        adapter: runtime,
        prompt: input.prompt,
        options,
        onText: input.onAssistantText,
      })
      if (result.outcome === 'success') {
        return { outcome: 'success', ...(result.sessionId ? { sessionId: result.sessionId } : {}) }
      }
      if (result.outcome === 'max-turns') {
        return { outcome: 'truncated', ...(result.sessionId ? { sessionId: result.sessionId } : {}) }
      }
      return { outcome: 'error', error: result.error }
    } catch (error) {
      if (input.signal.aborted) return { outcome: 'error', error: '已取消。' }
      console.error('向导访谈会话运行失败：', error)
      return { outcome: 'error', error: '这轮访谈出了问题，请重试。' }
    } finally {
      input.signal.removeEventListener('abort', onAbort)
    }
  }
}

/**
 * 向导单例装配（T3 前向指针）：一个实例 = 一次访谈会话，终态实例只在 start 入口经 obtainForStart
 * 重建（「再来一次」语义）；get 供 send/cancel 复用当前实例——终态实例的 send 要照实回
 * 「这次向导已结束」，不能悄悄换新实例把语义吞掉。
 *
 * 会话可恢复补充：getSnapshot 只读窥视（无实例返回 null，绝不建实例——快照通道不该有副作用）；
 * dismiss 是「再来一次」的清场动作，仅终态受理丢弃实例引用，防止重载后旧终态快照复活。
 */
export function createWizardProvider<T extends { isFinished: () => boolean; snapshot: () => unknown }>(build: () => T) {
  let current: T | null = null
  return {
    get(): T {
      if (!current) current = build()
      return current
    },
    obtainForStart(): T {
      if (!current || current.isFinished()) current = build()
      return current
    },
    /** 无实例（从没开过 / 终态已 dismiss）返回 null；有实例转交实例快照（未 start 的实例自答 null）。 */
    getSnapshot(): ReturnType<T['snapshot']> | null {
      if (!current) return null
      return current.snapshot() as ReturnType<T['snapshot']>
    },
    /** 仅终态受理：丢弃实例引用；进行中拒绝（不许把活会话清成孤儿）；无实例视为已达成（幂等 ok）。 */
    dismiss(): { ok: true } | { ok: false; message: string } {
      if (!current) return { ok: true }
      if (!current.isFinished()) return { ok: false, message: '这场访谈还没结束，不能清掉。' }
      current = null
      return { ok: true }
    },
  }
}
