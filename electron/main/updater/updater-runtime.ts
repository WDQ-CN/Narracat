// 应用内自动更新的副作用层（路线图④）：electron-updater 接线、定时器、事件广播。
// 纯判定在 updater.ts。与 release-guard-runtime.ts 同款分工。
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdaterEvent, UpdaterState } from '@shared/types/updater'
import {
  createInitialUpdaterState,
  nextUpdaterState,
  resolveUpdaterStateForRead,
  shouldRunUpdater,
  UPDATE_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
} from './updater.ts'

// electron-updater 6.x 是纯 CJS 包（无 exports/module 字段），ESM 主进程下 named import
// 可能拿不到绑定。必须 default import 再解构。
const { autoUpdater } = electronUpdater

export const UPDATER_EVENT_CHANNEL = 'updater:event'

let state: UpdaterState = createInitialUpdaterState(app.getVersion())
let started = false
/**
 * 用户在「强制更新」页点了按钮：下载一完成就自动重启安装，不等用户再点一次。
 *
 * ⚠️ 这是「用户刚刚点过一次」的一次性意图，不是长期开关，**必须在三处清掉**：下载完成消费后、
 * 检查失败后、本次检查无可更新版本后。漏清的后果很重：用户点过一次但那次失败了，标记留着，
 * 几小时后某次与他无关的例行检查下载完成，会在他毫无预期时 quitAndInstall 把 App 重启掉——
 * 若他当时在手写正文（非 Agent run，没有退出确认框拦截），改动直接丢失。
 * 这与「退出时才安装，绝不在用户工作中途重启」的设计意图正面冲突。
 */
let autoInstallWhenReady = false
const senders = new Set<{ send: (channel: string, payload: unknown) => void }>()

export function getUpdaterState(): UpdaterState {
  return resolveUpdaterStateForRead({
    state,
    isPackaged: app.isPackaged,
    previewReadyEnv: process.env.NARRACAT_UPDATE_PREVIEW_READY,
  })
}

export function subscribeUpdaterSender(sender: { send: (channel: string, payload: unknown) => void }): void {
  senders.add(sender)
}

function apply(event: UpdaterEvent): void {
  state = nextUpdaterState(state, event)
  for (const sender of senders) {
    try {
      sender.send(UPDATER_EVENT_CHANNEL, state)
    } catch {
      // 窗口已销毁 → 丢弃，不影响主进程
      senders.delete(sender)
    }
  }
}

export function startUpdater(): void {
  if (started) return
  if (!shouldRunUpdater({ isPackaged: app.isPackaged, platform: process.platform })) return
  started = true

  autoUpdater.autoDownload = true
  // 退出时才安装，绝不在用户工作中途重启。
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.setFeedURL({ provider: 'generic', url: resolveFeedUrl() })
  // 屏蔽 info/debug/warn 噪声，但必须保留 error——本项目最怕静默失效，这是自动更新在真机上
  // 唯一的诊断线。`autoUpdater.logger = null` 看似「关日志」，实际是 AppUpdater.js 的 setter
  // `value == null ? new NoOpLogger() : value`：传 null 会连 error 一起吞掉，feed URL 写歪 /
  // R2 404 / sha512 不符 / Squirrel 拒装在真机上会一条痕迹都不留。
  autoUpdater.logger = {
    info() {},
    debug() {},
    warn() {},
    error: (message: unknown) => console.error('[updater]', message),
  }

  autoUpdater.on('update-available', (info: { version: string }) => {
    apply({ type: 'update-available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    // 这次检查没有可更新版本 → 用户那次「立即更新」的意图到此为止，清掉自动安装标记。
    autoInstallWhenReady = false
    apply({ type: 'update-not-available' })
  })
  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    apply({ type: 'download-progress', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    apply({ type: 'update-downloaded', version: info.version })
    // 消费即清：这个标记只代表「用户刚刚点过一次立即更新」，不是长期开关。
    if (autoInstallWhenReady) {
      autoInstallWhenReady = false
      void installUpdateNow()
    }
  })
  autoUpdater.on('error', () => {
    // 断网 / 超时 / 校验失败 → 记进状态；是否让用户看见由渲染端 describeUpdateStatus 按 manual 决定。
    // 同时清掉自动安装标记：用户那次「立即更新」已经失败了，意图不该跨到下一次检查。
    autoInstallWhenReady = false
    apply({ type: 'error' })
  })

  setTimeout(() => {
    void checkForUpdatesNow(false)
    setInterval(() => void checkForUpdatesNow(false), UPDATE_CHECK_INTERVAL_MS)
  }, UPDATE_CHECK_DELAY_MS)
}

function resolveFeedUrl(): string {
  const override = process.env.NARRACAT_UPDATE_FEED_URL?.trim()
  if (override) return override
  // 按平台派生目录：darwin → mac-arm64，win32 → win-x64（其余平台已被外层 shouldRunUpdater()
  // 拦掉，理论到不了这里，仍给 darwin 兜底防御式失败而不是抛错）。
  // 与 scripts/update-feed.mjs 的 MAC_PLATFORM_DIR 同值。那边是发版脚本（.mjs），
  // 这里是主进程 TS，两边不互相 import，改动时须同步——update-feed.test.mjs 用文本 grep 钉住这份。
  const platformDir = process.platform === 'win32' ? 'win-x64' : 'mac-arm64'
  return `https://update.narracat.com/${platformDir}`
}

export async function checkForUpdatesNow(manual: boolean): Promise<void> {
  if (!started) return
  apply({ type: 'check-started', manual })
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // 不要在这里再 apply 一次 error：electron-updater 的 checkForUpdates() 失败时会先
    // emit('error') 再 rethrow（见 electron-updater/out/AppUpdater.js），上面注册的 error
    // 监听器已经把状态推到 error 并清了 autoInstallWhenReady。这里再 apply 会让所有订阅窗口
    // 收到两次相同广播。此处只吞异常。
  }
}

export async function installUpdateNow(): Promise<void> {
  if (!started) return
  if (state.status === 'ready') {
    // 第二个参数 isForceRunAfter=true：装完自动拉起，用户不必手动再开一次。
    autoUpdater.quitAndInstall(false, true)
    return
  }
  autoInstallWhenReady = true
  await checkForUpdatesNow(true)
}
