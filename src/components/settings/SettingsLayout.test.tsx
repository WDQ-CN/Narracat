import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SettingsActionRow, SettingsCard, SettingsNavLink, SettingsPrimarySidebar, SettingsRow } from './SettingsLayout'

describe('SettingsLayout', () => {
  test('uses parent divide lines without row-level duplicate borders', () => {
    const html = renderToStaticMarkup(
      <SettingsCard>
        <SettingsRow title="小说根目录">/novels</SettingsRow>
        <SettingsRow title="主题">浅色</SettingsRow>
        <SettingsActionRow status="已保存">保存</SettingsActionRow>
      </SettingsCard>,
    )

    expect(html).toContain('divide-y')
    expect(html).not.toContain('not-first:border-t')
    expect(html).not.toContain('border-t border-border')
  })

  test('renders settings navigation as text-first rows without decorative icons', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SettingsNavLink active to="/settings?section=model" label="模型服务" />
      </MemoryRouter>,
    )

    expect(html).toContain('模型服务')
    expect(html).not.toContain('<svg')
  })

  test('replaces history when switching settings sections', () => {
    const element = SettingsNavLink({
      active: false,
      to: '/settings?section=workspace',
      label: '安全与项目',
    }) as ReactElement<{ replace?: boolean }>

    expect(element.props.replace).toBe(true)
  })

  test('renders the settings sidebar with workbench-sized chrome', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <MemoryRouter>
          <SettingsPrimarySidebar
            activeSectionId="appearance"
            returnTo="/"
            sections={[
              { id: 'model', title: '模型服务' },
              { id: 'appearance', title: '外观' },
            ]}
          />
        </MemoryRouter>
      </TooltipProvider>,
    )

    expect(html).toContain('data-settings-sidebar="true"')
    expect(html).toContain('w-64')
    expect(html).toContain('data-settings-sidebar-headbar="true"')
    expect(html).toContain('justify-end')
    expect(html).toContain('aria-label="返回"')
    expect(html).toContain('data-icon-tooltip="返回"')
    expect(html).not.toContain('aria-label="返回图书馆"')
    expect(html).not.toContain('aria-label="设置"')
    expect(html).not.toContain('data-icon-tooltip="返回图书馆"')
    expect(html).not.toContain('data-icon-tooltip="设置"')
    expect(html).not.toContain('title="返回"')
    expect(html).not.toContain('data-global-notification-bell')
    expect(html).toContain('data-active="true"')
    expect(html).toContain('外观')
  })

  test('renders a section badge as a warning pill (内测「测试」标）', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <MemoryRouter>
          <SettingsPrimarySidebar
            activeSectionId="model"
            returnTo="/"
            sections={[
              { id: 'model', title: '模型服务' },
              { id: 'packs', title: '能力包', badge: '测试' },
            ]}
          />
        </MemoryRouter>
      </TooltipProvider>,
    )

    expect(html).toContain('测试')
    expect(html).toContain('bg-warning/10')
  })
})
