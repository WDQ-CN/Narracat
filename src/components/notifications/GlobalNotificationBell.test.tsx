import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { EMPTY_PRIMARY_BODY_CLASS } from '@/design-system'
import { ResultNotificationPanel } from './GlobalNotificationBell'
import { getNotificationDropdownPlacement, getNotificationPanelMotion } from './notification-panel-placement'
import type { ResultNotification } from '@shared/types/notifications'

function notification(index: number, read = false): ResultNotification {
  return {
    id: `notification-run-${index}`,
    runId: `run-${index}`,
    threadId: 'thread-1',
    status: index % 2 === 0 ? 'success' : 'failed',
    title: index % 2 === 0 ? `第 ${index} 章正文已生成` : `世界观设定生成失败 ${index}`,
    summary: index % 2 === 0 ? 'Agent 已完成章节正文生成。' : 'Agent 运行失败，已保留可用上下文。',
    projectName: index % 2 === 0 ? '长夜星河' : '星门',
    projectPath: '/novels/stars',
    createdAt: `2026-05-22T00:${String(index).padStart(2, '0')}:00.000Z`,
    updatedAt: `2026-05-22T00:${String(index).padStart(2, '0')}:00.000Z`,
    ...(read ? { readAt: '2026-05-22T10:00:00.000Z' } : {}),
  }
}

