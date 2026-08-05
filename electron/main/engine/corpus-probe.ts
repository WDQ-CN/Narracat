import { resolveCorpusClientEnv } from './corpus-service.ts'
import type { CorpusHealthProbeResult } from '@shared/types/narracat'

const DEFAULT_CORPUS_URL = 'https://corpus.narracat.com'
const FETCH_TIMEOUT_MS = 4000

export async function runCorpusHealthProbe(): Promise<CorpusHealthProbeResult> {
  const cfg = resolveCorpusClientEnv()
  if (cfg.dir) return { ok: true, mode: 'local', summary: '本地语料目录模式（维护者开发态）' }
  if (!cfg.token) {
    return { ok: false, mode: 'disabled', summary: '未配置语料服务凭证，写作将不注入真人范例（其他功能不受影响）' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`${cfg.url ?? DEFAULT_CORPUS_URL}/v1/health`, {
      headers: { authorization: `Bearer ${cfg.token}` },
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, mode: 'remote', summary: `语料服务响应异常（HTTP ${response.status}）` }
    const json = (await response.json()) as { ok?: boolean; total_entries?: number }
    if (!json.ok) return { ok: false, mode: 'remote', summary: '语料服务响应异常（负载不合法）' }
    return { ok: true, mode: 'remote', summary: `语料服务连通，共 ${json.total_entries ?? '?'} 条范例`, totalEntries: json.total_entries }
  } catch {
    return { ok: false, mode: 'remote', summary: '语料服务不可达（超时或网络异常），写作将暂不注入范例' }
  } finally {
    clearTimeout(timer)
  }
}
