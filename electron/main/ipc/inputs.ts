/**
 * IPC 跨域共用基础设施叶子模块（评审修复：app.ts ↔ agent.ts 模块级循环 import）。
 *
 * 本文件不 import 任何同层域文件（app/novel/agent/packs/skills/chat.ts），只依赖更底层的
 * config.ts/notifications.ts/native-notifications.ts 等叶子模块，
 * 保证自己是依赖图上的叶子——app.ts 与 agent.ts 都从这里单向导入，不再互相依赖。
 *
 * 内容=原 app.ts 中「agent.ts 需要消费」的那批函数（含其内部依赖 configPath/isRecord）逐字迁出，
 * 未改一行实现。
 */
import { app, BrowserWindow } from 'electron'
import { getConfigPath, readAppConfig, type AppConfig } from '../config.ts'
import { notificationsPath } from '../notifications.ts'
import { showElectronNativeResultNotification } from '../native-notifications.ts'
import type { ResultNotification, ResultNotificationList } from '@shared/types/notifications'

export function configPath(): string {
  return getConfigPath(app.getPath('userData'))
}

export function resultNotificationsPath(): string {
  return notificationsPath(app.getPath('userData'))
}

export function userDataPath(): string {
  return app.getPath('userData')
}

export async function readCurrentConfig(): Promise<AppConfig> {
  return readAppConfig(configPath())
}

export function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}

export function readInputRecord(input: unknown, message: string): Record<string, unknown> {
  if (!isRecord(input)) throw new Error(message)
  return input
}

export function readRequiredString(parent: Record<string, unknown>, key: string, message: string): string {
  const value = parent[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value
}

export function readOptionalString(parent: Record<string, unknown>, key: string, message: string): string | undefined {
  const value = parent[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(message)
  return value
}

export function broadcastResultNotifications(payload: ResultNotificationList): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('notifications:changed', payload)
  }
}

export async function showNativeResultNotificationIfNeeded(notification: ResultNotification): Promise<void> {
  try {
    const config = await readCurrentConfig()
    showElectronNativeResultNotification({
      enabled: config.systemNotificationsEnabled,
      notification,
    })
  } catch (error) {
    console.error(error)
  }
}
