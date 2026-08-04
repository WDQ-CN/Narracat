import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkbenchEmptyGuide } from './WorkbenchEmptyGuide'
import type { WorkbenchAction } from '@/lib/workbench-actions'

const generateAction: WorkbenchAction = {
  id: 'generate-empty-master-outline',
  kind: 'agent',
  label: '生成全局大纲',
  description: '生成全书结构',
  enabled: true,
  command: 'plan',
}

describe('WorkbenchEmptyGuide', () => {
  test('renders passive empty-document guidance without inline actions', () => {
    const html = renderToStaticMarkup(
      <WorkbenchEmptyGuide
        title="全局大纲尚未生成"
        description="全局大纲缺失或为空时，可以让 NarraCat 先生成全书结构。"
      />,
    )

    expect(html).toContain('全局大纲尚未生成')
    expect(html).toContain('全局大纲缺失或为空时，可以让 NarraCat 先生成全书结构。')
    expect(html).not.toContain('生成全局大纲')
    expect(html.match(/<button/g)).toBeNull()
    expect(html).not.toContain('文件尚未生成')
    expect(html).not.toContain('当前对象没有可显示的文件')
  })

  test('does not render loading controls inside the guidance body', () => {
    const html = renderToStaticMarkup(
      <WorkbenchEmptyGuide
        title="创作根基尚未生成"
        description="创作根基缺失。"
      />,
    )

    expect(html).not.toContain('生成中...')
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('animate-spin')
    expect(html.match(/<button/g)).toBeNull()
  })

  test('renders one centered primary action when a creation action is available', () => {
    const html = renderToStaticMarkup(
      <WorkbenchEmptyGuide
        title="全局大纲尚未生成"
        description="全局大纲缺失或为空时，可以让 NarraCat 先生成全书结构。"
        action={generateAction}
        onAction={() => {}}
      />,
    )

    expect(html).toContain('data-workbench-empty-guide-action="generate-empty-master-outline"')
    expect(html).toContain('生成全局大纲')
    expect(html).toContain('aria-label="生成全局大纲"')
    expect(html).toContain('data-size="lg"')
    expect(html).toContain('min-w-40')
    expect(html).not.toContain('title="生成全书结构"')
    expect(html.match(/<button/g)?.length).toBe(1)
  })

  test('禁用动作渲染为置灰按钮并展示原因，而非凭空消失', () => {
    const html = renderToStaticMarkup(
      <WorkbenchEmptyGuide
        title="全局大纲尚未生成"
        description="全局大纲缺失或为空时，可以让 NarraCat 先生成全书结构。"
        action={{ ...generateAction, enabled: false, disabledReason: 'Agent 正在运行，请等待当前任务完成。' }}
        onAction={() => {}}
      />,
    )

    expect(html).toContain('data-workbench-empty-guide-action="generate-empty-master-outline"')
    expect(html.match(/<button/g)?.length).toBe(1)
    expect(html).toContain('disabled=""')
    expect(html).toContain('Agent 正在运行，请等待当前任务完成。')
  })

  test('uses a brand illustration only when a high-value guide purpose is provided', () => {
    const html = renderToStaticMarkup(
      <WorkbenchEmptyGuide
        title="正文尚未生成"
        description="当前阶段应该写这一章。"
        purpose="draft-needed"
      />,
    )

    expect(html).toContain('data-brand-illustration="draft-needed"')
    expect(html).toContain('laptop-draft.webp')
    expect(html).not.toContain('data-workbench-empty-guide-action=')
  })
})
