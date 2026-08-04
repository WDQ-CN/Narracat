import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type {
  ManuscriptDraftInput,
  ManuscriptDraftState,
  ManuscriptDraftSummary,
  SaveManuscriptDraftInput,
} from '@shared/types/manuscript-draft'
import { atomicWriteFile } from '../atomic-write.ts'
import { chapterBaseName, NARRACAT_DIR } from './novel-layout.ts'
import {
  locateManuscriptFile,
  manuscriptTextHash,
  normalizeManuscriptText,
  splitChapterMetadataComment,
} from './manuscript-file.ts'
import { isNarraCatProject, loadNovelProjectSummary } from './novel-project.ts'

interface ManuscriptDraftFileV1 {
  schemaVersion: 1
  novelId: string
  chapter: number
  baseContentHash: string
  baseVisibleText: string
  draftText: string
  updatedAt: string
}

const DRAFTS_DIR = 'manuscript-drafts'
const draftQueues = new Map<string, Promise<void>>()

export function manuscriptDraftPath(projectPath: string, chapter: number): string {
  return join(projectPath, NARRACAT_DIR, DRAFTS_DIR, `${chapterBaseName(chapter)}.json`)
}

function asProjectPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value)) throw new Error('项目路径参数非法。')
  return value
}

function asChapter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error('章号参数非法。')
  return value
}