describe('ResultNotificationPanel', () => {
  test('renders unread count, mark-all action, and compact notification rows', () => {
    const html = renderToStaticMarkup(
      <ResultNotificationPanel
        notifications={[notification(2), notification(1, true)]}
        unreadCount={1}
        onMarkAllRead={() => {}}
        onNotificationClick={() => {}}
      />,
    )

    expect(html).toContain('data-result-notification-panel="true"')
    expect(html).toContain('通知')
    expect(html).toContain('1 条未读')
    expect(html).toContain('全部标为已读')
    expect(html).toContain('第 2 章正文已生成')
    expect(html).toContain('长夜星河')
    expect(html).not.toContain('Agent 已完成章节正文生成。')
    // 通知项标题规整到 scale，不再使用任意字号 text-[13px]
    expect(html).not.toContain('text-[13px]')
  })

  test('renders only the latest 20 notifications in the panel', () => {
    const html = renderToStaticMarkup(
      <ResultNotificationPanel
        notifications={Array.from({ length: 25 }, (_, index) => notification(index + 1))}
        unreadCount={25}
        onMarkAllRead={() => {}}
        onNotificationClick={() => {}}
      />,
    )

    expect(html).toContain('第 20 章正文已生成')
    expect(html).not.toContain('世界观设定生成失败 21')
    expect(html).not.toContain('第 24 章正文已生成')
  })

  test('shows an empty state without clearing unread semantics', () => {
    const html = renderToStaticMarkup(
      <ResultNotificationPanel
        notifications={[]}
        unreadCount={0}
        onMarkAllRead={() => {}}
        onNotificationClick={() => {}}
      />,
    )

    expect(html).toContain('暂无通知')
    expect(html).toContain('0 条未读')
    // 空态主文案使用 primary empty body 角色
    expect(html).toContain(EMPTY_PRIMARY_BODY_CLASS)
    expect(html).not.toContain('全部标为已读</button>')
  })

  test('does not misreport a first-load failure as no notifications', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultNotificationPanel
          loadState={{
            status: 'error',
            hasData: false,
            issue: { id: 'NC-NOTE-1234ABCD', summary: '没能读取通知。' },
          }}
          notifications={[]}
          unreadCount={0}
          onMarkAllRead={() => {}}
          onNotificationClick={() => {}}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    )

    expect(html).toContain('没能读取通知。')
    expect(html).toContain('NC-NOTE-1234ABCD')
    expect(html).toContain('重试')
    expect(html).not.toContain('暂无通知')
  })

  test('keeps last-good notifications visible when a refresh fails', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultNotificationPanel
          loadState={{
            status: 'stale',
            hasData: true,
            issue: { id: 'NC-NOTE-87654321', summary: '没能读取通知。' },
          }}
          notifications={[notification(2)]}
          unreadCount={1}
          onMarkAllRead={() => {}}
          onNotificationClick={() => {}}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    )

    expect(html).toContain('刷新失败，当前显示的是上次成功读取的内容。')
    expect(html).toContain('NC-NOTE-87654321')
    expect(html).toContain('第 2 章正文已生成')
    expect(html).not.toContain('暂无通知')
  })

  test('positions the dropdown below the icon and lets collision handling shift horizontally', () => {
    expect(getNotificationDropdownPlacement('topbar')).toEqual({
      align: 'center',
      side: 'bottom',
      sideOffset: 8,
      collisionPadding: 12,
    })
    expect(getNotificationDropdownPlacement('sidebar')).toEqual({
      align: 'center',
      side: 'bottom',
      sideOffset: 8,
      collisionPadding: 12,
    })
  })

  test('uses below-icon framer motion settings with Radix transform origin', () => {
    expect(getNotificationPanelMotion('topbar')).toMatchObject({
      initial: { opacity: 0, scale: 0.98, y: -6 },
      exit: { opacity: 0, scale: 0.98, y: -4 },
      transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)',
    })
    expect(getNotificationPanelMotion('sidebar')).toMatchObject({
      initial: { opacity: 0, scale: 0.98, y: -6 },
      exit: { opacity: 0, scale: 0.98, y: -4 },
      transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)',
    })
  })

  test('renders the notification panel inside a framer motion wrapper', () => {
    const source = readFileSync(new URL('./GlobalNotificationBell.tsx', import.meta.url), 'utf8')

    expect(source).toContain("from 'framer-motion'")
    expect(source).toContain('<motion.div')
    expect(source).toContain('data-result-notification-motion')
  })

  test('keeps the trigger tooltip controlled while the dropdown is open', () => {
    const source = readFileSync(new URL('./GlobalNotificationBell.tsx', import.meta.url), 'utf8')

    expect(source).toContain('const [tooltipOpen, setTooltipOpen] = useState(false)')
    expect(source).toContain('open={open || suppressTooltip ? false : tooltipOpen}')
    expect(source).toContain('onOpenChange={handleTooltipOpenChange}')
  })

  test('suppresses the trigger tooltip after clicking until the pointer leaves', () => {
    const source = readFileSync(new URL('./GlobalNotificationBell.tsx', import.meta.url), 'utf8')

    expect(source).toContain('const [suppressTooltip, setSuppressTooltip] = useState(false)')
    expect(source).toContain('function handleDropdownOpenChange(nextOpen: boolean)')
    expect(source).toContain('function handleTooltipOpenChange(nextOpen: boolean)')
    expect(source).toContain('function handleTriggerPointerDown()')
    expect(source).toContain('function handleTriggerPointerLeave()')
    expect(source).toContain('open || suppressTooltip ? false : tooltipOpen')
    expect(source).toContain('onPointerDown={handleTriggerPointerDown}')
    expect(source).toContain('onPointerLeave={handleTriggerPointerLeave}')
  })

  test('keeps the Workbench sidebar entrypoint on below-icon placement', () => {
    const workbenchSidebar = readFileSync(
      new URL('../workbench/WorkbenchPrimarySidebar.tsx', import.meta.url),
      'utf8',
    )
    const settingsSidebar = readFileSync(new URL('../settings/SettingsLayout.tsx', import.meta.url), 'utf8')

    expect(workbenchSidebar).toContain('<GlobalNotificationBell placement="sidebar"')
    expect(settingsSidebar).not.toContain('GlobalNotificationBell')
    expect(getNotificationDropdownPlacement('sidebar').side).toBe('bottom')
  })

  test('focuses the agent confirmation card when a question notification is opened', () => {
    const source = readFileSync(new URL('./GlobalNotificationBell.tsx', import.meta.url), 'utf8')

    expect(source).toContain("from '@/lib/result-notification-navigation'")
    expect(source).toContain('openResultNotification({')
  })
})
