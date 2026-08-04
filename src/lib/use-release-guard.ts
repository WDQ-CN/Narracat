import { useEffect, useState } from 'react'
import type { ReleaseGateVerdict } from '@shared/types/ipc'
import { checkReleaseGuard } from './ipc'

/**
 * 内测启动门控状态（#354）：
 * - `pending`：判定还没回来——调用方应渲染最小启动态、**先别放进应用**，
 *   否则 kill / 过期 / 低版本时用户能在这段窗口内进入并触发 Agent 操作。
 * - `allowed`：放行（含主进程拉取失败 fail-open，或本机非 electron 环境）。
 * - `blocked`：命中拦截，带 verdict。
 */
export type ReleaseGuardState =
  | { status: 'pending' }
  | { status: 'allowed' }
  | { status: 'blocked'; verdict: ReleaseGateVerdict }

// 渲染端兜底超时：主进程门控 fetch 自带 4s 超时并总会返回判定；万一主进程卡死，
// 这里给更宽的 8s 后 fail-open 放行，避免把启动永久卡在 pending（不影响正常的 kill 生效）。
const RENDERER_FAILOPEN_MS = 8000

export function useReleaseGuard(): ReleaseGuardState {
  const [state, setState] = useState<ReleaseGuardState>({ status: 'pending' })

  useEffect(() => {
    // 非 electron 环境（测试 / 浏览器）：无门控，直接放行。
    if (typeof window === 'undefined' || !window.electron) {
      setState({ status: 'allowed' })
      return
    }

    let settled = false
    const settle = (next: ReleaseGuardState) => {
      if (settled) return
      settled = true
      setState(next)
    }

    const failOpen = setTimeout(() => settle({ status: 'allowed' }), RENDERER_FAILOPEN_MS)

    checkReleaseGuard()
      .then((verdict) => {
        settle(verdict.blocked ? { status: 'blocked', verdict } : { status: 'allowed' })
      })
      .catch(() => {
        // 查询本身失败 → 放行（fail-open，与主进程一致）
        settle({ status: 'allowed' })
      })

    return () => {
      settled = true
      clearTimeout(failOpen)
    }
  }, [])

  return state
}
