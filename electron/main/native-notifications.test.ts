import { beforeAll, describe, expect, mock, test } from 'bun:test'
import type { ResultNotification } from '@shared/types/notifications'

mock.module('electron', () => ({
  app: {
    emit: () => undefined,
  },
  BrowserWindow: class BrowserWindow {
    static getAllWindows() {
      return []
    }
  },
  shell: {
    openExternal: () => undefined,
  },
  Notification: class Notification {
    static isSupported() {
      return true
    }
  },
}))

let nativeNotifications: typeof import('./native-notifications')

beforeAll(async () => {
  nativeNotifications = await import('./native-notifications')
})

const notification: ResultNotification = {
  id: 'notification-run-1',
  runId: 'run-1',
  threadId: 'thread-1',
  status: 'waiting',
  title: 'Agent 等待你确认',
  summary: '主角接下来应该公开身份还是继续隐藏？',
  projectName: '长夜星河',
  projectPath: '/novels/stars',
  target: {
    sectionId: 'blueprint',
    tabId: 'chapter-12',
    objectId: 'chapter-12',
  },
  questionRequestId: 'question-run-1',
  createdAt: '2026-05-23T12:00:00.000Z',
  updatedAt: '2026-05-23T12:01:00.000Z',
}

describe('native result notifications', () => {
  test('sends only on macOS when enabled, supported, and the app is not active', () => {
    expect(
      nativeNotifications.shouldShowNativeResultNotification({
        enabled: true,
        platform: 'darwin',
        appActive: false,
        notificationSupported: true,
      }),
    ).toBe(true)

    expect(
      nativeNotifications.shouldShowNativeResultNotification({
        enabled: false,
        platform: 'darwin',
        appActive: false,
        notificationSupported: true,
      }),
    ).toBe(false)
    expect(
      nativeNotifications.shouldShowNativeResultNotification({
        enabled: true,
        platform: 'darwin',
        appActive: true,
        notificationSupported: true,
      }),
    ).toBe(false)
    expect(
      nativeNotifications.shouldShowNativeResultNotification({
        enabled: true,
        platform: 'linux',
        appActive: false,
        notificationSupported: true,
      }),
    ).toBe(false)
    expect(
      nativeNotifications.shouldShowNativeResultNotification({
        enabled: true,
        platform: 'darwin',
        appActive: false,
        notificationSupported: false,
      }),
    ).toBe(false)
  })

  test('builds generic low-sensitive native notification text without project or result details', () => {
    const text = nativeNotifications.createNativeResultNotificationText({
      ...notification,
      summary: 'Agent 运行失败，已保留可用上下文。\nError: stack frame at /secret/path'.repeat(6),
    })

    expect(text.title).toBe('NarraCat Agent')
    expect(text.body).toBe('Agent 正在等待你的确认。')
    expect(text.body).not.toContain('长夜星河')
    expect(text.body).not.toContain('Agent 运行失败，已保留可用上下文。')
    expect(text.body).not.toContain('/secret/path')
    expect(text.body.length).toBeLessThanOrEqual(120)
  })

  test('wires native notification click back to the original result notification target', () => {
    const events: unknown[] = []
    const shown = nativeNotifications.maybeShowNativeResultNotification(notification, {
      enabled: true,
      platform: 'darwin',
      appActive: false,
      notificationSupported: true,
      createNotification: (options) => {
        events.push(['create', options])
        return {
          on: (eventName, handler) => {
            events.push(['on', eventName])
            handler()
          },
          show: () => events.push(['show']),
        }
      },
      openNotification: (target) => events.push(['open', target]),
    })

    expect(shown).toBe(true)
    expect(events).toEqual([
      ['create', nativeNotifications.createNativeResultNotificationText(notification)],
      ['on', 'click'],
      ['open', notification],
      ['show'],
    ])
  })

  test('restores the window before asking the renderer to open the notification target', () => {
    const events: unknown[] = []
    const window = {
      isMinimized: () => true,
      isVisible: () => false,
      restore: () => events.push('restore'),
      show: () => events.push('show'),
      focus: () => events.push('focus'),
      webContents: {
        send: (channel: string, payload: unknown) => events.push(['send', channel, payload]),
      },
    }

    nativeNotifications.restoreWindowAndOpenResultNotification(window, notification)

    expect(events).toEqual([
      'restore',
      'show',
      'focus',
      ['send', 'notifications:open-result', notification],
    ])
  })

  test('waits for a newly created renderer to finish loading before sending navigation', () => {
    const events: unknown[] = []
    let didFinishLoad: (() => void) | undefined
    const window = {
      isMinimized: () => false,
      isVisible: () => true,
      restore: () => {},
      show: () => {},
      focus: () => events.push('focus'),
      webContents: {
        isLoadingMainFrame: () => true,
        once: (eventName: 'did-finish-load', handler: () => void) => {
          events.push(['once', eventName])
          didFinishLoad = handler
        },
        send: (channel: string, payload: unknown) => events.push(['send', channel, payload]),
      },
    }

    nativeNotifications.restoreWindowAndOpenResultNotification(window, notification)
    expect(events).toEqual(['focus', ['once', 'did-finish-load']])

    didFinishLoad?.()
    expect(events).toEqual([
      'focus',
      ['once', 'did-finish-load'],
      ['send', 'notifications:open-result', notification],
    ])
  })
})
