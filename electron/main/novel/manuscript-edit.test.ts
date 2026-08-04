import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  applyManuscriptEdit,
  joinChapterMetadataComment,
  locateManuscriptFile,
  parseManuscriptEditInput,
  restoreManuscriptRevision,
  splitChapterMetadataComment,
  submitManuscriptEdit,
} from './manuscript-edit.ts'
import { manuscriptRevisionStore } from './manuscript-revisions.ts'
import { createNovelProjectFixture } from './test-novel-fixture.ts'

const METADATA_COMMENT = '<!-- chapter_metadata: {"chapter_num":13,"summary":"旧摘要"} -->'
const VISIBLE = ['林昭推开门，屋里一片漆黑。', '', '他摸索着点燃了油灯。'].join('\n')
const FULL = `${VISIBLE}\n\n${METADATA_COMMENT}\n`

describe('splitChapterMetadataComment / joinChapterMetadataComment', () => {
  test('拆出可见正文与元数据注释，拼回 roundtrip 保持注释原样', () => {
    const { visibleText, metadataComments } = splitChapterMetadataComment(FULL)
    expect(visibleText).toBe(VISIBLE)
    expect(metadataComments).toEqual([METADATA_COMMENT])
    expect(joinChapterMetadataComment(visibleText, metadataComments)).toBe(FULL)
  })

  test('无元数据的章拆拼不产生多余内容', () => {
    const { visibleText, metadataComments } = splitChapterMetadataComment(`${VISIBLE}\n`)
    expect(metadataComments).toEqual([])
    expect(joinChapterMetadataComment(visibleText, metadataComments)).toBe(`${VISIBLE}\n`)
  })
})

describe('applyManuscriptEdit · 乐观锁', () => {
  test('expected 与磁盘可见文一致时通过，元数据以磁盘版拼回', () => {
    const out = applyManuscriptEdit({ diskContent: FULL, expectedVisibleText: VISIBLE, newVisibleText: '全新正文。' })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.nextContent).toBe(`全新正文。\n\n${METADATA_COMMENT}\n`)
      expect(out.oldVisibleText).toBe(VISIBLE)
    }
  })

  test('磁盘已被改（Agent 写过）→ 冲突拒绝', () => {
    const out = applyManuscriptEdit({
      diskContent: FULL.replace('油灯', '蜡烛'),
      expectedVisibleText: VISIBLE,
      newVisibleText: '全新正文。',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.conflict).toBe(true)
  })
})

describe('parseManuscriptEditInput', () => {
  test('合法入参解析', () => {
    expect(
      parseManuscriptEditInput({ projectPath: '/p', chapter: 13, expectedVisibleText: 'a', newVisibleText: 'b' }),
    ).toEqual({ projectPath: '/p', chapter: 13, expectedVisibleText: 'a', newVisibleText: 'b' })
  })
  test('空正文拒绝', () => {
    expect(() =>
      parseManuscriptEditInput({ projectPath: '/p', chapter: 13, expectedVisibleText: 'a', newVisibleText: '  ' }),
    ).toThrow()
  })
})

