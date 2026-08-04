import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from './atomic-write.ts'
import {
  parseStoredWorkLocation,
  type StoredWorkLocation,
} from '@shared/lib/work-location-schema'

const navigationStateMutationQueues = new Map<string, Promise<void>>()

export function navigationStatePath(userDataPath: string): string {
  return join(userDataPath, 'navigation-state.json')
}

export async function readStoredWorkLocation(storePath: string): Promise<StoredWorkLocation> {
  await (navigationStateMutationQueues.get(storePath) ?? Promise.resolve()).catch(() => undefined)

  try {
    return parseStoredWorkLocation(await readFile(storePath, 'utf-8'))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || error instanceof SyntaxError) return { version: 1, landing: 'library' }
    throw error
  }
}

export function writeStoredWorkLocation(
  storePath: string,
  location: StoredWorkLocation,
): Promise<void> {
  const normalized = parseStoredWorkLocation(JSON.stringify(location))
  const previous = navigationStateMutationQueues.get(storePath) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(async () => {
    await mkdir(dirname(storePath), { recursive: true })
    await atomicWriteFile(storePath, `${JSON.stringify(normalized, null, 2)}\n`)
  })

  navigationStateMutationQueues.set(storePath, current)
  return current.finally(() => {
    if (navigationStateMutationQueues.get(storePath) === current) {
      navigationStateMutationQueues.delete(storePath)
    }
  })
}
