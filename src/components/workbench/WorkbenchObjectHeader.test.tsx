import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkbenchObjectHeader } from './WorkbenchObjectHeader'
import type { WorkbenchAction } from '@/lib/workbench-actions'

function renderHeader(titlebarActions: WorkbenchAction[]): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <MemoryRouter>
        <WorkbenchObjectHeader
          activeTabId={null}
          projectPath="/novels/stars"
          sectionId="blueprint"
          sectionTitle="小说大纲"
          tabs={[]}
          titlebarActions={titlebarActions}
          onTitlebarAction={() => {}}
        />
      </MemoryRouter>
    </TooltipProvider>,
  )
}

const enabledPrimaryAction: WorkbenchAction = {
  id: 'write-current-chapter',
  kind: 'agent',
  label: '写本章',
  description: '按当前写作阶段推进本章正文。',
  enabled: true,
  command: 'write-next',
  placement: 'primary',
}

const disabledPrimaryAction: WorkbenchAction = {
  ...enabledPrimaryAction,
  enabled: false,
  disabledReason: 'Agent 正在运行，请等待当前任务完成。',
}

const enabledCopyAction: WorkbenchAction = {
  id: 'copy-visible-document',
  kind: 'client',
  label: '复制',
  description: '复制当前文档内容。',
  enabled: true,
  placement: 'copy',
}

const disabledCopyAction: WorkbenchAction = {
  ...enabledCopyAction,
  enabled: false,
  disabledReason: 'Agent 正在运行，请等待当前任务完成。',
}

const manuscriptSaveAction: WorkbenchAction = {
  id: 'manuscript-save',
  kind: 'client',
  label: '保存',
  description: '保存当前正文修改',
  enabled: true,
  placement: 'primary',
}

const manuscriptCancelAction: WorkbenchAction = {
  id: 'manuscript-cancel',
  kind: 'client',
  label: '取消',
  description: '放弃本次编辑，返回阅读视图',
  enabled: true,
  placement: 'secondary',
}

const manuscriptHistoryAction: WorkbenchAction = {
  id: 'manuscript-history',
  kind: 'client',
  label: '版本历史',
  description: '查看、比较和恢复当前章节的已保存版本。',
  enabled: true,
  placement: 'utility',
}

// Radix Tooltip 的内容走 Portal，renderToStaticMarkup 在关闭态不会渲染 TooltipContent，
// 因此这里不断言 tooltip 文案本身，只断言「谁是真正的 hover/focus trigger」这个结构性事实：
// Button 一旦 disabled 就带 `disabled:pointer-events-none`，接不到 hover，
// 所以被禁用时 trigger 必须换成外层可命中的 span（tabindex=0），Button 仍保持 disabled。

describe('WorkbenchObjectHeader', () => {
  test('禁用的主操作把 tooltip trigger 换成外层 span，Button 本身仍 disabled', () => {
    const html = renderHeader([disabledPrimaryAction, enabledCopyAction])

    expect(html).toContain('data-workbench-titlebar-primary-action="write-current-chapter"')
    // Button 上仍然 disabled，保证键盘/表单语义不变。
    expect(html).toMatch(/data-workbench-titlebar-primary-action="write-current-chapter"[^>]*disabled=""/)
    // 真正的 Radix trigger（data-slot="tooltip-trigger"）落在外层 span 上，而不是 disabled 的 button 上：
    // span 带 tabindex，且 data-slot="tooltip-trigger" 落在 span 而非 button。
    const spanMatch = html.match(/<span([^>]*)>(<button[^>]*data-workbench-titlebar-primary-action="write-current-chapter"[^>]*)>/)
    expect(spanMatch).not.toBeNull()
    expect(spanMatch?.[1]).toContain('tabindex="0"')
    expect(spanMatch?.[1]).toContain('data-slot="tooltip-trigger"')
    expect(spanMatch?.[2]).not.toContain('data-slot="tooltip-trigger"')
    expect(spanMatch?.[2]).toContain('disabled=""')
  })

  test('启用的主操作直接把 Button 作为 tooltip trigger，不额外包裹 span', () => {
    const html = renderHeader([enabledPrimaryAction, enabledCopyAction])

    expect(html).toContain('data-workbench-titlebar-primary-action="write-current-chapter"')
    expect(html).not.toMatch(/data-workbench-titlebar-primary-action="write-current-chapter"[^>]*disabled=""/)
    expect(html).toMatch(/<button[^>]*data-slot="tooltip-trigger"[^>]*data-workbench-titlebar-primary-action="write-current-chapter"/)
  })

  test('禁用的图标操作（复制/刷新）同样把 trigger 换成外层 span', () => {
    const html = renderHeader([enabledPrimaryAction, disabledCopyAction])

    expect(html).toContain('data-workbench-titlebar-copy-action="copy-visible-document"')
    const spanMatch = html.match(/<span([^>]*)>(<button[^>]*data-workbench-titlebar-copy-action="copy-visible-document"[^>]*)>/)
    expect(spanMatch).not.toBeNull()
    expect(spanMatch?.[1]).toContain('tabindex="0"')
    expect(spanMatch?.[1]).toContain('data-slot="tooltip-trigger"')
    expect(spanMatch?.[2]).not.toContain('data-slot="tooltip-trigger"')
    expect(spanMatch?.[2]).toContain('disabled=""')
  })

  test('secondary 动作渲染为 primary 旁的带文案 ghost 按钮（编辑态整体替换的取消按钮）', () => {
    const html = renderHeader([manuscriptSaveAction, manuscriptCancelAction])

    expect(html).toContain('data-workbench-titlebar-primary-action="manuscript-save"')
    expect(html).toContain('data-workbench-titlebar-secondary-action="manuscript-cancel"')
    // 复制/刷新/更多菜单在编辑态整体替换后不应出现。
    expect(html).not.toContain('data-workbench-titlebar-copy-action')
    expect(html).not.toContain('data-workbench-titlebar-refresh-action')
    expect(html).not.toContain('data-workbench-titlebar-more-trigger')
  })

  test('utility 动作渲染为标题栏纯图标入口，不挤占 primary 和更多菜单', () => {
    const html = renderHeader([enabledPrimaryAction, manuscriptHistoryAction, enabledCopyAction])

    expect(html).toContain('data-workbench-titlebar-utility-action="manuscript-history"')
    expect(html).toContain('aria-label="版本历史"')
    expect(html).toContain('data-workbench-titlebar-primary-action="write-current-chapter"')
    expect(html).not.toContain('data-workbench-titlebar-more-trigger')
  })

  // 更多操作菜单内容走 Radix Portal，关闭态 renderToStaticMarkup 渲染不到，
  // 这里按仓内惯例改用源码断言锁「禁用项在标签下方展示 disabledReason」的结构。
  test('更多操作菜单里被禁用的动作在标签下方展示禁用原因（#407）', () => {
    const source = readFileSync(fileURLToPath(new URL('./WorkbenchObjectHeader.tsx', import.meta.url)), 'utf-8')

    expect(source).toContain('data-workbench-titlebar-menu-disabled-reason="true"')
    expect(source).toContain("const disabledReason = !action.enabled ? action.disabledReason : undefined")
    expect(source).toContain('{disabledReason}')
  })
})
