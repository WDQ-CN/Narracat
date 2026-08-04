import { app, BrowserWindow, Notification } from 'electron'
import type { ResultNotification } from '@shared/types/notifications'

const OPEN_RESULT_NOTIFICATION_CHANNEL = 'notifications:open-result'

type NativeNotificationPlatform = NodeJS.Platform | 'linux'

interface NativeNotificationLike {
  on: (eventName: 'click', handler: () => void) => void
  show: () => void
}

interface NativeResultNotificationDeps {
  appActive: boolean
  createNotification: (options: { title: string; body: string }) => NativeNotificationLike
  enabled: boolean
  notificationSupported: boolean
  openNotification: (notification: ResultNotification) => void
  platform: NativeNotificationPlatform
}

interface NativeResultNotificationDecision {
  appActive: boolean
  enabled: boolean
  notificationSupported: boolean
  platform: NativeNotificationPlatform
}

interface RestorableWindow {
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
  return platform === 'darwin' && enabled && !appActive && notificationSupported
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

function getTargetWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function isAppActive(): boolean {
  return BrowserWindow.getAllWindows().some((window) => window.isFocused())
}

export function showElectronNativeResultNotification({
  enabled,
  notification,
}: {
  enabled: boolean
  notification: ResultNotification
}): boolean {
  return maybeShowNativeResultNotification(notification, {
    enabled,
    platform: process.platform,
    appActive: isAppActive(),
    notificationSupported: Notification.isSupported(),
    createNotification: (options) => new Notification(options),
    openNotification: (target) => {
      let window = getTargetWindow()
      if (!window) {
        app.emit('activate')
        window = getTargetWindow()
      }
      restoreWindowAndOpenResultNotification(window, target)
    },
  })
}
