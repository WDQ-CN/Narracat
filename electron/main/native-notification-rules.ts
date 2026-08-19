// 原生通知的判断与文案：要不要弹、弹什么字、点了之后怎么把窗口带回前台。
//
// 这一层刻意不 import electron——它全是纯函数，依赖由调用方注入。electron 绑定住在
// native-notifications.ts。分开的理由不是洁癖：`electron` 在测试里靠 mock.module 顶替，
// 而 mock.module 是全进程注册表、先注册的那份决定模块形状，于是「A 测试 mock 的 electron
// 少一个具名导出，B 测试的被测模块正好静态 import 了它」会变成跑序敏感的炸弹——本机绿、
// Linux CI 红。纯函数与平台绑定分开之后，测这一层根本不需要碰 electron。

import type { ResultNotification } from '@shared/types/notifications'

export const OPEN_RESULT_NOTIFICATION_CHANNEL = 'notifications:open-result'

export type NativeNotificationPlatform = NodeJS.Platform | 'linux'

export interface NativeNotificationLike {
  on: (eventName: 'click', handler: () => void) => void
  show: () => void
}

export interface NativeResultNotificationDeps {
  appActive: boolean
  createNotification: (options: { title: string; body: string }) => NativeNotificationLike
  enabled: boolean
  notificationSupported: boolean
  openNotification: (notification: ResultNotification) => void
  platform: NativeNotificationPlatform
}

export interface NativeResultNotificationDecision {
  appActive: boolean
  enabled: boolean
  notificationSupported: boolean
  platform: NativeNotificationPlatform
}

export interface RestorableWindow {
  isMinimized: () => boolean
  isVisible: () => boolean
  restore: () => void
  show: () => void
  focus: () => void
  webContents: {
    isLoadingMainFrame?: () => boolean
    once?: (eventName: 'did-finish-load', handler: () => void) => void
    send: (channel: string, payload: ResultNotification) => void
  }
}

export function shouldShowNativeResultNotification({
  appActive,
  enabled,
  notificationSupported,
  platform,
}: NativeResultNotificationDecision): boolean {
  // darwin：macOS 通知中心。win32：Windows 10+ toast（Electron Notification 原生支持，
  // 打包态首次弹窗走系统设置授权）。其余平台（linux 等）暂不支持原生推送。
  return (platform === 'darwin' || platform === 'win32') && enabled && !appActive && notificationSupported
}

export function createNativeResultNotificationText(notification: ResultNotification): {
  body: string
  title: string
} {
  const body =
    notification.status === 'waiting'
      ? 'Agent 正在等待你的确认。'
      : notification.status === 'success'
        ? 'Agent 已完成任务。'
        : notification.status === 'interrupted'
          ? 'Agent 任务已中断。'
          : notification.status === 'failed'
            ? 'Agent 任务未完成。'
            : notification.status === 'cancelling'
              ? 'Agent 正在停止任务。'
              : 'Agent 正在执行任务。'
  return {
    title: 'NarraCat Agent',
    body,
  }
}

export function maybeShowNativeResultNotification(
  notification: ResultNotification,
  deps: NativeResultNotificationDeps,
): boolean {
  if (!shouldShowNativeResultNotification(deps)) return false

  const nativeNotification = deps.createNotification(createNativeResultNotificationText(notification))
  nativeNotification.on('click', () => deps.openNotification(notification))
  nativeNotification.show()
  return true
}

export function restoreWindowAndOpenResultNotification(
  window: RestorableWindow | null | undefined,
  notification: ResultNotification,
): void {
  if (!window) return

  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
  const send = () => window.webContents.send(OPEN_RESULT_NOTIFICATION_CHANNEL, notification)
  if (window.webContents.isLoadingMainFrame?.() && window.webContents.once) {
    window.webContents.once('did-finish-load', send)
    return
  }
  send()
}