function asText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}参数非法。`)
  return value
}

export function parseManuscriptDraftInput(input: unknown): ManuscriptDraftInput {
  const raw = (input ?? {}) as Record<string, unknown>
  return {
    projectPath: asProjectPath(raw.projectPath),
    chapter: asChapter(raw.chapter),
  }
}

export function parseSaveManuscriptDraftInput(input: unknown): SaveManuscriptDraftInput {
  const raw = (input ?? {}) as Record<string, unknown>
  return {
    ...parseManuscriptDraftInput(raw),
    baseVisibleText: asText(raw.baseVisibleText, '原正文'),
    draftText: asText(raw.draftText, '草稿正文'),
  }
}

async function requireProjectIdentity(projectPath: string): Promise<string> {
  if (!(await isNarraCatProject(projectPath))) throw new Error('这不是有效的 NarraCat 小说项目。')
  const summary = await loadNovelProjectSummary(projectPath)
  if (summary.status === 'invalid') throw new Error(summary.problem ?? '小说项目不可用。')
  return summary.id
}

function isDraftFile(value: unknown): value is ManuscriptDraftFileV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Partial<ManuscriptDraftFileV1>
  const structurallyValid =
    raw.schemaVersion === 1 &&
    typeof raw.novelId === 'string' &&
    typeof raw.chapter === 'number' &&
    Number.isInteger(raw.chapter) &&
    raw.chapter > 0 &&
    typeof raw.baseContentHash === 'string' &&
    /^[a-f0-9]{64}$/.test(raw.baseContentHash) &&
    typeof raw.baseVisibleText === 'string' &&
    typeof raw.draftText === 'string' &&
    typeof raw.updatedAt === 'string'
  return structurallyValid && manuscriptTextHash(raw.baseVisibleText as string) === raw.baseContentHash
}

function enqueueDraftMutation(key: string, mutation: () => Promise<void>): Promise<void> {
  const previous = draftQueues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(mutation)
  draftQueues.set(key, current)
  return current.finally(() => {
    if (draftQueues.get(key) === current) draftQueues.delete(key)
  })
}

async function quarantineCorruptDraft(path: string): Promise<string> {
  const errorId = `draft-${randomUUID().slice(0, 8)}`
  const quarantinePath = path.replace(/\.json$/, `.corrupt-${Date.now()}-${errorId}.json`)
  await rename(path, quarantinePath).catch(() => undefined)
  return errorId
}

export async function saveManuscriptDraft(input: SaveManuscriptDraftInput): Promise<{ ok: true }> {
  const projectPath = asProjectPath(input.projectPath)
  const chapter = asChapter(input.chapter)
  const baseVisibleText = asText(input.baseVisibleText, '原正文')
  const draftText = asText(input.draftText, '草稿正文')
  const path = manuscriptDraftPath(projectPath, chapter)

  await enqueueDraftMutation(path, async () => {
    const novelId = await requireProjectIdentity(projectPath)
    if (normalizeManuscriptText(baseVisibleText) === normalizeManuscriptText(draftText)) {
      await rm(path, { force: true })
      return
    }

    const draft: ManuscriptDraftFileV1 = {
      schemaVersion: 1,
      novelId,
      chapter,
      baseContentHash: manuscriptTextHash(baseVisibleText),
      baseVisibleText,
      draftText,
      updatedAt: new Date().toISOString(),
    }
    await mkdir(dirname(path), { recursive: true })
    await atomicWriteFile(path, `${JSON.stringify(draft, null, 2)}\n`)
  })

  return { ok: true }
}

export async function discardManuscriptDraft(input: ManuscriptDraftInput): Promise<{ ok: true }> {
  const projectPath = asProjectPath(input.projectPath)
  const chapter = asChapter(input.chapter)
  const path = manuscriptDraftPath(projectPath, chapter)
  await enqueueDraftMutation(path, async () => {
    await requireProjectIdentity(projectPath)
    await rm(path, { force: true })
  })
  return { ok: true }
}

export async function readManuscriptDraft(input: ManuscriptDraftInput): Promise<ManuscriptDraftState> {
  const projectPath = asProjectPath(input.projectPath)
  const chapter = asChapter(input.chapter)
  const novelId = await requireProjectIdentity(projectPath)
  const path = manuscriptDraftPath(projectPath, chapter)

  await (draftQueues.get(path) ?? Promise.resolve()).catch(() => undefined)

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8'))
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined
    if (code === 'ENOENT') return { status: 'none' }
    return { status: 'corrupt', chapter, errorId: await quarantineCorruptDraft(path) }
  }

  if (!isDraftFile(parsed) || parsed.novelId !== novelId || parsed.chapter !== chapter) {
    return { status: 'corrupt', chapter, errorId: await quarantineCorruptDraft(path) }
  }

  const manuscriptPath = await locateManuscriptFile(projectPath, chapter)
  if (!manuscriptPath) return { status: 'conflict', chapter, draftText: parsed.draftText, diskText: '', updatedAt: parsed.updatedAt }

  let diskText: string
  try {
    diskText = splitChapterMetadataComment(await readFile(manuscriptPath, 'utf-8')).visibleText
  } catch {
    return { status: 'conflict', chapter, draftText: parsed.draftText, diskText: '', updatedAt: parsed.updatedAt }
  }

  if (normalizeManuscriptText(parsed.draftText) === normalizeManuscriptText(diskText)) {
    await discardManuscriptDraft({ projectPath, chapter })
    return { status: 'none' }
  }

  if (parsed.baseContentHash === manuscriptTextHash(diskText)) {
    return { status: 'recoverable', chapter, draftText: parsed.draftText, diskText, updatedAt: parsed.updatedAt }
  }

  return {
    status: 'conflict',
    chapter,
    draftText: parsed.draftText,
    diskText,
    updatedAt: parsed.updatedAt,
  }
}

export async function listManuscriptDrafts(projectPathValue: string): Promise<ManuscriptDraftSummary[]> {
  const projectPath = asProjectPath(projectPathValue)
  await requireProjectIdentity(projectPath)
  const dir = join(projectPath, NARRACAT_DIR, DRAFTS_DIR)

  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const summaries = await Promise.all(
    names.flatMap((name) => {
      const match = /^ch-(\d+)\.json$/.exec(name)
      if (!match) return []
      const chapter = Number(match[1])
      return [
        stat(join(dir, name))
          .then((info) => ({ chapter, updatedAt: info.mtime.toISOString() }))
          .catch((error) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
            throw error
          }),
      ]
    }),
  )

  return summaries
    .filter((summary): summary is ManuscriptDraftSummary => summary !== null)
    .sort((left, right) => left.chapter - right.chapter)
}
