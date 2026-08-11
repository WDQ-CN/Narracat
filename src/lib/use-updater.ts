import { useEffect, useState } from 'react'
import type { UpdaterState } from '@shared/types/ipc'
import { getUpdaterState, onUpdaterStateChanged } from './ipc'

const FALLBACK: UpdaterState = {
  status: 'idle',
  currentVersion: '',
  availableVersion: null,
  percent: 0,
  manual: false,
}

/**
 * 更新状态订阅。非 electron 环境（测试 / 浏览器）返回兜底空闲态——
 * 与 use-release-guard 同款姿势，保证组件测试不必 mock window.electron。
 *
 * `enabled=false` 时完全不发起 IPC、不订阅：拦截页三种非「版本过旧」的拦截原因
 * （kill / expired / hard-expired）是刻意停用，靠更新自救没有意义，不该白调一次 IPC。
 */
export function useUpdater(enabled = true): UpdaterState {
  const [state, setState] = useState<UpdaterState>(FALLBACK)

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined' || !window.electron) return

    let alive = true
    getUpdaterState()
      .then((next) => {
        if (alive) setState(next)
      })
      .catch(() => {
        // 拿不到状态 → 保持兜底空闲态，不打扰用户
      })
    const unsubscribe = onUpdaterStateChanged((next) => {
      if (alive) setState(next)
    })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [enabled])

  return state
}
