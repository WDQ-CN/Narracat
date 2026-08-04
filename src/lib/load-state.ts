export type LoadSurface = 'startup' | 'library' | 'workbench' | 'notifications' | 'diagnostics'
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'stale' | 'error'

export interface LoadIssue {
  id: string
  summary: string
}

export interface LoadState {
  status: LoadStatus
  hasData: boolean
  issue: LoadIssue | null
}

const SURFACE_CODES: Record<LoadSurface, string> = {
  startup: 'START',
  library: 'LIB',
  workbench: 'WORK',
  notifications: 'NOTE',
  diagnostics: 'DIAG',
}

const SURFACE_SUMMARIES: Record<LoadSurface, string> = {
  startup: '没能恢复上次的工作位置。',
  library: '没能读取小说列表。',
  workbench: '没能读取当前项目内容。',
  notifications: '没能读取通知。',
  diagnostics: '应用诊断未通过。',
}

export const EMPTY_LOAD_STATE: LoadState = {
  status: 'idle',
  hasData: false,
  issue: null,
}

function errorFingerprint(error: unknown): string {
  if (error instanceof Error) return `${error.name}:${error.message}`
  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

export function createLoadIssue(surface: LoadSurface, error: unknown): LoadIssue {
  const fingerprint = errorFingerprint(error)
  const id = `NC-${SURFACE_CODES[surface]}-${fnv1a(`${surface}:${fingerprint}`)}`

  console.error(`[${id}] ${SURFACE_SUMMARIES[surface]}`, error)

  return {
    id,
    summary: SURFACE_SUMMARIES[surface],
  }
}

export function beginLoad(current: LoadState): LoadState {
  return {
    status: 'loading',
    hasData: current.hasData,
    issue: null,
  }
}

export function completeLoad(): LoadState {
  return {
    status: 'ready',
    hasData: true,
    issue: null,
  }
}

export function failLoad(current: LoadState, issue: LoadIssue): LoadState {
  return {
    status: current.hasData ? 'stale' : 'error',
    hasData: current.hasData,
    issue,
  }
}

export async function runWithFiniteRetry<T>(
  operation: (attempt: number) => Promise<T>,
  maxAttempts = 2,
): Promise<T> {
  const attempts = Math.max(1, Math.floor(maxAttempts))
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}
