// 应用内自动更新的纯判定逻辑（路线图④）。
// 刻意不依赖 electron / electron-updater / 定时器——副作用全在 updater-runtime.ts。
// 与 release-guard.ts 同款分离，单测可在任意顺序下直接 import。
import type { UpdaterEvent, UpdaterState } from '@shared/types/updater'

export type { UpdaterEvent, UpdaterState, UpdaterStatus } from '@shared/types/updater'

/** 启动后延迟这么久才查第一次：避开冷启动时与 Agent runtime、记忆库的资源争抢。 */
export const UPDATE_CHECK_DELAY_MS = 30_000
/** 之后的轮询间隔。 */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/** 目前支持自动更新的平台。updater-runtime.ts 的 resolveFeedUrl() 已按平台派生目录，
 * Windows 战役落位时无需再改这里。 */
const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32'])

export function createInitialUpdaterState(currentVersion: string): UpdaterState {
  return { status: 'idle', currentVersion, availableVersion: null, percent: 0, manual: false }
}

export function nextUpdaterState(prev: UpdaterState, event: UpdaterEvent): UpdaterState {
  // 不变式：ready 是粘性状态。更新已下载完、只等用户重启，此后任何事件都不能把它
  // 打回 checking / downloading / idle / error。
  // 为什么必须统一守：每 4h 的例行检查照常打进来，而 app 未重启 → currentVersion 仍是旧版
  // → 必然又判定「有新版可用」。不守就会 ready → checking → downloading(percent 0) → ready
  // 来回跳，用户看到的「已就绪，重启生效」周期性消失又出现。只有重启（进程重来）能清除它。
  if (prev.status === 'ready') return prev

  switch (event.type) {
    case 'check-started':
      return { ...prev, status: 'checking', manual: event.manual }
    case 'update-available':
      // autoDownload 开着，发现即开始下载，不经过「询问用户」这一档。
      return { ...prev, status: 'downloading', availableVersion: event.version, percent: 0 }
    case 'update-not-available':
      return { ...prev, status: 'idle', availableVersion: null, percent: 0 }
    case 'download-progress':
      return { ...prev, status: 'downloading', percent: clampPercent(event.percent) }
    case 'update-downloaded':
      return { ...prev, status: 'ready', availableVersion: event.version, percent: 100 }
    case 'error':
      return { ...prev, status: 'error' }
  }
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, Math.floor(percent)))
}

/** 开发态不启用（避免开发噪声与无意义请求），未支持平台不启用。 */
export function shouldRunUpdater(input: { isPackaged: boolean; platform: string }): boolean {
  return input.isPackaged && SUPPORTED_PLATFORMS.has(input.platform)
}

/**
 * `updater:get-state` IPC 的读出判定（spec §6.1 开发预览开关）。updater 开发态整体不启动
 * （`shouldRunUpdater` 恒 false），渲染端因此永远看不到 banner；`NARRACAT_UPDATE_PREVIEW_READY=1`
 * 让非打包态把状态假装成「已就绪」，仅用于本地预览 banner 外观。
 *
 * 渲染端读不到 `process.env`（electron-vite 未注入、无 contextBridge 通道），所以判定必须落在
 * 主进程侧，经既有 `updater:get-state` IPC 传下去，而不是让渲染端自己猜环境变量。
 * 生产路径零影响：`isPackaged` 为 true 时 `&&` 短路，不读 env、原样返回真实 state。
 */
export function resolveUpdaterStateForRead(input: {
  state: UpdaterState
  isPackaged: boolean
  previewReadyEnv: string | undefined
}): UpdaterState {
  if (input.isPackaged || input.previewReadyEnv !== '1') return input.state
  return {
    status: 'ready',
    currentVersion: input.state.currentVersion,
    availableVersion: input.state.availableVersion ?? `${input.state.currentVersion}-preview`,
    percent: 100,
    manual: false,
  }
}
