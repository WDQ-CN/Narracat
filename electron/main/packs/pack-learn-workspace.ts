/**
 * 学习工作区组装（刀4）。合规硬约束的实施点：learned-own 只经 loadNovelChapters 读
 * 成稿正文 manuscript/vol-NN/ch-NNN.md（目录契约=novel-layout.ts，含 legacy 平铺兼容），
 * bible/references 与 bible/reference-guidance 结构上不进入工作区（spec §7；测试锁定）。
 * 两种来源 normalize 成同一 LearnSourceChapters，走同一条管线。
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import { decodeBookBuffer, cleanBookLines, splitBookChapters, type BookChapter } from './book-normalize'
import { MANUSCRIPT_DIR } from '../novel/novel-layout'

export interface LearnSourceChapters {
  sourceKind: 'novel' | 'txt'
  title: string
  chapters: BookChapter[]
}

const SKIM_HEAD = 3
const SKIM_TOTAL = 10
const DEEP_TOTAL = 30

export function planSampling(totalChapters: number, tier: 'skim' | 'deep'): number[] {
  const target = tier === 'skim' ? SKIM_TOTAL : DEEP_TOTAL
  if (totalChapters <= target) return Array.from({ length: totalChapters }, (_, i) => i)
  const picks = new Set<number>()
  for (let i = 0; i < SKIM_HEAD; i++) picks.add(i)
  const rest = target - picks.size
  for (let k = 0; k < rest; k++) {
    // 在 [SKIM_HEAD, totalChapters-1] 均匀取点
    picks.add(SKIM_HEAD + Math.round((k * (totalChapters - 1 - SKIM_HEAD)) / Math.max(1, rest - 1)))
  }
  return [...picks].sort((a, b) => a - b).slice(0, target)
}

const CHAPTER_FILE_RE = /^ch-\d+\.md$/
const VOLUME_DIR_RE = /^vol-\d+$/

/**
 * 按 novel-layout 契约（`electron/main/novel/novel-layout.ts`）扫描成稿目录，
 * 返回相对 manuscript/ 的路径列表：`vol-NN/ch-XXX.md` 子目录布局 + legacy 平铺
 * `ch-XXX.md` 两种都读，按数值序排列（跨卷正确，见 reference-works.ts 的
 * localeCompare numeric 先例）。白名单结构性：只在 manuscript/ 下拼路径，
 * 文件名全部来自 readdir 且经正则过滤，不触碰 bible/。
 */
async function collectManuscriptChapterFiles(manuscriptDir: string): Promise<string[]> {
  let topEntries: Dirent[] = []
  try {
    topEntries = await readdir(manuscriptDir, { withFileTypes: true })
  } catch {
    return []
  }
  const relativeFiles: string[] = []
  for (const entry of topEntries) {
    if (entry.isDirectory() && VOLUME_DIR_RE.test(entry.name)) {
      let chapterFiles: string[] = []
      try {
        chapterFiles = (await readdir(join(manuscriptDir, entry.name))).filter((f) => CHAPTER_FILE_RE.test(f))
      } catch {
        chapterFiles = []
      }
      for (const file of chapterFiles) relativeFiles.push(join(entry.name, file))
    } else if (entry.isFile() && CHAPTER_FILE_RE.test(entry.name)) {
      relativeFiles.push(entry.name)
    }
  }
  return relativeFiles.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
}

