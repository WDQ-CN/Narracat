import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Dialog } from '@/components/ui/dialog'
import { EMPTY_PRIMARY_TITLE_CLASS } from '@/design-system'
import { ReferenceWorksPasteDialogPanel, ReferenceWorksView } from './ReferenceWorksView'
import type { ReferenceWorksSummary } from '@shared/types/novel'

const emptySummary: ReferenceWorksSummary = {
  sources: [],
  status: {
    guidanceState: 'empty',
    sourceCount: 0,
    needsAnalysis: false,
    stale: false,
    guidanceExists: false,
  },
}

const pendingSummary: ReferenceWorksSummary = {
  sources: [
    {
      id: 'reference-参考章.txt',
      fileName: '参考章.txt',
      title: '参考章',
      relativePath: 'bible/references/参考章.txt',
      path: '/novels/stars/bible/references/参考章.txt',
      extension: '.txt',
      size: 24,
      wordCount: 12,
      updatedAt: '2026-05-20T00:00:00.000Z',
    },
    {
      id: 'reference-第二章.md',
      fileName: '第二章.md',
      title: '第二章',
      relativePath: 'bible/references/第二章.md',
      path: '/novels/stars/bible/references/第二章.md',
      extension: '.md',
      size: 48,
      wordCount: 18,
      updatedAt: '2026-05-20T01:00:00.000Z',
    },
  ],
  status: {
    guidanceState: 'needs-analysis',
    sourceCount: 2,
    needsAnalysis: true,
    stale: false,
    latestSourceUpdatedAt: '2026-05-20T01:00:00.000Z',
    guidanceExists: false,
  },
}

const currentSummary: ReferenceWorksSummary = {
  ...pendingSummary,
  guidance: {
    exists: true,
    relativePath: 'bible/reference-guidance/index.md',
    path: '/novels/stars/bible/reference-guidance/index.md',
    updatedAt: '2026-05-21T00:00:00.000Z',
    content: '# 参考指导\n\n## 叙事节奏\n\n句式短促，转场利落。\n\n## 用词倾向\n\n偏好具体动作和场景细节。',
  },
  status: {
    ...pendingSummary.status,
    guidanceState: 'current',
    needsAnalysis: false,
    stale: false,
    guidanceExists: true,
    guidanceUpdatedAt: '2026-05-21T00:00:00.000Z',
  },
}

const staleSummary: ReferenceWorksSummary = {
  ...currentSummary,
  status: {
    ...currentSummary.status,
    guidanceState: 'stale',
    needsAnalysis: true,
    stale: true,
  },
}

const staleWithoutSourcesSummary: ReferenceWorksSummary = {
  ...currentSummary,
  sources: [],
  status: {
    ...currentSummary.status,
    guidanceState: 'stale',
    sourceCount: 0,
    needsAnalysis: false,
    stale: true,
  },
}

function render(summary: ReferenceWorksSummary) {
  return renderToStaticMarkup(
    <ReferenceWorksView
      projectPath="/novels/stars"
      summary={summary}
      onAction={() => {}}
      onChanged={() => {}}
    />,
  )
}

describe('ReferenceWorksView', () => {
  test('renders a centered empty state with paste excerpt and import text choices only', () => {
    const html = render(emptySummary)

    expect(html).toContain('data-reference-works-view="true"')
    expect(html).toContain('还没有参考作品')
    expect(html).toContain('data-brand-illustration="reference-works-needed"')
    expect(html).not.toContain('<div class="text-xs font-medium text-muted-foreground">参考来源</div>')
    expect(html).toContain('粘贴一个片段')
    expect(html).toContain('导入文本')
    expect(html).not.toContain('setup')
    expect(html).not.toContain('分析参考作品')
    // 空页 hero 收敛到共享主空态字号角色，不再使用独立 text-2xl
    expect(html).toContain(EMPTY_PRIMARY_TITLE_CLASS)
    expect(html).not.toContain('text-2xl')
  })

  test('uses the create-novel dialog structure for pasted excerpts', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <ReferenceWorksPasteDialogPanel
          busy={false}
          content="正文"
          error={null}
          title="片段"
          onContentChange={() => {}}
          onSubmit={() => {}}
          onTitleChange={() => {}}
        />
      </Dialog>,
    )

    expect(html).toContain('data-reference-works-paste-panel="true"')
    expect(html).toContain('border-b border-border px-6 pb-5 pt-6')
    expect(html).toContain('data-reference-works-paste-group="true"')
    expect(html).toContain('border-t border-border bg-active/40 px-6 py-4')
    expect(html).toContain('片段标题')
    expect(html).toContain('粘贴小说片段')
  })

  test('renders pending sources with per-source delete and analysis actions', () => {
    const html = render(pendingSummary)

    expect(html).toContain('参考作品待分析')
    expect(html).toContain('data-brand-illustration="reference-works-ready"')
    expect(html).toContain('分析参考作品')
    expect(html).toContain('参考章')
    expect(html).toContain('第二章')
    expect(html).toContain('12 字')
    expect(html).toContain('bible/references/参考章.txt')
    expect(html).not.toContain('bible/reference-guidance/index.md')
    expect(html).toContain('data-reference-works-actions="pending"')
    expect(html).toContain('data-reference-source-remove="参考章.txt"')
    expect(html).toContain('data-reference-source-remove="第二章.md"')
    expect(html).toContain('data-size="lg"')
    expect(region(html, 'data-reference-works-actions="pending"')).toContain('<svg')
    expect(html).toContain('粘贴一个片段')
    expect(html).toContain('导入文本')
    // 待分析页 hero 与空页、普通 Workbench 空态共享同一字号角色
    expect(html).toContain(EMPTY_PRIMARY_TITLE_CLASS)
    expect(html).not.toContain('text-2xl')
  })

  test('renders current guidance with source management sidebar', () => {
    const html = render(currentSummary)

    expect(html).toContain('data-reading-canvas="true"')
    expect(html).toContain('data-reading-metadata="true"')
    expect(html).toContain('data-reference-works-sidebar="true"')
    expect(html).toContain('2 个来源')
    expect(html).toContain('参考指导')
    expect(html).toContain('重新分析')
    expect(html).not.toContain('data-reference-guidance-stale="true"')
    expect(html).toContain('句式短促，转场利落。')
    expect(html).toContain('偏好具体动作和场景细节。')
  })

  test('marks existing guidance stale when sources changed', () => {
    const html = render(staleSummary)

    expect(html).toContain('data-reference-guidance-stale="true"')
    expect(html).toContain('当前参考指导可能已过期')
    expect(html).toContain('重新分析')
    expect(html).toContain('data-reference-works-reset="true"')
  })

  test('keeps stale guidance visible after the last source is deleted', () => {
    const html = render(staleWithoutSourcesSummary)

    expect(html).toContain('data-reference-guidance-stale="true"')
    expect(html).toContain('0 个来源')
    expect(html).toContain('参考指导')
    expect(html).toContain('data-reference-works-reset="true"')
    expect(html).not.toContain('还没有参考作品')
  })
})

function region(html: string, marker: string): string {
  const start = html.indexOf(marker)
  if (start < 0) return ''
  const close = html.indexOf('</div>', start)
  return close < 0 ? html.slice(start) : html.slice(start, close)
}
