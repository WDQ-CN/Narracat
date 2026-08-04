import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkbenchGenerationAnimation } from './WorkbenchGenerationAnimation'
import { WorkbenchGenerationEmptyState } from './WorkbenchGenerationFrame'

const generationState = {
  label: '参考作品',
  statusText: '正在生成参考作品',
}

describe('WorkbenchGenerationFrame', () => {
  test('renders the standard full-page Agent running state for empty generated content', () => {
    const html = renderToStaticMarkup(<WorkbenchGenerationEmptyState generationState={generationState} />)

    expect(html).toContain('data-workbench-generation-empty="true"')
    expect(html).toContain('data-workbench-generation-animation="main"')
    // 深色门控期间 effectiveTheme 恒为 light，生成动画使用浅色素材
    expect(html).toContain('generation-loading-light.webm')
    expect(html).toContain('正在生成参考作品')
    expect(html).toContain('完成后会自动刷新当前页面。')
    expect(html).not.toContain('animate-spin')
  })

  // 生成中的内联指示已挪到 titlebar 标题右侧（见 WorkbenchObjectHeader），
  // 内容区不再需要包裹一条灰色运行状态横条；相关渲染条件覆盖见 WorkbenchObjectView.test.tsx。

  test('uses the theme-specific PNG fallback when reduced motion is enabled', () => {
    const html = renderToStaticMarkup(
      <WorkbenchGenerationAnimation size="mini" theme="light" reducedMotion />,
    )

    expect(html).toContain('data-workbench-generation-animation="mini"')
    expect(html).toContain('generation-loading-light.png')
    expect(html).not.toContain('<video')
  })
})
