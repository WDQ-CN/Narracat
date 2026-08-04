import { describe, expect, test } from 'bun:test'
import {
  createWorkbenchSelectionComposerHandoff,
  normalizeSelectedMarkdownText,
  resolveWorkbenchSelectionHandoff,
} from './workbench-selection-handoff'
import type { NovelWorkbenchTreeItem } from '@shared/types/novel'

function item(overrides: Partial<NovelWorkbenchTreeItem>): NovelWorkbenchTreeItem {
  return {
    id: 'item',
    kind: 'bible-document',
    title: '条目',
    level: 0,
    exists: true,
    ...overrides,
  }
}

describe('workbench selection handoff', () => {
  test('maps setup settings documents to setup and other settings to world', () => {
    expect(
      resolveWorkbenchSelectionHandoff({
        sectionId: 'settings',
        selectedItem: item({ id: 'foundation', kind: 'foundation', title: '创作根基' }),
        chapterView: 'text',
        artifact: { id: 'foundation', title: '创作根基' },
      }),
    ).toMatchObject({
      command: 'setup',
      sourceTitle: '创作根基',
      target: { sectionId: 'settings', tabId: 'foundation', objectId: 'foundation' },
    })

    expect(
      resolveWorkbenchSelectionHandoff({
        sectionId: 'settings',
        selectedItem: item({ id: 'world', kind: 'world-list', title: '世界观设定' }),
        chapterView: 'text',
        artifact: { id: 'world-setting', title: '边境城' },
      }),
    ).toMatchObject({
      command: 'world',
      sourceTitle: '边境城',
      target: { sectionId: 'settings', tabId: 'world', objectId: 'world' },
    })

    expect(
      resolveWorkbenchSelectionHandoff({
        sectionId: 'settings',
        selectedItem: item({ id: 'narrator-voice', kind: 'narrator-voice', title: '叙事声音' }),
        chapterView: 'text',
        artifact: { id: 'narrator-voice', title: '叙事声音 / 写作风格' },
      }),
    ).toMatchObject({
      command: 'plan',
      sourceTitle: '叙事声音 / 写作风格',
      target: { sectionId: 'blueprint', tabId: 'master-outline', objectId: 'master-outline' },
    })
  })

  test('maps the premise document to the targeted revise-premise command', () => {
    expect(
      resolveWorkbenchSelectionHandoff({
        sectionId: 'settings',
        selectedItem: item({ id: 'bible-premise', kind: 'bible-document', title: '核心前提', parentId: 'foundation', level: 1 }),
        chapterView: 'text',
        artifact: { id: 'bible-premise', title: '核心前提' },
      }),
    ).toMatchObject({
      command: 'revise-premise',
      sourceTitle: '核心前提',
      target: { sectionId: 'settings', tabId: 'bible-premise', objectId: 'bible-premise' },
    })
  })

  test('maps outline documents to plan and manuscript or review documents to rewrite', () => {
    expect(
      resolveWorkbenchSelectionHandoff({
        sectionId: 'blueprint',
        selectedItem: item({ id: 'master-outline', kind: 'master-outline', title: '全书大纲' }),
        chapterView: 'text',
        artifact: { id: 'master-outline', title: '全书大纲' },
      }),
    ).toMatchObject({ command: 'plan', sourceTitle: '全书大纲' })

    const chapter = item({
      id: 'chapter-1',
      kind: 'chapter',
      title: '第 001 章 · 初醒',
      chapterNumber: 1,
    })

    expect(
      resolveWorkbenchSelectionHandoff({
        sectionId: 'blueprint',
        selectedItem: chapter,
        chapterView: 'text',
        artifact: { id: 'manuscript', title: '正文' },
      }),
    ).toMatchObject({ command: 'rewrite', sourceTitle: '第 001 章 · 初醒 · 正文', selectedChapter: 1 })

    expect(
      resolveWorkbenchSelectionHandoff({
        sectionId: 'blueprint',
        selectedItem: chapter,
        chapterView: 'review',
        artifact: { id: 'review', title: '审修报告' },
      }),
    ).toMatchObject({ command: 'rewrite', sourceTitle: '第 001 章 · 初醒 · 审修报告', selectedChapter: 1 })

    expect(
      resolveWorkbenchSelectionHandoff({
        sectionId: 'blueprint',
        selectedItem: chapter,
        chapterView: 'outline',
        artifact: { id: 'chapter-outline', title: '章节大纲' },
      }),
    ).toMatchObject({ command: 'plan', sourceTitle: '第 001 章 · 初醒 · 章节大纲', selectedChapter: 1 })
  })

  test('does not offer a selection handoff for an interrupted-draft chapter manuscript (staging read-only preview)', () => {
    const chapter = item({
      id: 'chapter-2',
      kind: 'chapter',
      title: '第 002 章 · 远行',
      chapterNumber: 2,
    })

    expect(
      resolveWorkbenchSelectionHandoff({
        sectionId: 'blueprint',
        selectedItem: chapter,
        chapterView: 'text',
        artifact: { id: 'manuscript', title: '正文', isDraft: true },
      }),
    ).toBeNull()
  })

  test('keeps offering the normal rewrite handoff when the chapter manuscript is not a staging draft', () => {
    const chapter = item({
      id: 'chapter-2',
      kind: 'chapter',
      title: '第 002 章 · 远行',
      chapterNumber: 2,
    })

    expect(
      resolveWorkbenchSelectionHandoff({
        sectionId: 'blueprint',
        selectedItem: chapter,
        chapterView: 'text',
        artifact: { id: 'manuscript', title: '正文', isDraft: false },
      }),
    ).toMatchObject({ command: 'rewrite', sourceTitle: '第 002 章 · 远行 · 正文', selectedChapter: 2 })
  })

  test('does not offer selection handoff for reference works', () => {
    expect(
      resolveWorkbenchSelectionHandoff({
        sectionId: 'reference-works',
        selectedItem: item({ id: 'reference-works', kind: 'reference-list', title: '参考作品' }),
        chapterView: 'text',
        artifact: { id: 'reference-guidance', title: '参考指导' },
      }),
    ).toBeNull()
  })

  test('creates a composer handoff with reference context and an empty draft requirement', () => {
    const descriptor = resolveWorkbenchSelectionHandoff({
      sectionId: 'settings',
      selectedItem: item({ id: 'world', kind: 'world-list', title: '世界观设定' }),
      chapterView: 'text',
      artifact: { id: 'world-setting', title: '边境城' },
    })

    expect(descriptor).not.toBeNull()

    const handoff = createWorkbenchSelectionComposerHandoff(descriptor!, '  第一段 \n\n\n 第二段  ')

    expect(handoff).toMatchObject({
      sourceActionId: 'selection-world-world-setting',
      command: 'world',
      prompt: '',
      referenceContext: {
        sourceTitle: '边境城',
        text: '第一段\n\n第二段',
      },
    })
  })

  test('normalizes selected markdown text before handoff', () => {
    expect(normalizeSelectedMarkdownText(' A\u00a0B \n\n\n C\t\n')).toBe('A B\n\nC')
  })
})
