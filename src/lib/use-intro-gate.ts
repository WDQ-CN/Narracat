import { useCallback, useEffect, useState } from 'react'
import { getConfig, saveConfig } from './ipc'

/**
 * 当前首次介绍的版本号。介绍内容大改时 +1，即可让已看过旧版的老用户再看一次。
 * 与 config.introVersion 比较：config 值 < 此值 → 播放介绍。
 */
export const CURRENT_INTRO_VERSION = 2

export type IntroGateStatus = 'loading' | 'intro' | 'ready'

// 与 useReleaseGuard 一致的桥接探测：非 electron（测试 / 浏览器）环境无 IPC 桥。
function hasBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electron)
}

/**
 * 首屏闸门：放行（门控 allowed）后读取 config.introVersion，决定是否先播首次介绍。
 * - loading：config 还没读到，先显示品牌 loading
 * - intro：没看过（或介绍升级了）→ 播 FirstRunIntro
 * - ready：看过了 / 非 electron 环境 → 直接进首页
 */
export function useIntroGate() {
  const [status, setStatus] = useState<IntroGateStatus>('loading')

  useEffect(() => {
    // 非 electron 环境（测试 / 浏览器）：无配置桥，直接进首页，别卡在 loading 也别抛错。
    if (!hasBridge()) {
      setStatus('ready')
      return
    }

    let cancelled = false
    getConfig()
      .then(({ config }) => {
        if (cancelled) return
        setStatus(config.introVersion >= CURRENT_INTRO_VERSION ? 'ready' : 'intro')
      })
      .catch(() => {
        // 读配置失败不该把用户挡在门外，直接进首页。
        if (!cancelled) setStatus('ready')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 看完/跳过介绍：先进首页，再异步回写版本号（回写失败下次重看一次，可接受，不阻塞进入）。
  const complete = useCallback(() => {
    setStatus('ready')
    if (!hasBridge()) return
    getConfig()
      .then(({ config }) => saveConfig({ ...config, introVersion: CURRENT_INTRO_VERSION }))
      .catch(() => {})
  }, [])

  return { status, complete }
}
