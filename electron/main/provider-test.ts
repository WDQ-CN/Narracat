import { findPoolEntry } from '@shared/lib/model-slots'
import type { AppConfig } from './config.ts'
import { normalizeAppConfig } from './config.ts'
import { resolveAgentRuntime } from './agent/runtime/resolve-runtime.ts'
import { runSandboxSessionLoop } from './packs/sandbox-session.ts'
import { redactErrorMessage } from './redact.ts'

export interface ConnectionTestResult {
  ok: boolean
  message: string
  model?: string
  verifiedAt?: string
}

export interface ProviderConnectionRuntime {
  appRoot: string
  cwd: string
  resourcesPath?: string
}

/**
 * 「测试连接」连通性测试（拆旧刀5 迁 pi 底座）：与创作链同一 runtime/Provider 装配跑一回合
 * 极小 run（Reply OK），成功即证 baseUrl/apiKey/model 三件套可用。不挂引擎运行时、不持久会话
 * 由 adapter 对 in-memory 会话的缺省语义承担。
 */
export async function testProviderConnection(
  config: AppConfig,
  apiKey: string,
  modelKey: string,
  runtime: ProviderConnectionRuntime,
): Promise<ConnectionTestResult> {
  const entry = findPoolEntry(config, modelKey)
  if (!entry) {
    return { ok: false, message: '待测试的模型不在模型池中，请先添加。' }
  }
  const model = entry.modelId
  // 临时把主力槽指到待测条目：createRunOptions/createPiModel 沿主力槽装配，无需改 runtime 接口。
  const testConfig = normalizeAppConfig({ ...config, primaryModelKey: modelKey, lightModelKey: null })

  try {
    const adapter = resolveAgentRuntime(testConfig)
    const options = await adapter.createRunOptions({
      config: testConfig,
      apiKey,
      abortController: new AbortController(),
      appRoot: runtime.appRoot,
      resourcesPath: runtime.resourcesPath,
      userDataPath: runtime.cwd,
      projectPath: runtime.cwd,
      loadNarraCatRuntime: false,
      maxTurns: 1,
    })
    const result = await runSandboxSessionLoop({
      adapter,
      prompt: 'Reply with exactly: OK',
      options,
    })
    if (result.outcome === 'success') return { ok: true, message: '连接成功。', model }
    if (result.outcome === 'max-turns') return { ok: true, message: '连接成功。', model }
    return { ok: false, message: `连接失败：${redactErrorMessage(new Error(result.error))}`, model }
  } catch (error) {
    return { ok: false, message: `连接失败：${redactErrorMessage(error)}`, model }
  }
}
