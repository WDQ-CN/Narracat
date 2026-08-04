import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '../atomic-write.ts'
import { NARRACAT_DIR } from './novel-layout.ts'

/**
 * 「记忆待同步」标记（ADR-0031）：用户改正文触碰事实但尚未跑 sync-chapter-memory 时，
 * 章号 → 标记落 `.narracat/pending-memory-sync.json`。App 层自有文件（主进程独占读写），
 * 不碰引擎独占写的 memory.db。
 */

export interface PendingMemorySyncEntry {
  savedAt: string
  reasons: string[]
}

export type PendingMemorySyncMap = Record<string, PendingMemorySyncEntry>
const pendingMemorySyncQueues = new Map<string, Promise<void>>()

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

export function pendingMemorySyncPath(projectPath: string): string {
  return join(projectPath, NARRACAT_DIR, 'pending-memory-sync.json')
}

async function readPendingMemorySyncFile(projectPath: string): Promise<PendingMemorySyncMap> {
  let source: string
  try {
    source = await readFile(pendingMemorySyncPath(projectPath), 'utf-8')
  } catch (error) {
    if (isMissingFileError(error)) return {}
    throw error
  }
  const parsed: unknown = JSON.parse(source)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('记忆待同步状态文件格式损坏。')
  }

  const map: PendingMemorySyncMap = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`记忆待同步状态中的第 ${key} 章记录损坏。`)
    }
    const entry = value as { savedAt?: unknown; reasons?: unknown }
    if (
      typeof entry.savedAt !== 'string' ||
      !Array.isArray(entry.reasons) ||
      !entry.reasons.every((reason) => typeof reason === 'string')
    ) {
      throw new Error(`记忆待同步状态中的第 ${key} 章记录损坏。`)
    }
    map[key] = {
      savedAt: entry.savedAt,
      reasons: entry.reasons,
    }
  }
  return map
}

export async function readPendingMemorySync(projectPath: string): Promise<PendingMemorySyncMap> {
  const path = pendingMemorySyncPath(projectPath)
  await (pendingMemorySyncQueues.get(path) ?? Promise.resolve()).catch(() => undefined)
  return readPendingMemorySyncFile(projectPath)
}

async function writePendingMemorySync(projectPath: string, map: PendingMemorySyncMap): Promise<void> {
  const path = pendingMemorySyncPath(projectPath)
  await mkdir(dirname(path), { recursive: true })
  await atomicWriteFile(path, `${JSON.stringify(map, null, 2)}\n`)
}

function mutatePendingMemorySync(
  projectPath: string,
  mutation: (map: PendingMemorySyncMap) => boolean,
): Promise<void> {
  const path = pendingMemorySyncPath(projectPath)
  const previous = pendingMemorySyncQueues.get(path) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(async () => {
    const map = await readPendingMemorySyncFile(projectPath)
    if (mutation(map)) await writePendingMemorySync(projectPath, map)
  })
  pendingMemorySyncQueues.set(path, current)
  return current.finally(() => {
    if (pendingMemorySyncQueues.get(path) === current) pendingMemorySyncQueues.delete(path)
  })
}

export async function markPendingMemorySync(projectPath: string, chapter: number, reasons: string[]): Promise<void> {
  await mutatePendingMemorySync(projectPath, (map) => {
    map[String(chapter)] = { savedAt: new Date().toISOString(), reasons }
    return true
  })
}

export async function clearPendingMemorySync(projectPath: string, chapter: number): Promise<void> {
  await mutatePendingMemorySync(projectPath, (map) => {
    if (!(String(chapter) in map)) return false
    delete map[String(chapter)]
    return true
  })
}

export function parseClearPendingMemorySyncInput(input: unknown): { projectPath: string; chapter: number } {
  const raw = (input ?? {}) as Record<string, unknown>
  if (typeof raw.projectPath !== 'string' || !raw.projectPath.trim()) throw new Error('项目路径参数非法。')
  if (typeof raw.chapter !== 'number' || !Number.isInteger(raw.chapter) || raw.chapter < 1) {
    throw new Error('章号参数非法。')
  }
  return { projectPath: raw.projectPath, chapter: raw.chapter }
}
