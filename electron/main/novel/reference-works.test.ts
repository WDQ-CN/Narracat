import { mkdir, mkdtemp, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { createNovelProjectFixture } from './test-novel-fixture'
import {
  clearReferenceGuidance,
  getReferenceWorksSummary,
  importReferenceSourceFiles,
  pasteReferenceSource,
  removeReferenceSource,
  resetReferenceWorks,
} from './reference-works'

describe('reference works project files', () => {
  test('saves pasted excerpts as markdown with safe readable filenames', async () => {
    const { root } = await createNovelProjectFixture({ name: 'reference-works-paste', state: 'empty' })

    const result = await pasteReferenceSource({
      projectPath: root,
      title: '  苍穹/第一章  ',
      content: '少年推开门，看见风雪落满长街。',
    })

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({
      fileName: '苍穹-第一章.md',
      title: '苍穹-第一章',
      relativePath: 'bible/references/苍穹-第一章.md',
      extension: '.md',
    })
    await expect(readFile(join(root, 'bible', 'references', '苍穹-第一章.md'), 'utf-8')).resolves.toBe(
      '# 苍穹/第一章\n\n少年推开门，看见风雪落满长街。\n',
    )
  })

  test('adds duplicate pasted titles as additional sources without clearing existing guidance', async () => {
    const { root } = await createNovelProjectFixture({ name: 'reference-works-duplicate', state: 'empty' })
    const guidanceDir = join(root, 'bible', 'reference-guidance')
    await mkdir(guidanceDir, { recursive: true })
    await writeFile(join(guidanceDir, 'index.md'), '# 参考指导\n\n旧分析。\n', 'utf-8')

    const first = await pasteReferenceSource({ projectPath: root, title: '参考片段', content: '第一段。' })
    const second = await pasteReferenceSource({ projectPath: root, title: '参考片段', content: '第二段。' })

    expect(first.sources.map((item) => item.fileName)).toEqual(['参考片段.md'])
    expect(second.sources.map((item) => item.fileName)).toEqual(['参考片段.md', '参考片段-2.md'])
    await expect(readFile(join(root, 'bible', 'references', '参考片段.md'), 'utf-8')).resolves.toContain('第一段。')
    await expect(readFile(join(root, 'bible', 'references', '参考片段-2.md'), 'utf-8')).resolves.toContain('第二段。')
    await expect(readFile(join(guidanceDir, 'index.md'), 'utf-8')).resolves.toContain('旧分析。')
  })

  test('imports multiple markdown or text sources and rejects unsupported extensions', async () => {
    const { root } = await createNovelProjectFixture({ name: 'reference-works-import', state: 'empty' })
    const sourceRoot = await mkdtemp(join(tmpdir(), 'narracat-reference-works-source-'))
    const txtSource = join(sourceRoot, '喜欢的节奏.txt')
    const mdSource = join(sourceRoot, '长篇小说.md')
    const pdfSource = join(sourceRoot, '扫描件.pdf')
    await writeFile(txtSource, '一句短句。\n下一句推进。\n', 'utf-8')
    await writeFile(mdSource, '# 长篇小说\n\n第一章。\n', 'utf-8')
    await writeFile(pdfSource, '%PDF-1.7', 'utf-8')

    const imported = await importReferenceSourceFiles({ projectPath: root, sourcePaths: [txtSource, mdSource] })

    expect(imported.sources).toEqual([
      expect.objectContaining({
        fileName: '喜欢的节奏.txt',
        title: '喜欢的节奏',
        relativePath: 'bible/references/喜欢的节奏.txt',
        extension: '.txt',
      }),
      expect.objectContaining({
        fileName: '长篇小说.md',
        title: '长篇小说',
        relativePath: 'bible/references/长篇小说.md',
        extension: '.md',
      }),
    ])
    await expect(readFile(join(root, 'bible', 'references', '喜欢的节奏.txt'), 'utf-8')).resolves.toBe(
      '一句短句。\n下一句推进。\n',
    )
    await expect(readFile(join(root, 'bible', 'references', '长篇小说.md'), 'utf-8')).resolves.toBe(
      '# 长篇小说\n\n第一章。\n',
    )
    await expect(importReferenceSourceFiles({ projectPath: root, sourcePaths: [pdfSource] })).rejects.toThrow(
      '仅支持导入 .md 或 .txt 文件。',
    )
  })

  test('rejects empty pasted content and unsafe remove filenames', async () => {
    const { root } = await createNovelProjectFixture({ name: 'reference-works-safety', state: 'empty' })

    await expect(pasteReferenceSource({ projectPath: root, title: '空内容', content: '   \n\t' })).rejects.toThrow(
      '参考作品正文不能为空。',
    )
    await expect(removeReferenceSource({ projectPath: root, fileName: '../outside.txt' })).rejects.toThrow(
      '参考作品文件名非法。',
    )
  })

  test('removes one source without clearing the remaining sources or guidance', async () => {
    const { root } = await createNovelProjectFixture({ name: 'reference-works-remove', state: 'empty' })
    await pasteReferenceSource({ projectPath: root, title: '误传片段', content: '不适合作为参考。' })
    await pasteReferenceSource({ projectPath: root, title: '保留片段', content: '这个要继续作为参考。' })
    const guidanceDir = join(root, 'bible', 'reference-guidance')
    await mkdir(guidanceDir, { recursive: true })
    await writeFile(join(guidanceDir, 'index.md'), '# 参考指导\n\n保留的指导。\n', 'utf-8')

    const result = await removeReferenceSource({ projectPath: root, fileName: '误传片段.md' })

    expect(result.sources.map((item) => item.fileName)).toEqual(['保留片段.md'])
    await expect(readdir(join(root, 'bible', 'references'))).resolves.toEqual(['保留片段.md'])
    await expect(stat(join(root, 'bible', 'references', '误传片段.md'))).rejects.toThrow()
    await expect(readFile(join(guidanceDir, 'index.md'), 'utf-8')).resolves.toContain('保留的指导。')
  })

  test('keeps guidance stale after deleting the last source instead of treating delete as reset', async () => {
    const { root } = await createNovelProjectFixture({ name: 'reference-works-remove-last', state: 'empty' })
    await pasteReferenceSource({ projectPath: root, title: '参考片段', content: '第一段。' })
    const guidanceDir = join(root, 'bible', 'reference-guidance')
    await mkdir(guidanceDir, { recursive: true })
    await writeFile(join(guidanceDir, 'index.md'), '# 参考指导\n\n保留到 reset。\n', 'utf-8')

    const result = await removeReferenceSource({ projectPath: root, fileName: '参考片段.md' })

    expect(result.sources).toHaveLength(0)
    expect(result.status).toMatchObject({
      guidanceState: 'stale',
      sourceCount: 0,
      needsAnalysis: false,
      stale: true,
      guidanceExists: true,
    })
    await expect(readFile(join(guidanceDir, 'index.md'), 'utf-8')).resolves.toContain('保留到 reset。')
  })

  test('clears guidance separately from reset reference works', async () => {
    const { root } = await createNovelProjectFixture({ name: 'reference-works-reset', state: 'empty' })
    await pasteReferenceSource({ projectPath: root, title: '参考片段', content: '第一段。' })
    const guidanceDir = join(root, 'bible', 'reference-guidance')
    await mkdir(guidanceDir, { recursive: true })
    await writeFile(join(guidanceDir, 'index.md'), '# 参考指导\n\n已有分析。\n', 'utf-8')

    const cleared = await clearReferenceGuidance(root)

    expect(cleared.sources.map((item) => item.fileName)).toEqual(['参考片段.md'])
    expect(cleared.status.guidanceExists).toBe(false)
    await expect(stat(join(guidanceDir, 'index.md'))).rejects.toThrow()

    await mkdir(guidanceDir, { recursive: true })
    await writeFile(join(guidanceDir, 'index.md'), '# 参考指导\n\n已有分析。\n', 'utf-8')
    const reset = await resetReferenceWorks(root)

    expect(reset.sources).toHaveLength(0)
    expect(reset.status.guidanceExists).toBe(false)
    await expect(readdir(join(root, 'bible', 'references'))).resolves.toEqual([])
    await expect(stat(join(guidanceDir, 'index.md'))).rejects.toThrow()
  })
})

describe('reference works guidance status', () => {
  test('reports empty, needs-analysis, current, and stale states from source and guidance mtimes', async () => {
    const { root } = await createNovelProjectFixture({ name: 'reference-works-status', state: 'empty' })
    await expect(getReferenceWorksSummary(root)).resolves.toMatchObject({
      status: {
        guidanceState: 'empty',
        sourceCount: 0,
        needsAnalysis: false,
        guidanceExists: false,
      },
    })

    await pasteReferenceSource({ projectPath: root, title: '参考 A', content: '节奏明快。' })
    await expect(getReferenceWorksSummary(root)).resolves.toMatchObject({
      status: {
        guidanceState: 'needs-analysis',
        sourceCount: 1,
        needsAnalysis: true,
        guidanceExists: false,
      },
    })

    const oldRefTime = new Date('2026-05-19T00:00:00.000Z')
    const newArtifactTime = new Date('2026-05-20T00:00:00.000Z')
    const refPath = join(root, 'bible', 'references', '参考 A.md')
    const referencesDir = join(root, 'bible', 'references')
    const guidanceDir = join(root, 'bible', 'reference-guidance')
    const indexPath = join(guidanceDir, 'index.md')
    await mkdir(guidanceDir, { recursive: true })
    await writeFile(indexPath, '# 参考指导\n\n已有分析。\n', 'utf-8')
    await utimes(refPath, oldRefTime, oldRefTime)
    await utimes(referencesDir, oldRefTime, oldRefTime)
    await utimes(indexPath, newArtifactTime, newArtifactTime)

    await expect(getReferenceWorksSummary(root)).resolves.toMatchObject({
      status: {
        guidanceState: 'current',
        sourceCount: 1,
        needsAnalysis: false,
        stale: false,
        guidanceExists: true,
      },
      guidance: {
        exists: true,
        relativePath: 'bible/reference-guidance/index.md',
        content: '# 参考指导\n\n已有分析。\n',
      },
    })

    const newerRefTime = new Date('2026-05-21T00:00:00.000Z')
    await utimes(refPath, newerRefTime, newerRefTime)
    await utimes(referencesDir, newerRefTime, newerRefTime)
    await expect(getReferenceWorksSummary(root)).resolves.toMatchObject({
      status: {
        guidanceState: 'stale',
        needsAnalysis: true,
        stale: true,
        guidanceExists: true,
      },
    })
  })

  test('summarizes guidance directory markdown files when index is missing', async () => {
    const { root } = await createNovelProjectFixture({ name: 'reference-works-guidance-summary', state: 'empty' })
    await pasteReferenceSource({ projectPath: root, title: '参考 A', content: '节奏明快。' })
    const guidanceDir = join(root, 'bible', 'reference-guidance')
    await mkdir(guidanceDir, { recursive: true })
    await writeFile(join(guidanceDir, 'tone.md'), '# Tone\n', 'utf-8')
    await writeFile(join(guidanceDir, 'structure.md'), '# Structure\n', 'utf-8')

    await expect(getReferenceWorksSummary(root)).resolves.toMatchObject({
      guidance: {
        exists: true,
        relativePath: 'bible/reference-guidance',
        content: expect.stringContaining('- tone.md'),
      },
      status: {
        guidanceExists: true,
      },
    })
  })
})
