// electron 原生通知绑定层：只负责把真实的 Notification / BrowserWindow / app 接到
// native-notification-rules.ts 的纯判断上。判断与文案本身住在那边（含分家理由）。

import { app, BrowserWindow, Notification } from 'electron'
import type { ResultNotification } from '@shared/types/notifications'
import {
  maybeShowNativeResultNotification,
  restoreWindowAndOpenResultNotification,
} from './native-notification-rules.ts'

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
