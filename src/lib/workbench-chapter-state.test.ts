import { describe, expect, test } from 'bun:test'
import {
  resolveChapterDirectoryTag,
  resolveCurrentStageChapterId,
  resolveCurrentStageVolumeTag,
  resolveDefaultChapterView,
  resolveDeferTargets,
} from './workbench-chapter-state'
import type { NovelTocItem, NovelWorkbenchTreeItem } from '@shared/types/novel'

describe('workbench chapter state', () => {
  test('uses the first unfinished chapter as the current stage', () => {
    const tocItems: NovelTocItem[] = [
      { id: 'volume-1', kind: 'volume', title: '第 1 卷', volumeNumber: 1 },
      {
        id: 'chapter-1',
        kind: 'chapter',
        title: '第 001 章',
        chapterNumber: 1,
        volumeNumber: 1,
        status: 'completed',
      },
      {
        id: 'chapter-2',
        kind: 'chapter',
        title: '第 002 章',
        chapterNumber: 2,
        volumeNumber: 1,
        status: 'missing-outline',
      },
      {
        id: 'chapter-3',
        kind: 'chapter',
        title: '第 003 章',
        chapterNumber: 3,
        volumeNumber: 1,
        status: 'planned',
      },
    ]

    expect(resolveCurrentStageChapterId(tocItems)).toBe('chapter-2')
  })

  test('returns no current stage when every chapter is completed', () => {
    const tocItems: NovelTocItem[] = [
      { id: 'volume-1', kind: 'volume', title: '第 1 卷', volumeNumber: 1 },
      {
        id: 'chapter-1',
        kind: 'chapter',
        title: '第 001 章',
        chapterNumber: 1,
        volumeNumber: 1,
        status: 'completed',
      },
    ]

    expect(resolveCurrentStageChapterId(tocItems)).toBeNull()
  })

  test('opens missing-outline chapters on the chapter outline tab by default', () => {
    const chapter: NovelWorkbenchTreeItem = {
      id: 'chapter-2',
      kind: 'chapter',
      title: '第 002 章',
      level: 1,
      chapterNumber: 2,
      status: 'missing-outline',
    }

    expect(resolveDefaultChapterView(chapter)).toBe('outline')
  })

  test('opens other chapter states on the manuscript tab by default', () => {
    const chapter: NovelWorkbenchTreeItem = {
      id: 'chapter-3',
      kind: 'chapter',
      title: '第 003 章',
      level: 1,
      chapterNumber: 3,
      status: 'planned',
    }

    expect(resolveDefaultChapterView(chapter)).toBe('text')
    expect(resolveDefaultChapterView(null)).toBe('text')
  })

  test('renders the current stage tag with high contrast text treatment', () => {
    const tag = resolveChapterDirectoryTag({
      chapterId: 'chapter-2',
      currentChapterId: 'chapter-2',
      status: 'planned',
    })

    expect(tag?.label).toBe('当前阶段')
    expect(tag?.className).toContain('bg-brand')
    expect(tag?.className).toContain('text-white')
    expect(tag?.className).toContain('font-semibold')
    expect(tag?.className).not.toContain('text-brand-foreground')
  })

  test('renders recoverable chapters as待恢复 instead of ordinary current stage', () => {
    const tag = resolveChapterDirectoryTag({
      chapterId: 'chapter-2',
      currentChapterId: 'chapter-2',
      status: 'recoverable',
    })

    expect(tag).toEqual(
      expect.objectContaining({
        id: 'recoverable',
        label: '待恢复',
      }),
    )
    expect(tag?.className).toContain('bg-warning')
    expect(tag?.className).not.toContain('bg-brand')
  })

  test('renders interrupted-draft chapters as写作中断', () => {
    const tag = resolveChapterDirectoryTag({
      chapterId: 'chapter-2',
      currentChapterId: 'chapter-3',
      status: 'interrupted-draft',
    })

    expect(tag).toEqual(
      expect.objectContaining({
        id: 'interrupted-draft',
        label: '写作中断',
      }),
    )
    expect(tag?.className).toContain('bg-warning')
  })

  test('promotes the current stage tag to a collapsed volume row only', () => {
    const chapters: NovelTocItem[] = [
      {
        id: 'chapter-2',
        kind: 'chapter',
        title: '第 002 章',
        chapterNumber: 2,
        volumeNumber: 1,
        status: 'planned',
      },
    ]

    expect(resolveCurrentStageVolumeTag({ chapters, currentChapterId: 'chapter-2', expanded: false })).toEqual(
      expect.objectContaining({
        id: 'current',
        label: '当前阶段',
      }),
    )
    expect(resolveCurrentStageVolumeTag({ chapters, currentChapterId: 'chapter-2', expanded: true })).toBeNull()
    expect(resolveCurrentStageVolumeTag({ chapters, currentChapterId: 'chapter-3', expanded: false })).toBeNull()
  })

  test('promotes recoverable chapter state to a collapsed volume row', () => {
    const chapters: NovelTocItem[] = [
      {
        id: 'chapter-2',
        kind: 'chapter',
        title: '第 002 章',
        chapterNumber: 2,
        volumeNumber: 1,
        status: 'recoverable',
      },
    ]

    expect(resolveCurrentStageVolumeTag({ chapters, currentChapterId: 'chapter-2', expanded: false })).toEqual(
      expect.objectContaining({
        id: 'recoverable',
        label: '待恢复',
      }),
    )
  })

  describe('resolveDeferTargets（Task 7：未兑现计划「移到后续章」候选章号）', () => {
    const tocItems: NovelTocItem[] = [
      { id: 'volume-1', kind: 'volume', title: '第 1 卷', volumeNumber: 1 },
      { id: 'chapter-10', kind: 'chapter', title: '第 010 章', chapterNumber: 10, status: 'completed' },
      { id: 'chapter-11', kind: 'chapter', title: '第 011 章', chapterNumber: 11, status: 'in-progress' },
      { id: 'chapter-12', kind: 'chapter', title: '第 012 章', chapterNumber: 12, status: 'planned' },
      { id: 'chapter-13', kind: 'chapter', title: '第 013 章', chapterNumber: 13, status: 'missing-outline' },
    ]

    test('候选=本章之后且非 completed 的章，按章号升序', () => {
      expect(resolveDeferTargets(tocItems, 10)).toEqual([11, 12, 13])
    })

    test('本章之后全 completed（或无更后续章）→ 空数组', () => {
      expect(resolveDeferTargets(tocItems, 13)).toEqual([])
      expect(
        resolveDeferTargets(
          [{ id: 'chapter-1', kind: 'chapter', title: '第 001 章', chapterNumber: 1, status: 'completed' }],
          1,
        ),
      ).toEqual([])
    })

    test('本章之前/等于本章的章号不计入候选，即便未完成', () => {
      expect(resolveDeferTargets(tocItems, 12)).toEqual([13])
    })

    test('volume 项与已完成章一并忽略（即便章号在候选区间内）', () => {
      // chapter-10 已完成，即便章号 > 9 也不进候选；volume-1 无 chapterNumber 天然被过滤
      expect(resolveDeferTargets(tocItems, 9)).toEqual([11, 12, 13])
    })
  })
})
