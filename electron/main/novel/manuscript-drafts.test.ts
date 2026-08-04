import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  discardManuscriptDraft,
  listManuscriptDrafts,
  manuscriptDraftPath,
  parseManuscriptDraftInput,
  parseSaveManuscriptDraftInput,
  readManuscriptDraft,
  saveManuscriptDraft,
} from './manuscript-drafts.ts'
import { createNovelProjectFixture } from './test-novel-fixture.ts'

const BASE_TEXT = '# 第1章: 初醒\n\n正文'
const DRAFT_TEXT = '# 第1章: 初醒\n\n作者修改后的正文'

describe('manuscript drafts', () => {
  let projectPath: string

  beforeEach(async () => {
    projectPath = (await createNovelProjectFixture({ name: 'drafts' })).root
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  test('同基线草稿可恢复，且目录清单只暴露章号和更新时间', async () => {
    await saveManuscriptDraft({ projectPath, chapter: 1, baseVisibleText: BASE_TEXT, draftText: DRAFT_TEXT })

    const state = await readManuscriptDraft({ projectPath, chapter: 1 })
    expect(state.status).toBe('recoverable')
    if (state.status === 'recoverable') {
      expect(state.draftText).toBe(DRAFT_TEXT)
      expect(state.diskText).toBe(BASE_TEXT)
    }

    const file = JSON.parse(await readFile(manuscriptDraftPath(projectPath, 1), 'utf-8'))
    expect(file.schemaVersion).toBe(1)
    expect(file.baseContentHash).toHaveLength(64)
    expect(file.baseVisibleText).toBe(BASE_TEXT)

    const summaries = await listManuscriptDrafts(projectPath)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.chapter).toBe(1)
    expect(summaries[0]?.updatedAt.length).toBeGreaterThan(0)
  })

  test('磁盘正文外部变化后绝不自动合并，返回两份完整文本', async () => {
    await saveManuscriptDraft({ projectPath, chapter: 1, baseVisibleText: BASE_TEXT, draftText: DRAFT_TEXT })
    await writeFile(join(projectPath, 'manuscript', 'vol-01', 'ch-001.md'), '# 第1章: 初醒\n\nAgent 新正文\n', 'utf-8')

    const state = await readManuscriptDraft({ projectPath, chapter: 1 })
    expect(state.status).toBe('conflict')
    if (state.status === 'conflict') {
      expect(state.draftText).toBe(DRAFT_TEXT)
      expect(state.diskText).toContain('Agent 新正文')
    }
  })

  test('草稿内容已经等于磁盘正文时按 stale 自动清理', async () => {
    await saveManuscriptDraft({ projectPath, chapter: 1, baseVisibleText: BASE_TEXT, draftText: DRAFT_TEXT })
    await writeFile(join(projectPath, 'manuscript', 'vol-01', 'ch-001.md'), `${DRAFT_TEXT}\n`, 'utf-8')

    expect(await readManuscriptDraft({ projectPath, chapter: 1 })).toEqual({ status: 'none' })
    expect(await listManuscriptDrafts(projectPath)).toEqual([])
  })

  test('回改到基线等价于删除草稿', async () => {
    await saveManuscriptDraft({ projectPath, chapter: 1, baseVisibleText: BASE_TEXT, draftText: DRAFT_TEXT })
    await saveManuscriptDraft({ projectPath, chapter: 1, baseVisibleText: BASE_TEXT, draftText: `${BASE_TEXT}\n` })

    expect(await readManuscriptDraft({ projectPath, chapter: 1 })).toEqual({ status: 'none' })
  })

  test('同章并发调用严格串行，后发的新草稿最终胜出', async () => {
    await Promise.all([
      saveManuscriptDraft({
        projectPath,
        chapter: 1,
        baseVisibleText: BASE_TEXT,
        draftText: `${DRAFT_TEXT}（旧）`,
      }),
      saveManuscriptDraft({
        projectPath,
        chapter: 1,
        baseVisibleText: BASE_TEXT,
        draftText: `${DRAFT_TEXT}（新）`,
      }),
    ])

    const state = await readManuscriptDraft({ projectPath, chapter: 1 })
    expect(state.status).toBe('recoverable')
    if (state.status === 'recoverable') expect(state.draftText).toEndWith('（新）')
  })

  test('损坏 JSON 隔离并返回可追踪 errorId', async () => {
    const path = manuscriptDraftPath(projectPath, 1)
    await mkdir(join(projectPath, '.narracat', 'manuscript-drafts'), { recursive: true })
    await writeFile(path, '{{{', 'utf-8')

    const state = await readManuscriptDraft({ projectPath, chapter: 1 })
    expect(state.status).toBe('corrupt')
    if (state.status === 'corrupt') expect(state.errorId).toStartWith('draft-')
    expect((await readdir(join(projectPath, '.narracat', 'manuscript-drafts'))).some((name) => name.includes('.corrupt-'))).toBe(
      true,
    )
  })

  test('草稿目录读取失败不伪装成空清单', async () => {
    const draftsDir = join(projectPath, '.narracat', 'manuscript-drafts')
    await writeFile(draftsDir, 'not-a-directory', 'utf-8')

    await expect(listManuscriptDrafts(projectPath)).rejects.toThrow()
  })

  test('显式放弃删除草稿，伪造项目和非法章号被拒绝', async () => {
    await saveManuscriptDraft({ projectPath, chapter: 1, baseVisibleText: BASE_TEXT, draftText: DRAFT_TEXT })
    await discardManuscriptDraft({ projectPath, chapter: 1 })
    expect(await readManuscriptDraft({ projectPath, chapter: 1 })).toEqual({ status: 'none' })

    expect(() => parseManuscriptDraftInput({ projectPath, chapter: 0 })).toThrow()
    expect(() => parseManuscriptDraftInput({ projectPath: '../outside', chapter: 1 })).toThrow()
    expect(() =>
      parseSaveManuscriptDraftInput({ projectPath, chapter: 1, baseVisibleText: BASE_TEXT }),
    ).toThrow()
    await expect(listManuscriptDrafts(join(projectPath, 'missing'))).rejects.toThrow('有效的 NarraCat')
    await expect(readFile(manuscriptDraftPath(projectPath, 1), 'utf-8')).rejects.toThrow()
  })
})
