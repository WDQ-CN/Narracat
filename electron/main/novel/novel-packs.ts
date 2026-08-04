// 小说级能力包启用清单（B2 刀1，ADR-0034 v1.1）：`.narracat/packs.json` 读写 + 章级能力回执只读。
//
// 双轨版本制：官方内置包条目不带 version（随引擎走）；用户导入包条目带 version（锁版本）。
// 缺失/损坏一律 fail-soft 回退默认清单（对齐 alias-map 等既有 fail-soft 惯例），绝不 throw——
// 启用面板/写作链路读取本文件失败不应阻断项目打开或写作。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { NovelPacksEntry } from '@shared/types/capability-pack' // Task 6 已定义，主进程/渲染端共用
import { NARRACAT_DIR, chapterBaseName } from './novel-layout'

export interface NovelPacksFile {
  format_version: 1
  enabled: NovelPacksEntry[]
}

const DEFAULT_NOVEL_PACKS: NovelPacksFile = { format_version: 1, enabled: [{ id: 'official-base' }] }

export function novelPacksPath(projectPath: string): string {
  return join(projectPath, NARRACAT_DIR, 'packs.json')
}

/** 条目守卫：id 非空字符串；version 存在则须为字符串（导入包锁版本，官方条目不带）。 */
export function isValidNovelPacksEntry(value: unknown): value is NovelPacksEntry {
  if (!value || typeof value !== 'object') return false
  const { id, version } = value as Record<string, unknown>
  if (typeof id !== 'string' || !id.trim()) return false
  if (version !== undefined && typeof version !== 'string') return false
  return true
}

function isValidNovelPacksFile(value: unknown): value is NovelPacksFile {
  if (!value || typeof value !== 'object') return false
  const { format_version: formatVersion, enabled } = value as Record<string, unknown>
  if (formatVersion !== 1) return false
  return Array.isArray(enabled) && enabled.every(isValidNovelPacksEntry)
}

/** 缺失/损坏（不存在、JSON 解析失败、结构不合法）一律回退默认清单，不 throw。 */
export async function readNovelPacks(projectPath: string): Promise<NovelPacksFile> {
  try {
    const raw = JSON.parse(await readFile(novelPacksPath(projectPath), 'utf8'))
    return isValidNovelPacksFile(raw) ? raw : DEFAULT_NOVEL_PACKS
  } catch {
    return DEFAULT_NOVEL_PACKS
  }
}

/** 同 id 重复条目去重（手改/合并可能产生），首次出现者保留——写盘前归一化，防引擎池翻倍。 */
function dedupeById(entries: NovelPacksEntry[]): NovelPacksEntry[] {
  const seen = new Set<string>()
  const deduped: NovelPacksEntry[] = []
  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    deduped.push(entry)
  }
  return deduped
}

export async function writeNovelPacks(projectPath: string, enabled: NovelPacksEntry[]): Promise<NovelPacksFile> {
  const file: NovelPacksFile = { format_version: 1, enabled: dedupeById(enabled) }
  await mkdir(join(projectPath, NARRACAT_DIR), { recursive: true })
  await writeFile(novelPacksPath(projectPath), JSON.stringify(file, null, 2), 'utf8')
  return file
}

/** `novel-packs:set` 事件埋点条目（IPC 层逐条 appendPackEvent，本类型不依赖 pack-provenance.ts）。 */
export interface NovelPacksEnableEvent {
  action: 'enable' | 'disable' | 'upgrade'
  packId: string
  version?: string
}

/**
 * 纯函数：比对启用清单新旧两版，按 id 归类出 enable/disable/upgrade 三态事件（B2 刀3 Task 10）。
 * 同 id 两版都在 → version 有变化记 upgrade（官方条目 version 恒缺省，undefined→undefined 不算变化）；
 * 只在新清单 → enable；只在旧清单 → disable。不做 I/O，调用方（ipc.ts）负责落 appendPackEvent 且吞错误。
 */
export function diffNovelPacksEnabledEvents(previous: NovelPacksEntry[], next: NovelPacksEntry[]): NovelPacksEnableEvent[] {
  const prevById = new Map(previous.map((entry) => [entry.id, entry]))
  const nextById = new Map(next.map((entry) => [entry.id, entry]))
  const events: NovelPacksEnableEvent[] = []

  for (const [id, entry] of nextById) {
    const prevEntry = prevById.get(id)
    if (!prevEntry) {
      events.push({ action: 'enable', packId: id, ...(entry.version ? { version: entry.version } : {}) })
    } else if (prevEntry.version !== entry.version) {
      events.push({ action: 'upgrade', packId: id, ...(entry.version ? { version: entry.version } : {}) })
    }
  }
  for (const [id, entry] of prevById) {
    if (!nextById.has(id)) {
      events.push({ action: 'disable', packId: id, ...(entry.version ? { version: entry.version } : {}) })
    }
  }
  return events
}

// --- 章级能力回执（Task 9b 消费，本片只做只读通道） --------------------------------------

export interface ChapterCapabilityReceipt {
  chapter: number
  entries: unknown[]
  warnings: string[]
}

export function chapterCapabilityReceiptPath(projectPath: string, chapter: number): string {
  return join(projectPath, NARRACAT_DIR, 'capability-receipts', `${chapterBaseName(chapter)}.json`)
}

function isValidChapterCapabilityReceipt(value: unknown): value is ChapterCapabilityReceipt {
  if (!value || typeof value !== 'object') return false
  const { chapter, entries, warnings } = value as Record<string, unknown>
  return typeof chapter === 'number' && Array.isArray(entries) && Array.isArray(warnings)
}

/** 缺失/损坏一律返回 null，不 throw——回执是展示层可选信息，不阻断章节浏览。 */
export async function readChapterCapabilityReceipt(
  projectPath: string,
  chapter: number,
): Promise<ChapterCapabilityReceipt | null> {
  try {
    const raw = JSON.parse(await readFile(chapterCapabilityReceiptPath(projectPath, chapter), 'utf8'))
    return isValidChapterCapabilityReceipt(raw) ? raw : null
  } catch {
    return null
  }
}
