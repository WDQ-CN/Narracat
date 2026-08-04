import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileText, Loader2 } from 'lucide-react'
import { EMPTY_PRIMARY_TITLE_CLASS } from '@/design-system'
import { WorkbenchEmptyState } from './WorkbenchEmptyState'

describe('WorkbenchEmptyState', () => {
  test('primary density reads as main content, not metadata', () => {
    const html = renderToStaticMarkup(
      <WorkbenchEmptyState icon={FileText} title="文件尚未生成">
        当前对象没有可显示的文件。
      </WorkbenchEmptyState>,
    )

    expect(html).toContain('文件尚未生成')
    expect(html).toContain('text-lg')
    expect(html).not.toContain('text-2xl')
  })

  test('compact density stays at the metadata scale for loading states', () => {
    const html = renderToStaticMarkup(
      <WorkbenchEmptyState density="compact" icon={Loader2} title="正在读取文档">
        正在加载当前板块内容。
      </WorkbenchEmptyState>,
    )

    expect(html).toContain('正在读取文档')
    expect(html).toContain('text-xs')
    expect(html).not.toContain('text-lg')
  })

  test('shares the primary empty title role with Reference works hero', () => {
    const html = renderToStaticMarkup(
      <WorkbenchEmptyState icon={FileText} title="缺少章节大纲">
        本章还没有大纲。
      </WorkbenchEmptyState>,
    )

    expect(html).toContain(EMPTY_PRIMARY_TITLE_CLASS)
  })
})
