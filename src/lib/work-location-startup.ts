import { runWithFiniteRetry } from './load-state'
import {
  buildStoredWorkbenchHref,
  resolveStoredWorkProject,
} from './work-location'
import type { NovelProjectSummary, RememberNovelProjectPathInput } from '@shared/types/novel'
import type { StoredWorkLocation } from '@shared/types/work-location'

export type StartupWorkLocationResolution =
  | { kind: 'stay' }
  | { kind: 'navigate'; href: string }
  | { kind: 'fallback-library'; message: string }

export async function resolveStartupWorkLocation({
  listProjects,
  pathname,
  readLocation,
  rememberProjectPath,
  writeLocation,
}: {
  listProjects: () => Promise<NovelProjectSummary[]>
  pathname: string
  readLocation: () => Promise<StoredWorkLocation>
  rememberProjectPath: (input: RememberNovelProjectPathInput) => Promise<unknown>
  writeLocation: (location: StoredWorkLocation) => Promise<unknown>
}): Promise<StartupWorkLocationResolution> {
  const stored = await readLocation()
  if (pathname !== '/' || stored.landing === 'library') return { kind: 'stay' }

  const projects = await runWithFiniteRetry(() => listProjects())
  const project = resolveStoredWorkProject(projects, stored)
  if (!project) {
    await writeLocation({ version: 1, landing: 'library' })
    return {
      kind: 'fallback-library',
      message: '上次打开的项目已缺失或损坏，已返回图书馆。',
    }
  }

  if (project.path !== stored.projectPath) {
    await runWithFiniteRetry(() =>
      rememberProjectPath({
        novelId: stored.novelId,
        previousPath: stored.projectPath,
        currentPath: project.path,
      }),
    )
    await writeLocation({ ...stored, projectPath: project.path })
  }

  return {
    kind: 'navigate',
    href: buildStoredWorkbenchHref(stored, project.path),
  }
}
