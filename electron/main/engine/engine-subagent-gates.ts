/**
 * pi 子 agent 出稿/回执质量门（阶段2切片⑤ Task 6）：IO 壳。判据本体在 engine-hooks.ts 的
 * judgeChapterWriterOutput / judgeMemoryKeeperReceipt（零 IO 纯函数）；本文件只负责按 shell
 * 版同款路径规则找文件、读文本，把结果喂给判据函数，接进 pi Task 工具的 `gate` 缝
 * （pi-subagent.ts CreateTaskToolArgs.gate）。
 *
 * 行为基线 = agent-core/narracat/hooks/scripts/check-chapter-writer-output.sh 与
 * check-memory-keeper-receipt.sh：任何 IO 失败（state.yaml/config.yaml 缺失或损坏、正文/回执/
 * context-pack 文件缺失）静默降级成对应参数 undefined 或直接 `[]`，恒不 throw——对齐两个 .sh
 * 恒 `exit 0` 的语义，质量门本身不能成为 run 中断点（fail-open）。
 *
 * 红线：本文件住 electron/main/engine/ 下，不许 import pi 包（check:architecture 分层纪律）。
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { judgeChapterWriterOutput, judgeMemoryKeeperReceipt } from './engine-hooks.ts'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return undefined
  }
}

async function readState(cwd: string): Promise<UnknownRecord | undefined> {
  const raw = await readOptionalText(join(cwd, '.narracat', 'state.yaml'))
  if (raw === undefined) return undefined
  try {
    const data: unknown = parseYaml(raw)
    return isRecord(data) ? data : undefined
  } catch {
    return undefined
  }
}

/** 对齐 python `(data.get("progress") or {}).get("in_progress_chapter")`，非正整数视为无进行中章节。 */
function readInProgressChapter(state: UnknownRecord): number | undefined {
  const progress = state.progress
  const chapter = isRecord(progress) ? progress.in_progress_chapter : undefined
  return isPositiveInteger(chapter) ? chapter : undefined
}

/** 对齐 python `mapping.get(ch, mapping.get(str(ch)))`——数字键与字符串键都试。 */
function readChapterVolume(state: UnknownRecord, chapter: number): number | undefined {
  const structure = state.structure
  const mapping = isRecord(structure) ? structure.chapter_to_volume : undefined
  if (!isRecord(mapping)) return undefined
  const vol = mapping[chapter] ?? mapping[String(chapter)]
  return isPositiveInteger(vol) ? vol : undefined
}

async function readWordsPerChapter(cwd: string): Promise<number | undefined> {
  const raw = await readOptionalText(join(cwd, '.narracat', 'config.yaml'))
  if (raw === undefined) return undefined
  try {
    const data: unknown = parseYaml(raw)
    const value = isRecord(data) ? data.words_per_chapter : undefined
    return isPositiveInteger(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** 深度优先遍历，取第一个匹配文件——贴近 shell `find manuscript -name ch-NNN.md -print -quit`。 */
async function findFileRecursive(dir: string, filename: string): Promise<string | undefined> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === filename) return join(dir, entry.name)
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await findFileRecursive(join(dir, entry.name), filename)
      if (found) return found
    }
  }
  return undefined
}

async function findManuscriptPath(cwd: string, state: UnknownRecord, chapter: number): Promise<string | undefined> {
  const nnn = String(chapter).padStart(3, '0')
  const vol = readChapterVolume(state, chapter)
  if (vol !== undefined) {
    const volStr = String(vol).padStart(2, '0')
    const candidate = join(cwd, 'manuscript', `vol-${volStr}`, `ch-${nnn}.md`)
    const text = await readOptionalText(candidate)
    return text !== undefined ? candidate : undefined
  }
  return findFileRecursive(join(cwd, 'manuscript'), `ch-${nnn}.md`)
}

async function runChapterWriterGate(cwd: string, state: UnknownRecord, chapter: number): Promise<string[]> {
  const manuscriptAbsPath = await findManuscriptPath(cwd, state, chapter)
  const manuscriptPath = manuscriptAbsPath ? relative(cwd, manuscriptAbsPath) : undefined
  const manuscriptText = manuscriptAbsPath ? await readOptionalText(manuscriptAbsPath) : undefined
  const wordsPerChapter = await readWordsPerChapter(cwd)
  const nnn = String(chapter).padStart(3, '0')
  const contextPackJson = await readOptionalText(join(cwd, '.narracat', 'context-packs', `ch-${nnn}.json`))
  return judgeChapterWriterOutput({ chapter, manuscriptPath, manuscriptText, wordsPerChapter, contextPackJson })
}

async function runMemoryKeeperGate(cwd: string, chapter: number): Promise<string[]> {
  const nnn = String(chapter).padStart(3, '0')
  const receiptText = await readOptionalText(join(cwd, '.narracat', 'receipts', `ch-${nnn}.json`))
  return judgeMemoryKeeperReceipt({ chapter, receiptText })
}

/**
 * pi Task 工具的 gate 缝实现：agentId 非 chapter-writer/memory-keeper 时零 IO 直接返回 `[]`；
 * 其余任何一步 IO/解析失败都静默降级到 `[]`（外层 try/catch 兜底，调用方 pi-subagent.ts 本身
 * 也已把 gate 异常吞成 fail-open 警告——本函数自己也不抛，双保险）。
 */
export async function runSubagentGate(agentId: string, cwd: string): Promise<string[]> {
  if (agentId !== 'chapter-writer' && agentId !== 'memory-keeper') return []
  try {
    const state = await readState(cwd)
    if (!state) return []
    const chapter = readInProgressChapter(state)
    if (chapter === undefined) return []
    return agentId === 'chapter-writer'
      ? await runChapterWriterGate(cwd, state, chapter)
      : await runMemoryKeeperGate(cwd, chapter)
  } catch {
    return []
  }
}
