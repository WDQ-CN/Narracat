import { describe, expect, test } from 'bun:test'
import {
  extractChapterMetadata,
  normalizeCopyDocumentText,
  resolveVisibleWorkbenchCopyDocument,
  stripReviewReportJson,
} from './workbench-copy-document'
import type { NovelWorkbenchArtifacts, NovelWorkbenchTreeItem } from '@shared/types/novel'

function chapterItem(): NovelWorkbenchTreeItem {
  return {
    id: 'chapter-1',
    kind: 'chapter',
    title: '第 001 章',
    level: 1,
    chapterNumber: 1,
    exists: true,
  }
}

describe('workbench copy document helpers', () => {
  test('removes chapter metadata before copying manuscript text', () => {
    const artifacts: NovelWorkbenchArtifacts = {
      projectPath: '/novels/stars',
      objectId: 'chapter-1',
      objectKind: 'chapter',
      title: '第 001 章',
      artifacts: [
        {
          id: 'manuscript',
          kind: 'manuscript',
          title: '章节正文',
          exists: true,
          content: [
            '# 第一章',
            '',
            '正文主体。',
            '',
            '<!-- chapter_metadata: {"summary":"系统摘要","anchors":["A"]} -->',
          ].join('\n'),
        },
      ],
    }

    expect(
      resolveVisibleWorkbenchCopyDocument({
        artifacts,
        chapterView: 'text',
        selectedItem: chapterItem(),
      }),
    ).toEqual({
      title: '章节正文',
      text: '# 第一章\n\n正文主体。',
    })
  })

  test('does not offer to copy an interrupted-draft staging preview (read-only, no export)', () => {
    const artifacts: NovelWorkbenchArtifacts = {
      projectPath: '/novels/stars',
      objectId: 'chapter-1',
      objectKind: 'chapter',
      title: '第 001 章',
      artifacts: [
        {
          id: 'manuscript',
          kind: 'manuscript',
          title: '章节正文',
          exists: true,
          content: '中断前热写的草稿',
          isDraft: true,
        },
      ],
    }

    expect(
      resolveVisibleWorkbenchCopyDocument({
        artifacts,
        chapterView: 'text',
        selectedItem: chapterItem(),
      }),
    ).toBeNull()
  })

  test('copies chapter outline and review from the currently visible chapter view', () => {
    const artifacts: NovelWorkbenchArtifacts = {
      projectPath: '/novels/stars',
      objectId: 'chapter-1',
      objectKind: 'chapter',
      title: '第 001 章',
      artifacts: [
        { id: 'chapter-outline', kind: 'chapter-outline', title: '章节大纲', exists: true, content: '大纲正文' },
        { id: 'review', kind: 'review', title: '审修报告', exists: true, content: '审修正文' },
      ],
    }

    expect(
      resolveVisibleWorkbenchCopyDocument({
        artifacts,
        chapterView: 'outline',
        selectedItem: chapterItem(),
      })?.text,
    ).toBe('大纲正文')
    expect(
      resolveVisibleWorkbenchCopyDocument({
        artifacts,
        chapterView: 'review',
        selectedItem: chapterItem(),
      })?.text,
    ).toBe('审修正文')
  })

  test('copies the selected visible subdocument instead of hidden sibling documents', () => {
    const selectedItem: NovelWorkbenchTreeItem = {
      id: 'world',
      kind: 'world-list',
      title: '世界观',
      level: 1,
      exists: true,
    }
    const artifacts: NovelWorkbenchArtifacts = {
      projectPath: '/novels/stars',
      objectId: 'world',
      objectKind: 'world-list',
      title: '世界观',
      artifacts: [
        { id: 'world-a', kind: 'markdown', title: 'A', exists: true, content: 'A 正文' },
        { id: 'world-b', kind: 'markdown', title: 'B', exists: true, content: 'B 正文' },
      ],
    }

    expect(
      resolveVisibleWorkbenchCopyDocument({
        artifacts,
        chapterView: 'text',
        selectedItem,
        selectedSubcontentArtifactId: 'world-b',
      }),
    ).toEqual({
      title: 'B',
      text: 'B 正文',
    })
  })

  test('returns no copy document for empty, missing, or reference works content', () => {
    expect(normalizeCopyDocumentText(' \r\n正文 \r\n')).toBe('正文')
    expect(extractChapterMetadata('正文\n<!-- chapter_metadata: bad json -->').content).toBe('正文')

    expect(
      resolveVisibleWorkbenchCopyDocument({
        artifacts: {
          projectPath: '/novels/stars',
          objectId: 'references',
          objectKind: 'reference-list',
          title: '参考作品',
          artifacts: [{ id: 'reference-guidance', kind: 'markdown', title: '参考指导', exists: true, content: '参考' }],
        },
        chapterView: 'text',
        selectedItem: {
          id: 'references',
          kind: 'reference-list',
          title: '参考作品',
          level: 0,
          exists: true,
        },
      }),
    ).toBeNull()
    expect(
      resolveVisibleWorkbenchCopyDocument({
        artifacts: null,
        chapterView: 'text',
        selectedItem: chapterItem(),
      }),
    ).toBeNull()
  })

  test('strips review report json comment from review report content', () => {
    const reviewBody = ['## 两维度判定', '', '审修正文。'].join('\n')
    const raw = `${reviewBody}\n\n<!-- review_report_json: {"chapter":12,"verdict":"pass","reading_desire":{"total_score":8}} -->`

    expect(stripReviewReportJson(raw)).toBe(reviewBody)
  })

  test('removes review report json before copying review text', () => {
    const artifacts: NovelWorkbenchArtifacts = {
      projectPath: '/novels/stars',
      objectId: 'chapter-1',
      objectKind: 'chapter',
      title: '第 001 章',
      artifacts: [
        {
          id: 'review',
          kind: 'review',
          title: '审修报告',
          exists: true,
          content: [
            '## 两维度判定',
            '',
            '审修正文。',
            '',
            '<!-- review_report_json: {"chapter":12,"verdict":"pass"} -->',
          ].join('\n'),
        },
      ],
    }

    expect(
      resolveVisibleWorkbenchCopyDocument({
        artifacts,
        chapterView: 'review',
        selectedItem: chapterItem(),
      }),
    ).toEqual({
      title: '审修报告',
      text: '## 两维度判定\n\n审修正文。',
    })
  })
})
