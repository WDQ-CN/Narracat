export type StoredWorkLocation =
  | {
      version: 1
      landing: 'library'
    }
  | {
      version: 1
      landing: 'workbench'
      novelId: string
      projectPath: string
      sectionId: 'status' | 'reference-works' | 'blueprint' | 'settings' | 'packs' | 'chat' | 'memory-graph'
      tabId?: string
      objectId?: string
      chapter?: number
      chapterView?: 'text' | 'outline' | 'context' | 'review'
    }

function isSectionId(value: unknown): value is Extract<StoredWorkLocation, { landing: 'workbench' }>['sectionId'] {
  return (
    value === 'status' ||
    value === 'reference-works' ||
    value === 'blueprint' ||
    value === 'settings' ||
    value === 'packs' ||
    value === 'chat' ||
    value === 'memory-graph'
  )
}

function isChapterView(
  value: unknown,
): value is NonNullable<Extract<StoredWorkLocation, { landing: 'workbench' }>['chapterView']> {
  return value === 'text' || value === 'outline' || value === 'context' || value === 'review'
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

export function parseStoredWorkLocation(raw: string | null): StoredWorkLocation {
  if (!raw) return { version: 1, landing: 'library' }

  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (value.version !== 1) return { version: 1, landing: 'library' }
    if (value.landing === 'library') return { version: 1, landing: 'library' }

    const novelId = nonEmptyString(value.novelId)
    const projectPath = nonEmptyString(value.projectPath)
    if (value.landing !== 'workbench' || !novelId || !projectPath || !isSectionId(value.sectionId)) {
      return { version: 1, landing: 'library' }
    }

    const chapterView = isChapterView(value.chapterView) ? value.chapterView : undefined
    const tabId = nonEmptyString(value.tabId)
    const objectId = nonEmptyString(value.objectId)
    const chapter = positiveInteger(value.chapter)

    return {
      version: 1,
      landing: 'workbench',
      novelId,
      projectPath,
      sectionId: value.sectionId,
      ...(tabId ? { tabId } : {}),
      ...(objectId ? { objectId } : {}),
      ...(chapter ? { chapter } : {}),
      ...(chapterView ? { chapterView } : {}),
    }
  } catch {
    return { version: 1, landing: 'library' }
  }
}
