import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveSelectionToolbarAnchorFromRects } from './ArtifactDocumentShell'
import { ChapterPreview } from './ChapterPreview'
import { ContextPackView } from './ContextPackView'
import { OutlineView } from './OutlineView'
import { ReviewReportView } from './ReviewReportView'
import type { NovelArtifact } from '@shared/types/novel'

const manuscript: NovelArtifact = {
  kind: 'manuscript',
  title: '正文',
  path: '/novels/stars/chapters/001.md',
  exists: true,
  content: '第一章\n\n星舰驶出港口。',
}

describe('artifact views', () => {
  test('wraps manuscript content in a no-frame reading canvas with secondary metadata', () => {
    const html = renderToStaticMarkup(<ChapterPreview artifact={manuscript} />)

    expect(html).toContain('data-reading-canvas="true"')
    expect(html).toContain('data-markdown-selection-surface="disabled"')
    expect(html).toContain('data-reading-metadata="true"')
    expect(html).toContain('文件信息')
    expect(html).toContain('来源')
    expect(html).toContain('生成状态')
    expect(html).toContain('已生成')
    expect(html).toContain('/novels/stars/chapters/001.md')
    expect(html).toContain('星舰驶出港口')
    expect(html).not.toContain('源文件')
    expect(html).not.toContain('rounded-panel border border-border bg-surface')
  })

  test('enables selection handoff only around readable markdown body content', () => {
    const html = renderToStaticMarkup(
      <ChapterPreview
        artifact={manuscript}
        selectionHandoff={{ enabled: true, onHandoff: () => {} }}
      />,
    )
    const selectionSurfaceIndex = html.indexOf('data-markdown-selection-surface="true"')
    const metadataIndex = html.indexOf('data-reading-metadata="true"')

    expect(selectionSurfaceIndex).toBeGreaterThan(-1)
    expect(metadataIndex).toBeGreaterThan(-1)
    expect(selectionSurfaceIndex).toBeLessThan(metadataIndex)
    expect(html).not.toContain('data-markdown-selection-handoff="true"')
  })

  test('anchors the selection handoff toolbar to the selected text bounds', () => {
    expect(
      resolveSelectionToolbarAnchorFromRects({
        selectionRects: [{ left: 180, right: 300, top: 140, width: 120, height: 32 }],
        surfaceRect: { left: 100, top: 80, width: 500, height: 1000 },
      }),
    ).toEqual({ left: 208, top: 76 })
    expect(
      resolveSelectionToolbarAnchorFromRects({
        selectionRects: [{ left: 102, right: 112, top: 82, width: 10, height: 10 }],
        surfaceRect: { left: 100, top: 80, width: 500, height: 1000 },
      }),
    ).toEqual({ left: 20, top: 24 })
    expect(
      resolveSelectionToolbarAnchorFromRects({
        selectionRects: [
          { left: 180, right: 420, top: 140, width: 240, height: 32 },
          { left: 120, right: 220, top: 178, width: 100, height: 32 },
        ],
        surfaceRect: { left: 100, top: 80, width: 500, height: 1000 },
      }),
    ).toEqual({ left: 128, top: 114 })
  })

  test('uses a stable single-layer selection handoff toolbar without drag-time repositioning', () => {
    const source = readFileSync(new URL('./ArtifactDocumentShell.tsx', import.meta.url), 'utf8')

    expect(source).toContain('data-markdown-selection-toolbar="true"')
    expect(source).toContain('SendHorizontal')
    expect(source).toContain('shadow-[var(--shadow-selection-toolbar)]')
    expect(source).not.toContain('shadow-[var(--shadow-floating)]')
    expect(source).not.toContain('PopoverContent')
    expect(source).toContain("document.addEventListener('selectionchange', clearSelectionWhenInvalid)")
    expect(source).toContain("window.addEventListener('resize'")
    expect(source).toContain("window.addEventListener('scroll', updateSelection, true)")
  })

  test('hides chapter metadata comments from manuscript text and renders them as a collapsible summary', () => {
    const html = renderToStaticMarkup(
      <ChapterPreview
        artifact={{
          ...manuscript,
          content: [
            '# 第1章',
            '',
            '林远听见矿坑深处传来裂响。',
            '',
            '<!-- chapter_metadata: {"summary":"林远救下矿工并被老徐注意","word_count":2180,"key_events":["被老鲁救起","矿坑塌方"],"characters":[{"name":"林远","state":"疲惫但清醒"}]} -->',
          ].join('\n'),
        }}
      />,
    )

    expect(html).toContain('林远听见矿坑深处传来裂响')
    expect(html).not.toContain('chapter_metadata')
    expect(html).toContain('data-chapter-summary="true"')
    expect(html).toContain('本章总结')
    expect(html).toContain('摘要')
    expect(html).toContain('林远救下矿工并被老徐注意')
    expect(html).toContain('字数')
    expect(html).toContain('2,180')
    expect(html).toContain('关键事件')
    expect(html).toContain('被老鲁救起')
    expect(html).toContain('矿坑塌方')
    expect(html).toContain('角色')
    expect(html).toContain('林远')
    expect(html).toContain('疲惫但清醒')
  })

  test('renders bottom metadata rows with larger triggers, row separators, and Chinese schema labels', () => {
    const html = renderToStaticMarkup(
      <ChapterPreview
        artifact={{
          ...manuscript,
          content: [
            '# 第25章',
            '',
            '沈牧渊抬头看见铁骑军旗。',
            '',
            '<!-- chapter_metadata: {"chapter":25,"title":"统领","pov_character":"沈牧渊","word_count":5030,"timeline":"第24章次日上午至深夜","new_characters":["陆百夫长"],"characters_appeared":["沈牧渊","沈伯"],"key_events":["铁骑军府十二骑先遣队抵达落脚镇"],"foreshadowing_touched":{"F09":"PLANT——初尘对吕镜川排斥反应首次出现"},"emotional_tone":"压迫","value_shift":"安全→危险","cliffhanger":true} -->',
          ].join('\n'),
        }}
      />,
    )

    expect(html).toContain('min-h-10')
    expect(html).toContain('data-file-info-row="true"')
    expect(html).toContain('data-metadata-row="true"')
    expect(html).toContain('border-b border-border/60')
    expect(html).toContain('py-2.5')
    expect(html).toContain('视角角色')
    expect(html).toContain('时间线')
    expect(html).toContain('新登场角色')
    expect(html).toContain('出场角色')
    expect(html).toContain('触及伏笔')
    expect(html).toContain('情感基调')
    expect(html).toContain('价值转换')
    expect(html).toContain('悬念结尾')
    expect(html).not.toContain('pov_character')
    expect(html).not.toContain('characters_appeared')
    expect(html).not.toContain('foreshadowing_touched')
    expect(html).not.toContain('emotional_tone')
    expect(html).not.toContain('value_shift')
    expect(html).not.toContain('cliffhanger')
  })

  test('places chapter summary above file info and shows chevrons on collapsible rows', () => {
    const html = renderToStaticMarkup(
      <ChapterPreview
        artifact={{
          ...manuscript,
          content: [
            '# 第26章',
            '',
            '沈牧渊踏入军府。',
            '',
            '<!-- chapter_metadata: {"summary":"沈牧渊确认军府态度","word_count":3120} -->',
          ].join('\n'),
        }}
      />,
    )

    const summaryIndex = html.indexOf('data-chapter-summary="true"')
    const fileInfoIndex = html.indexOf('data-reading-metadata="true"')

    expect(summaryIndex).toBeGreaterThan(-1)
    expect(fileInfoIndex).toBeGreaterThan(-1)
    expect(summaryIndex).toBeLessThan(fileInfoIndex)
    expect(html.match(/data-details-chevron="true"/g)?.length).toBe(2)
    expect(html).toContain('group-open:rotate-90')
  })

  test('renders outline context and review with the same reading canvas language', () => {
    const outline = renderToStaticMarkup(
      <OutlineView artifact={{ ...manuscript, kind: 'outline', title: '大纲', content: '开场\n危机' }} />,
    )
    const context = renderToStaticMarkup(
      <ContextPackView artifact={{ ...manuscript, kind: 'context-pack', title: '上下文包', data: { pov: '林澈' } }} />,
    )
    const review = renderToStaticMarkup(
      <ReviewReportView
        artifact={{ ...manuscript, kind: 'review', title: '审修报告', data: { chapter: 1, verdict: 'pass', issues: [] } }}
      />,
    )

    for (const html of [outline, context, review]) {
      expect(html).toContain('data-reading-canvas="true"')
      expect(html).toContain('data-reading-metadata="true"')
      expect(html).not.toContain('rounded-panel border border-border bg-surface')
    }
    expect(outline).toContain('开场')
    expect(context).toContain('pov')
    expect(review).toContain('审修结论：通过')
  })

  test('renders review from the data contract without leaking machine fields', () => {
    const html = renderToStaticMarkup(
      <ReviewReportView
        artifact={{
          ...manuscript,
          kind: 'review',
          title: '审修报告',
          data: {
            chapter: 12,
            verdict: 'fail',
            issues: [{ severity: 'blocker', where: '第3段', what: '时间线矛盾', fix_hint: '对齐前章' }],
          },
        }}
      />,
    )

    expect(html).toContain('未通过')
    expect(html).toContain('硬伤')
    expect(html).toContain('时间线矛盾')
    expect(html).not.toContain('verdict')
    expect(html).not.toContain('blocker')
    expect(html).not.toContain('review_report_json')
  })
})