describe('submitManuscriptEdit · 真实文件读写', () => {
  let projectPath: string

  beforeEach(async () => {
    projectPath = (await createNovelProjectFixture({ name: 'manuscript-edit' })).root
    await mkdir(join(projectPath, 'manuscript', 'vol-01'), { recursive: true })
    await writeFile(join(projectPath, 'manuscript', 'vol-01', 'ch-013.md'), FULL, 'utf-8')
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  test('locateManuscriptFile 命中 vol 目录零填充路径', async () => {
    expect(await locateManuscriptFile(projectPath, 13)).toBe(join(projectPath, 'manuscript', 'vol-01', 'ch-013.md'))
  })

  test('locateManuscriptFile 兼容 legacy 扁平非补零路径', async () => {
    await writeFile(join(projectPath, 'manuscript', 'ch-7.md'), '正文。\n', 'utf-8')
    expect(await locateManuscriptFile(projectPath, 7)).toBe(join(projectPath, 'manuscript', 'ch-7.md'))
  })

  test('小改保存：silent、文件更新、元数据保留、留痕追加、无待同步标记', async () => {
    const result = await submitManuscriptEdit({
      projectPath,
      chapter: 13,
      expectedVisibleText: VISIBLE,
      newVisibleText: VISIBLE.replace('摸索着', '摸黑'),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.triage.tier).toBe('silent')

    const written = await readFile(join(projectPath, 'manuscript', 'vol-01', 'ch-013.md'), 'utf-8')
    expect(written).toContain('摸黑')
    expect(written).toContain(METADATA_COMMENT)

    const log = await readFile(join(projectPath, '.narracat', 'manuscript-edits.jsonl'), 'utf-8')
    expect(log.trim().split('\n').length).toBe(1)
    const history = await manuscriptRevisionStore.listChapter({ projectPath, chapter: 13 })
    expect(history.revisions).toHaveLength(1)
    expect(history.revisions[0]?.source).toBe('author-save')
    expect(
      (
        await manuscriptRevisionStore.readRevision({
          projectPath,
          chapter: 13,
          revisionId: history.revisions[0]!.id,
        })
      ).visibleText,
    ).toBe(VISIBLE)

    // silent 不写待同步标记
    let pendingExists = true
    try {
      await readFile(join(projectPath, '.narracat', 'pending-memory-sync.json'), 'utf-8')
    } catch {
      pendingExists = false
    }
    expect(pendingExists).toBe(false)
  })

  test('整段删除保存：impact + 写待同步标记', async () => {
    const result = await submitManuscriptEdit({
      projectPath,
      chapter: 13,
      expectedVisibleText: VISIBLE,
      newVisibleText: '林昭推开门，屋里一片漆黑。',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.triage.tier).toBe('impact')
      expect(result.triage.reasons).toContain('有整段增删')
    }
    const pending = JSON.parse(await readFile(join(projectPath, '.narracat', 'pending-memory-sync.json'), 'utf-8'))
    expect(pending['13'].reasons).toContain('有整段增删')
  })

  test('章不存在 → ok:false', async () => {
    const result = await submitManuscriptEdit({
      projectPath,
      chapter: 99,
      expectedVisibleText: 'x',
      newVisibleText: 'y',
    })
    expect(result.ok).toBe(false)
  })

  test('restore 复用保存管线：保留最新 metadata、留下恢复前版本并强制标记记忆待同步', async () => {
    const first = await submitManuscriptEdit({
      projectPath,
      chapter: 13,
      expectedVisibleText: VISIBLE,
      newVisibleText: '作者第二版正文。',
    })
    expect(first.ok).toBe(true)
    const originalRevision = (await manuscriptRevisionStore.listChapter({ projectPath, chapter: 13 })).revisions[0]!

    const latestMetadata = '<!-- chapter_metadata: {"chapter_num":13,"summary":"最新摘要"} -->'
    await writeFile(
      join(projectPath, 'manuscript', 'vol-01', 'ch-013.md'),
      `作者第二版正文。\n\n${latestMetadata}\n`,
      'utf-8',
    )
    const restored = await restoreManuscriptRevision({
      projectPath,
      chapter: 13,
      revisionId: originalRevision.id,
      expectedVisibleText: '作者第二版正文。',
    })
    expect(restored.ok).toBe(true)
    if (restored.ok) {
      expect(restored.triage.tier).toBe('impact')
      expect(restored.triage.reasons).toContain('从正文版本历史恢复')
    }

    const disk = await readFile(join(projectPath, 'manuscript', 'vol-01', 'ch-013.md'), 'utf-8')
    expect(disk).toContain(VISIBLE)
    expect(disk).toContain(latestMetadata)
    const history = await manuscriptRevisionStore.listChapter({ projectPath, chapter: 13 })
    expect(history.revisions).toHaveLength(2)
    expect(history.revisions[0]?.source).toBe('revision-restore')
    expect(
      (
        await manuscriptRevisionStore.readRevision({
          projectPath,
          chapter: 13,
          revisionId: history.revisions[0]!.id,
        })
      ).visibleText,
    ).toBe('作者第二版正文。')
    const pending = JSON.parse(await readFile(join(projectPath, '.narracat', 'pending-memory-sync.json'), 'utf-8'))
    expect(pending['13'].reasons).toContain('从正文版本历史恢复')
  })

  test('restore 乐观锁冲突时不覆盖磁盘正文或 metadata，也不新增 revision', async () => {
    await submitManuscriptEdit({
      projectPath,
      chapter: 13,
      expectedVisibleText: VISIBLE,
      newVisibleText: '作者第二版正文。',
    })
    const revision = (await manuscriptRevisionStore.listChapter({ projectPath, chapter: 13 })).revisions[0]!
    const beforeCount = (await manuscriptRevisionStore.listChapter({ projectPath, chapter: 13 })).revisions.length

    const result = await restoreManuscriptRevision({
      projectPath,
      chapter: 13,
      revisionId: revision.id,
      expectedVisibleText: '过期的正文基线',
    })
    expect(result).toMatchObject({ ok: false, conflict: true })
    expect(await readFile(join(projectPath, 'manuscript', 'vol-01', 'ch-013.md'), 'utf-8')).toContain('作者第二版正文。')
    expect((await manuscriptRevisionStore.listChapter({ projectPath, chapter: 13 })).revisions).toHaveLength(
      beforeCount,
    )
  })
})
