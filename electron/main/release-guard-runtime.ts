// 内测软过期 + 远程急刹车的副作用层（#354）：读 app 版本、拉远程 JSON、读构建期注入，
// 把它们喂给 release-guard.ts 的纯判定 decideReleaseGate。纯逻辑与单测在 release-guard.ts。
import { app } from 'electron'
import { decideReleaseGate, type ReleaseGateConfig, type ReleaseGateVerdict } from './release-guard.ts'

// 构建期注入（electron.vite.config.ts main.define）：构建那一刻的 ISO 时间。
// 未注入（如 bun 单测、未走 vite 的环境）时按「无硬过期」处理。
declare const __NARRACAT_BUILD_TIME__: string | undefined

/** 已部署的 release-guard Worker（见 workers/release-guard/README.md）；可用 NARRACAT_RELEASE_GUARD_URL 覆盖。 */
const RELEASE_GUARD_URL = 'https://narracat-release-guard.lumoslabs.workers.dev'
/** 仍是占位 URL 时跳过远程拉取（避免开发态对占位地址发无谓请求）。 */
const PLACEHOLDER_URL = 'https://narracat-release-guard.example.workers.dev'
const FETCH_TIMEOUT_MS = 4000

function readBuildTimeMs(): number | null {
  const injected = typeof __NARRACAT_BUILD_TIME__ === 'string' ? __NARRACAT_BUILD_TIME__.trim() : ''
  if (!injected) return null
  const ms = Date.parse(injected)
  return Number.isFinite(ms) ? ms : null
}

async function fetchRemoteGate(url: string): Promise<ReleaseGateConfig | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const json = (await response.json()) as unknown
    if (!json || typeof json !== 'object') return null
    return json as ReleaseGateConfig
  } catch {
    // 断网 / 超时 / 解析失败 → fail-open
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 启动门控：拉远程配置 + 本地构建期硬过期，算出最终判定。 */
export async function evaluateReleaseGuard(): Promise<ReleaseGateVerdict> {
  const url = process.env.NARRACAT_RELEASE_GUARD_URL?.trim() || RELEASE_GUARD_URL
  const remote = url && url !== PLACEHOLDER_URL ? await fetchRemoteGate(url) : null
  return decideReleaseGate({
    currentVersion: app.getVersion(),
    nowMs: Date.now(),
    buildTimeMs: readBuildTimeMs(),
    remote,
  })
}
