// 内测软过期 + 远程急刹车的纯判定逻辑（#354）。
// 刻意不依赖 electron / fetch / 构建期注入——这些副作用在 release-guard-runtime.ts。
// 保持本文件纯净，单测可在任意顺序下直接 import，无需 mock electron。
import type { ReleaseGateConfig, ReleaseGateVerdict } from '@shared/types/release-guard'

export type { ReleaseGateConfig, ReleaseGateReason, ReleaseGateVerdict } from '@shared/types/release-guard'

export const DEFAULT_NOTICE = '内测已结束或此版本已停用。请关注 narracat.com 获取最新版本。'
export const HARD_EXPIRY_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

export interface DecideReleaseGateInput {
  /** 当前 App 版本（app.getVersion()）。 */
  currentVersion: string
  /** 当前时刻（Date.now()）。 */
  nowMs: number
  /** 构建时刻（ms）；null 表示无构建期注入（不启用硬过期）。 */
  buildTimeMs: number | null
  /** 硬过期天数，默认 90。 */
  hardExpiryDays?: number
  /** 远程门控配置；null 表示拉取失败 → fail-open（仅硬过期兜底仍生效）。 */
  remote: ReleaseGateConfig | null
}

/** 纯判定：给定输入算出拦不拦、为什么拦、给用户看什么文案。 */
export function decideReleaseGate(input: DecideReleaseGateInput): ReleaseGateVerdict {
  const { currentVersion, nowMs, buildTimeMs, remote } = input
  const hardExpiryDays = input.hardExpiryDays ?? HARD_EXPIRY_DAYS
  const notice = remote?.notice?.trim() || DEFAULT_NOTICE

  // 1) 硬过期兜底：不依赖远程，断网 / 被屏蔽也生效。
  if (buildTimeMs != null && Number.isFinite(buildTimeMs)) {
    const hardExpiryMs = buildTimeMs + hardExpiryDays * DAY_MS
    if (nowMs >= hardExpiryMs) {
      return { blocked: true, reason: 'hard-expired', notice }
    }
  }

  // 拉取失败 → fail-open（除上面的硬过期外不拦）。
  if (!remote) return { blocked: false, reason: null, notice: '' }

  // 2) 急刹车。
  if (remote.kill === true) return { blocked: true, reason: 'kill', notice }

  // 3) 截止日。
  const deadline = remote.deadline?.trim()
  if (deadline) {
    const deadlineMs = Date.parse(deadline)
    if (Number.isFinite(deadlineMs) && nowMs >= deadlineMs) {
      return { blocked: true, reason: 'expired', notice }
    }
  }

  // 4) 最低版本。
  const minVersion = remote.minVersion?.trim()
  if (minVersion && compareSemver(currentVersion, minVersion) < 0) {
    return { blocked: true, reason: 'min-version', notice }
  }

  return { blocked: false, reason: null, notice: '' }
}

/** 极简 semver 比较：仅取 主.次.补 三段数字，忽略 prerelease / build。a<b → -1，相等 → 0，a>b → 1。 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

function parseSemver(version: string): [number, number, number] {
  const parts = version
    .trim()
    .replace(/^v/, '')
    .split('.')
    .slice(0, 3)
    .map((part) => {
      const n = Number.parseInt(part, 10)
      return Number.isFinite(n) ? n : 0
    })
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}
