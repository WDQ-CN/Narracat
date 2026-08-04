import { resolve } from 'node:path'

import { isNarraCatProject } from './novel-project.ts'

export interface DeleteNovelProjectInput {
  projectPath: string
  recentNovelPaths: string[]
  trashItem: (path: string) => Promise<void>
}

export interface DeleteNovelProjectResult {
  projectPath: string
  recentNovelPaths: string[]
  trashed: boolean
}

function removeRecentPath(recentNovelPaths: string[], projectPath: string): string[] {
  const target = resolve(projectPath)
  return recentNovelPaths.filter((path) => resolve(path) !== target)
}

export async function deleteNovelProject({
  projectPath,
  recentNovelPaths,
  trashItem,
}: DeleteNovelProjectInput): Promise<DeleteNovelProjectResult> {
  const normalizedProjectPath = projectPath.trim()
  if (!normalizedProjectPath) throw new Error('缺少项目路径。')

  const isProject = await isNarraCatProject(normalizedProjectPath)
  if (isProject) {
    await trashItem(normalizedProjectPath)
  }

  return {
    projectPath: normalizedProjectPath,
    recentNovelPaths: removeRecentPath(recentNovelPaths, normalizedProjectPath),
    trashed: isProject,
  }
}
