import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'

import {
  referenceGuidanceDir as referenceGuidanceRelativeDir,
  referenceGuidanceIndexPath,
  referencesDir as referencesRelativeDir,
} from './novel-layout'
import type {
  PasteReferenceSourceInput,
  ReferenceGuidanceSummary,
  ReferenceSourceItem,
  ReferenceWorksSummary,
  RemoveReferenceSourceInput,
} from '@shared/types/novel'

export interface ImportReferenceSourceFilesInput {
  projectPath: string
  sourcePaths: string[]
}

const allowedExtensions = new Set(['.md', '.txt'])

function referencesDir(projectPath: string): string {
  return resolveProjectPath(projectPath, referencesRelativeDir())
}

function referenceGuidanceDir(projectPath: string): string {
  return resolveProjectPath(projectPath, referenceGuidanceRelativeDir())
}

function resolveProjectPath(projectPath: string, relativePath: string): string {
  const projectRoot = resolve(projectPath)
  const absolutePath = resolve(projectRoot, relativePath)
  const relation = relative(projectRoot, absolutePath)
  if (relation === '' || relation.startsWith('..') || relation === '..' || relation.split(sep).includes('..')) {
    throw new Error('参考作品路径越界。')
  }
  return absolutePath
}

function validateProjectPath(projectPath: string): string {
  if (!projectPath.trim()) throw new Error('缺少项目路径。')
  return projectPath
}

function normalizeExtension(value: string): '.md' | '.txt' {
  const extension = extname(value).toLowerCase()
  if (!allowedExtensions.has(extension)) throw new Error('仅支持导入 .md 或 .txt 文件。')
  return extension as '.md' | '.txt'
}

function stripExtension(fileName: string): string {
  const extension = extname(fileName)
  return extension ? fileName.slice(0, -extension.length) : fileName
}

function compareReferenceFileNames(left: string, right: string): number {
  const leftStem = stripExtension(left)
  const rightStem = stripExtension(right)
  const leftMatch = /^(.*)-(\d+)$/.exec(leftStem)
  const rightMatch = /^(.*)-(\d+)$/.exec(rightStem)
  const leftBase = leftMatch?.[1] ?? leftStem
  const rightBase = rightMatch?.[1] ?? rightStem
  const baseOrder = leftBase.localeCompare(rightBase, 'zh-CN', { numeric: true })

  if (baseOrder !== 0) return baseOrder

  const leftSuffix = leftMatch ? Number(leftMatch[2]) : 1
  const rightSuffix = rightMatch ? Number(rightMatch[2]) : 1
  return leftSuffix - rightSuffix || left.localeCompare(right, 'zh-CN', { numeric: true })
}

function latestIso(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort((left, right) => right.localeCompare(left))[0]
}

function sanitizeFileStem(value: string): string {
  const safe = value
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, '-')
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')

  return safe || '参考作品'
}

function validateReferenceFileName(fileName: string): '.md' | '.txt' {
  if (
    !fileName ||
    fileName !== basename(fileName) ||
    fileName === '.' ||
    fileName === '..' ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    /^[.]/.test(fileName)
  ) {
    throw new Error('参考作品文件名非法。')
  }

  const extension = extname(fileName).toLowerCase()
  if (!allowedExtensions.has(extension)) throw new Error('参考作品文件名非法。')
  return extension as '.md' | '.txt'
}

function countWords(content: string): number {
  const latinWords = content.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0
  const cjkChars = content.match(/[\u3400-\u9fff]/g)?.length ?? 0
  return latinWords + cjkChars
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function uniqueFileName(directory: string, stem: string, extension: '.md' | '.txt'): Promise<string> {
  let suffix = 1

  while (true) {
    const fileName = suffix === 1 ? `${stem}${extension}` : `${stem}-${suffix}${extension}`
    if (!(await pathExists(join(directory, fileName)))) return fileName
    suffix += 1
  }
}

async function readReferenceSource(projectPath: string, fileName: string): Promise<ReferenceSourceItem> {
  const extension = validateReferenceFileName(fileName)
  const relativePath = join(referencesRelativeDir(), fileName)
  const absolutePath = resolveProjectPath(projectPath, relativePath)
  const [info, content] = await Promise.all([stat(absolutePath), readFile(absolutePath, 'utf-8')])

  return {
    id: `reference-${fileName}`,
    fileName,
    title: stripExtension(fileName),
    relativePath,
    path: absolutePath,
    extension,
    size: info.size,
    wordCount: countWords(content),
    updatedAt: info.mtime.toISOString(),
  }
}

async function listReferenceSources(projectPath: string): Promise<ReferenceSourceItem[]> {
  validateProjectPath(projectPath)
  const directory = referencesDir(projectPath)

  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile() && allowedExtensions.has(extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      .sort(compareReferenceFileNames)

    return Promise.all(files.map((fileName) => readReferenceSource(projectPath, fileName)))
  } catch {
    return []
  }
}

async function optionalFileMtime(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.mtime.toISOString() : undefined
  } catch {
    return undefined
  }
}

async function optionalDirectoryMtime(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path)
    return info.isDirectory() ? info.mtime.toISOString() : undefined
  } catch {
    return undefined
  }
}

