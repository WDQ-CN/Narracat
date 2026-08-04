import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { runSubagentGate } from './engine-subagent-gates'

async function makeProject({
  chapter = 1,
  volume,
  wordsPerChapter,
  manuscriptBody,
  manuscriptRelPath,
  contextPack,
  receiptText,
}: {
  chapter?: number
  volume?: number
  wordsPerChapter?: number
  manuscriptBody?: string
  manuscriptRelPath?: string
  contextPack?: unknown
  receiptText?: string
}) {
  const root = await mkdtemp(join(tmpdir(), 'narracat-subagent-gate-'))
  await mkdir(join(root, '.narracat', 'context-packs'), { recursive: true })
  await mkdir(join(root, '.narracat', 'receipts'), { recursive: true })

  const structureLines =
    volume !== undefined ? ['structure:', '  chapter_to_volume:', `    ${chapter}: ${volume}`] : []
  await writeFile(
    join(root, '.narracat', 'state.yaml'),
    ['progress:', `  in_progress_chapter: ${chapter}`, ...structureLines, ''].join('\n'),
    'utf-8',
  )

  if (wordsPerChapter !== undefined) {
    await writeFile(join(root, '.narracat', 'config.yaml'), `words_per_chapter: ${wordsPerChapter}\n`, 'utf-8')
  }

  if (manuscriptBody !== undefined) {
    const nnn = String(chapter).padStart(3, '0')
    const relPath = manuscriptRelPath ?? join('manuscript', 'vol-01', `ch-${nnn}.md`)
    await mkdir(join(root, join(relPath, '..')), { recursive: true })
    await writeFile(join(root, relPath), manuscriptBody, 'utf-8')
  }

  if (contextPack !== undefined) {
    const nnn = String(chapter).padStart(3, '0')
    await writeFile(
      join(root, '.narracat', 'context-packs', `ch-${nnn}.json`),
      JSON.stringify(contextPack),
      'utf-8',
    )
  }

  if (receiptText !== undefined) {
    const nnn = String(chapter).padStart(3, '0')
    await writeFile(join(root, '.narracat', 'receipts', `ch-${nnn}.json`), receiptText, 'utf-8')
  }

  return root
}

describe('runSubagentGate', () => {
  test('agentId 非 chapter-writer/memory-keeper → []（IO 全跳过）', async () => {
    const result = await runSubagentGate('outline-architect', '/nonexistent-project-dir')
    expect(result).toEqual([])
  })

  test('state.yaml 缺失 → []', async () => {
    const root = await mkdtemp(join(tmpdir(), 'narracat-subagent-gate-'))
    expect(await runSubagentGate('chapter-writer', root)).toEqual([])
    expect(await runSubagentGate('memory-keeper', root)).toEqual([])
  })

  test('chapter-writer 主路径：有卷号 → 命中 manuscript/vol-VV/ch-NNN.md，字数区间内无提示', async () => {
    const root = await makeProject({
      chapter: 1,
      volume: 1,
      wordsPerChapter: 20,
      manuscriptBody: '字'.repeat(20),
    })
    expect(await runSubagentGate('chapter-writer', root)).toEqual([])
  })

  test('chapter-writer 主路径：无卷号 → 递归搜 manuscript/**/ch-NNN.md', async () => {
    const root = await makeProject({
      chapter: 2,
      wordsPerChapter: 20,
      manuscriptRelPath: join('manuscript', 'ch-002.md'),
      manuscriptBody: '字'.repeat(20),
    })
    expect(await runSubagentGate('chapter-writer', root)).toEqual([])
  })

  test('chapter-writer：正文文件缺失 → 未找到提示', async () => {
    const root = await makeProject({ chapter: 3, volume: 1 })
    const result = await runSubagentGate('chapter-writer', root)
    expect(result).toEqual([
      '第 3 章正文文件未找到（期望路径 manuscript/vol-VV/ch-003.md）。需要重新生成本章正文。',
    ])
  })

  test('chapter-writer：字数低于下限 → 提示携带相对路径', async () => {
    const root = await makeProject({
      chapter: 1,
      volume: 1,
      wordsPerChapter: 3000,
      manuscriptBody: '字'.repeat(100),
    })
    const result = await runSubagentGate('chapter-writer', root)
    expect(result.some((m) => m.includes('低于目标区间下限') && m.includes(join('manuscript', 'vol-01', 'ch-001.md')))).toBe(
      true,
    )
  })

  test('chapter-writer：context-pack 驱动对白偏少诊断', async () => {
    const root = await makeProject({
      chapter: 1,
      volume: 1,
      wordsPerChapter: 10,
      manuscriptBody:
        '沈砚进了藏经阁。陆昭站在窗边，手里压着经卷。两个人隔着一张案，谁都没有先开口。案上的玉佩被灯火照出一道旧痕，屋外巡夜的脚步声一下一下压过来。',
      contextPack: {
        chapter_outline: '两人对峙。沈砚和陆昭同处，关键冲突来自质问与试探。',
        character_cards: [{ name: '沈砚' }, { name: '陆昭' }],
      },
    })
    const result = await runSubagentGate('chapter-writer', root)
    expect(result.some((m) => m.includes('现场对白偏少'))).toBe(true)
  })

  test('chapter-writer：context-pack 文件缺失 → 静默降级，其余判据照常', async () => {
    const root = await makeProject({
      chapter: 1,
      volume: 1,
      wordsPerChapter: 10,
      manuscriptBody: '“别动。\n\n她没有动。'.repeat(3),
    })
    const result = await runSubagentGate('chapter-writer', root)
    expect(result.some((m) => m.includes('中文双引号不成对'))).toBe(true)
  })

  test('chapter-writer：config.yaml 缺失 → 缺省区间 1800-4000', async () => {
    const root = await makeProject({ chapter: 1, volume: 1, manuscriptBody: '字'.repeat(100) })
    const result = await runSubagentGate('chapter-writer', root)
    expect(result.some((m) => m.includes('低于目标区间下限 1800'))).toBe(true)
  })

  test('memory-keeper：回执缺失 → 提示', async () => {
    const root = await makeProject({ chapter: 5 })
    const result = await runSubagentGate('memory-keeper', root)
    expect(result).toEqual([
      '第 5 章入库回执未找到（.narracat/receipts/ch-005.json）。本章入库未完成，需要 memory-keeper 重新提交本章数据。',
    ])
  })

  test('memory-keeper：回执存在且非空 → []', async () => {
    const root = await makeProject({ chapter: 5, receiptText: '{"chapter":5}' })
    expect(await runSubagentGate('memory-keeper', root)).toEqual([])
  })

  test('state.yaml 里 in_progress_chapter 非正整数 → []', async () => {
    const root = await mkdtemp(join(tmpdir(), 'narracat-subagent-gate-'))
    await mkdir(join(root, '.narracat'), { recursive: true })
    await writeFile(join(root, '.narracat', 'state.yaml'), 'progress:\n  in_progress_chapter: -1\n', 'utf-8')
    expect(await runSubagentGate('chapter-writer', root)).toEqual([])
  })

  test('恒不 throw：state.yaml 内容损坏（非法 YAML）→ []', async () => {
    const root = await mkdtemp(join(tmpdir(), 'narracat-subagent-gate-'))
    await mkdir(join(root, '.narracat'), { recursive: true })
    await writeFile(join(root, '.narracat', 'state.yaml'), ':::not yaml:::[[[', 'utf-8')
    expect(await runSubagentGate('chapter-writer', root)).toEqual([])
    expect(await runSubagentGate('memory-keeper', root)).toEqual([])
  })
})
