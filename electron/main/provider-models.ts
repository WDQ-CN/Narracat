/**
 * 渠道模型清单拉取：anthropic wire 的 GET /v1/models。各家兼容端点不保证支持——
 * 一切失败（网络/状态码/形态不符）都收敛为 ok:false，由 UI 静默回落内置目录，绝不抛出。
 * fetchImpl 参数是测试注入点（DI 而非 mock.module，仓库惯例）。
 */
import type { ProviderModelListResult } from '@shared/types/ipc'
import { redactErrorMessage } from './redact.ts'

const ANTHROPIC_OFFICIAL_BASE_URL = 'https://api.anthropic.com'
const LIST_MODELS_TIMEOUT_MS = 10_000

export async function fetchProviderModels(
  input: { baseUrl: string; apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderModelListResult> {
  const base = (input.baseUrl || ANTHROPIC_OFFICIAL_BASE_URL).replace(/\/$/, '')
  try {
    const response = await fetchImpl(`${base}/v1/models`, {
      headers: {
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS),
    })
    if (!response.ok) {
      return { ok: false, message: `该服务商暂不支持拉取模型清单（HTTP ${response.status}）。` }
    }
    const payload = (await response.json()) as { data?: Array<{ id?: unknown }> }
    if (!Array.isArray(payload?.data)) {
      return { ok: false, message: '该服务商返回的清单格式无法识别。' }
    }
    const seen = new Set<string>()
    const models: string[] = []
    for (const item of payload.data) {
      if (typeof item?.id !== 'string' || !item.id.trim() || seen.has(item.id)) continue
      seen.add(item.id)
      models.push(item.id)
    }
    return { ok: true, models }
  } catch (error) {
    return { ok: false, message: `拉取模型清单失败：${redactErrorMessage(error)}` }
  }
}