export async function loadNovelChapters(projectPath: string, title: string): Promise<LearnSourceChapters> {
  const manuscriptDir = join(projectPath, MANUSCRIPT_DIR)
  const files = await collectManuscriptChapterFiles(manuscriptDir)
  if (files.length === 0) throw new Error('这本书还没有正文，无法学习。')
  const chapters: BookChapter[] = []
  for (const file of files) {
    const raw = await readFile(join(manuscriptDir, file), 'utf8')
    const newline = raw.indexOf('\n')
    const first = (newline === -1 ? raw : raw.slice(0, newline)).replace(/^#+\s*/, '').trim()
    chapters.push({
      title: first || basename(file, '.md'),
      body: (newline === -1 ? '' : raw.slice(newline + 1)).trim(),
    })
  }
  return { sourceKind: 'novel', title, chapters }
}

// T11 评审 F2：外部 txt 是用户自己选的文件，没有 Task 5 那层白名单装载兜底——选错文件（整套合集、
// 网页存档、日志导出……）会把巨量文本塞进内存/发进学习会话。30MB 已远超单本网文正常体量
// （千万字级单本网文 utf8 编码约 30MB，百万字长篇通常几 MB），超出即视为选错，直接拒绝而不是
// 让后面的 decode/split/学习会话去扛（PR#477 外审 P2-6：原 100MB 上限配合全书精确 Set 索引可致
// 主进程 OOM，现窗口层已改 Bloom filter 覆盖全书，此处上限单纯收紧到"正常单本书"量级）。
export const MAX_EXTERNAL_BOOK_BYTES = 30 * 1024 * 1024

export async function loadExternalBook(filePath: string): Promise<LearnSourceChapters> {
  const fileStat = await stat(filePath)
  if (fileStat.size > MAX_EXTERNAL_BOOK_BYTES) {
    throw new Error('这个文件太大，请确认选的是单本小说的 txt 文件。')
  }
  const buf = await readFile(filePath)
  const { text } = decodeBookBuffer(new Uint8Array(buf))
  const chapters = splitBookChapters(cleanBookLines(text))
  if (chapters.length === 0) throw new Error('这个文件里读不出正文内容。')
  return { sourceKind: 'txt', title: basename(filePath).replace(/\.txt$/i, ''), chapters }
}

export function estimateLearnRun(
  source: LearnSourceChapters,
  tier: 'skim' | 'deep',
): { chapterCount: number; sampledCount: number; approxChars: number } {
  const picks = planSampling(source.chapters.length, tier)
  const approxChars = picks.reduce((sum, i) => sum + source.chapters[i].body.length, 0)
  return { chapterCount: source.chapters.length, sampledCount: picks.length, approxChars }
}

export async function assembleLearnWorkspace(input: {
  workspaceDir: string
  source: LearnSourceChapters
  tier: 'skim' | 'deep'
}): Promise<{ sampledIndices: number[]; fullText: string; sampledText: string }> {
  const sampledIndices = planSampling(input.source.chapters.length, input.tier)
  await mkdir(join(input.workspaceDir, 'source'), { recursive: true })
  await mkdir(join(input.workspaceDir, 'output'), { recursive: true })
  for (const i of sampledIndices) {
    const ch = input.source.chapters[i]
    const name = `ch-${String(i + 1).padStart(4, '0')}.md`
    await writeFile(join(input.workspaceDir, 'source', name), `# ${ch.title}\n\n${ch.body}\n`, 'utf8')
  }
  if (input.tier === 'deep') {
    const toc = input.source.chapters.map((ch, index) => ({ index: index + 1, title: ch.title, chars: ch.body.length }))
    await writeFile(join(input.workspaceDir, 'source', 'toc.json'), JSON.stringify(toc, null, 2), 'utf8')
  }
  const fullText = input.source.chapters.map((c) => c.body).join('\n')
  // 模型只见过抽样章——精确窗口 Set（buildWindowIndex）只该对这部分文本建，不该对全书建
  // （PR#477 外审 P2-6：全书精确 Set 是百万字级、几十 MB 常驻内存的 OOM 风险源；全书层的
  // 防抄袭覆盖交给 fingerprint.windowBloom，见 pack-learn.ts / text-reuse-scan.ts）。
  const sampledText = sampledIndices.map((i) => input.source.chapters[i].body).join('\n')
  return { sampledIndices, fullText, sampledText }
}