async function readReferenceGuidanceSummary(projectPath: string): Promise<ReferenceGuidanceSummary | undefined> {
  const indexRelativePath = referenceGuidanceIndexPath()
  const indexPath = resolveProjectPath(projectPath, indexRelativePath)
  const indexUpdatedAt = await optionalFileMtime(indexPath)

  if (indexUpdatedAt) {
    return {
      exists: true,
      relativePath: indexRelativePath,
      path: indexPath,
      updatedAt: indexUpdatedAt,
      content: await readFile(indexPath, 'utf-8'),
    }
  }

  const directory = referenceGuidanceDir(projectPath)

  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.md')
        .map(async (entry) => {
          const filePath = join(directory, entry.name)
          const info = await stat(filePath)
          return { name: entry.name, updatedAt: info.mtime.toISOString() }
        }),
    )
    const sortedFiles = files.sort((left, right) => compareReferenceFileNames(left.name, right.name))

    if (sortedFiles.length === 0) return undefined

    return {
      exists: true,
      relativePath: referenceGuidanceRelativeDir(),
      path: directory,
      updatedAt: latestIso(sortedFiles.map((file) => file.updatedAt)),
      content: ['# 参考指导', '', ...sortedFiles.map((file) => `- ${file.name}`), ''].join('\n'),
    }
  } catch {
    return undefined
  }
}

async function clearReferenceFiles(projectPath: string): Promise<void> {
  const directory = referencesDir(projectPath)

  try {
    const entries = await readdir(directory, { withFileTypes: true })
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && allowedExtensions.has(extname(entry.name).toLowerCase()))
        .map((entry) => unlink(join(directory, entry.name))),
    )
  } catch (caught) {
    if (!isMissingFileError(caught)) throw caught
  }
}

function isMissingFileError(caught: unknown): boolean {
  return (
    typeof caught === 'object' &&
    caught !== null &&
    'code' in caught &&
    (caught as { code?: unknown }).code === 'ENOENT'
  )
}

export async function clearReferenceGuidance(projectPath: string): Promise<ReferenceWorksSummary> {
  validateProjectPath(projectPath)
  await rm(referenceGuidanceDir(projectPath), { recursive: true, force: true })
  return getReferenceWorksSummary(projectPath)
}

export async function resetReferenceWorks(projectPath: string): Promise<ReferenceWorksSummary> {
  validateProjectPath(projectPath)
  await clearReferenceFiles(projectPath)
  await rm(referenceGuidanceDir(projectPath), { recursive: true, force: true })
  return getReferenceWorksSummary(projectPath)
}

export async function getReferenceWorksSummary(projectPath: string): Promise<ReferenceWorksSummary> {
  const sources = await listReferenceSources(projectPath)
  const referencesUpdatedAt = await optionalDirectoryMtime(referencesDir(projectPath))
  const latestSourceUpdatedAt = latestIso([...sources.map((item) => item.updatedAt), referencesUpdatedAt])
  const guidance = await readReferenceGuidanceSummary(projectPath)
  const guidanceUpdatedAt = guidance?.updatedAt
  const sourceCount = sources.length
  const hasSources = sourceCount > 0
  const stale = Boolean(
    guidance &&
      (!hasSources || (latestSourceUpdatedAt && guidanceUpdatedAt && latestSourceUpdatedAt > guidanceUpdatedAt)),
  )
  const needsAnalysis = hasSources && (!guidance || stale)
  const guidanceState = !hasSources
    ? guidance
      ? 'stale'
      : 'empty'
    : !guidance
      ? 'needs-analysis'
      : stale
        ? 'stale'
        : 'current'

  return {
    sources,
    guidance,
    status: {
      guidanceState,
      sourceCount,
      needsAnalysis,
      stale,
      latestSourceUpdatedAt,
      guidanceExists: Boolean(guidance),
      guidanceUpdatedAt,
    },
  }
}

export async function pasteReferenceSource(input: PasteReferenceSourceInput): Promise<ReferenceWorksSummary> {
  validateProjectPath(input.projectPath)
  const content = input.content.trim()
  if (!content) throw new Error('参考作品正文不能为空。')
  const title = input.title.trim()
  if (!title) throw new Error('参考作品标题不能为空。')

  const directory = referencesDir(input.projectPath)
  await mkdir(directory, { recursive: true })
  const fileName = await uniqueFileName(directory, sanitizeFileStem(title), '.md')
  await writeFile(join(directory, fileName), `# ${title}\n\n${content}\n`, 'utf-8')

  return getReferenceWorksSummary(input.projectPath)
}

export async function importReferenceSourceFiles(
  input: ImportReferenceSourceFilesInput,
): Promise<ReferenceWorksSummary> {
  validateProjectPath(input.projectPath)
  if (input.sourcePaths.length === 0) return getReferenceWorksSummary(input.projectPath)

  const directory = referencesDir(input.projectPath)
  await mkdir(directory, { recursive: true })

  for (const sourcePath of input.sourcePaths) {
    const sourceName = basename(sourcePath)
    const extension = normalizeExtension(sourceName)
    const stem = sanitizeFileStem(stripExtension(sourceName))
    const content = await readFile(sourcePath)
    const fileName = await uniqueFileName(directory, stem, extension)
    await writeFile(join(directory, fileName), content)
  }

  return getReferenceWorksSummary(input.projectPath)
}

export async function removeReferenceSource(input: RemoveReferenceSourceInput): Promise<ReferenceWorksSummary> {
  validateProjectPath(input.projectPath)
  validateReferenceFileName(input.fileName)
  const target = resolveProjectPath(input.projectPath, join(referencesRelativeDir(), input.fileName))
  await unlink(target)
  return getReferenceWorksSummary(input.projectPath)
}
