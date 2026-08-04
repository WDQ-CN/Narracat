import type { AppConfig, ProviderId } from '../../config.ts'
import { findUnsafeApiKeyCharacter, isModelServiceVerified, UNSAFE_API_KEY_MESSAGE } from '../../config.ts'
import { resolvePrimaryModel } from '@shared/lib/model-slots'
import type { AgentEvent } from '@shared/types/agent'

type TerminalFailureEvent = Extract<AgentEvent, { type: 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.interrupted' }>

export interface RunPreconditionsDeps {
  runId: string
  abortController: AbortController
  readConfig: () => Promise<AppConfig>
  getApiKey: (provider: ProviderId) => Promise<string | null>
  canContinueRun: (runId: string, abortController: AbortController) => boolean
  /** run 在准备阶段被取消（还没进入 streamSdkRun）时收尾：发布取消/中断终态事件。 */
  finalizeCancelledPreparation: (runId: string, abortController: AbortController) => Promise<void>
  publishTerminalAfterSettle: (
    runId: string,
    abortController: AbortController,
    event: TerminalFailureEvent,
  ) => Promise<boolean>
  now: () => string
}

export type RunPreconditionsResult = { ok: true; config: AppConfig; apiKey: string } | { ok: false }

/**
 * startRun 进入六条路径选择之前的共享前置校验链：读配置 → 模型服务已验证 → 取 API Key → Key 不含
 * 非 ASCII 字符（旧版可能已存入未校验的 Key，进请求头会崩成看不懂的 "API Error: ByteString"，这里
 * 提前拦下给出可操作提示）。从 run-manager.ts startRun 原样迁出，每步失败/取消的终态事件发布语义
 * 逐字保留：readConfig 和 getApiKey 后各有一次 canContinueRun 复检（取消走
 * finalizeCancelledPreparation），模型未验证/无 Key/Key 非法三种真实失败都走
 * publishTerminalAfterSettle 发 run.failed。调用方只需判 `result.ok`。
 */
export async function resolveRunPreconditions(deps: RunPreconditionsDeps): Promise<RunPreconditionsResult> {
  const { runId, abortController, readConfig, getApiKey, canContinueRun, finalizeCancelledPreparation, publishTerminalAfterSettle, now } =
    deps

  const config = await readConfig()
  if (!canContinueRun(runId, abortController)) {
    await finalizeCancelledPreparation(runId, abortController)
    return { ok: false }
  }

  if (!isModelServiceVerified(config)) {
    await publishTerminalAfterSettle(runId, abortController, {
      type: 'run.failed',
      runId,
      error: '模型服务尚未验证。请先在设置中完成“测试连接”。',
      reason: 'model-service-required',
      provider: resolvePrimaryModel(config)?.provider ?? 'deepseek',
      createdAt: now(),
    })
    return { ok: false }
  }

  // 验证门已过：isModelServiceVerified 语义即「主力槽已解析且已验证」，此处主力必非空。
  const primary = resolvePrimaryModel(config)!
  const apiKey = await getApiKey(primary.provider)
  if (!canContinueRun(runId, abortController)) {
    await finalizeCancelledPreparation(runId, abortController)
    return { ok: false }
  }

  if (!apiKey) {
    await publishTerminalAfterSettle(runId, abortController, {
      type: 'run.failed',
      runId,
      error: `未配置 ${primary.provider} API Key。请先在设置中保存密钥后再运行 Agent。`,
      createdAt: now(),
    })
    return { ok: false }
  }

  // 旧版可能已存入含非 ASCII 字符的 Key（保存时未校验）。这种 Key 进请求头必崩，
  // 这里提前拦下，给出可操作提示，替代看不懂的 "API Error: ByteString"。
  if (findUnsafeApiKeyCharacter(apiKey)) {
    await publishTerminalAfterSettle(runId, abortController, {
      type: 'run.failed',
      runId,
      error: UNSAFE_API_KEY_MESSAGE,
      createdAt: now(),
    })
    return { ok: false }
  }

  return { ok: true, config, apiKey }
}
