import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import AdmZip from 'adm-zip'

import {
  NARRACAT_BACKUP_FORMAT_VERSION,
  type NovelProjectBackupFile,
  type NovelProjectBackupManifest,
  type NovelProjectBackupPackDependency,
  type RestoreNovelProjectBackupResult,
  type SuspendedNovelPacksFile,
} from '@shared/types/project-backup'
import type { NovelProjectSummary } from '@shared/types/novel'
import {
  builtinPacksDir,
  computePackContentHash,
  userPacksDir,
} from '../packs/pack-store'
import { loadNovelProjectSummary } from './novel-project'
import { readNovelPacks, writeNovelPacks } from './novel-packs'

const BACKUP_MANIFEST_ENTRY = 'manifest.json'
const BACKUP_PROJECT_PREFIX = 'project/'
const BACKUP_MANIFEST_MAX_BYTES = 4 * 1024 * 1024
const SUSPENDED_PACKS_FILENAME = 'backup-suspended-packs.json'
const BACKUP_TEMP_PREFIX = '.narracat-backup-tmp-'

export interface ProjectBackupEnvironment {
  appVersion: string
  agentCoreVersion: string
  agentCorePath: string
  userDataPath: string
}

export interface RestoreProjectBackupEnvironment extends ProjectBackupEnvironment {
  existingProjects: NovelProjectSummary[]
}

interface SnapshotFile extends NovelProjectBackupFile {
  data: Buffer
}

function backupError(message: string): Error {
  const error = new Error(message)
  error.name = 'NovelProjectBackupError'
  return error
}

function sha256(data: Uint8Array): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

function toArchivePath(path: string): string {
  return path.split(sep).join('/')
}

function isSafeArchivePath(path: string): boolean {
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0')) return false
  const segments = path.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function shouldExcludeSnapshotEntry(name: string): boolean {
  return name === '.DS_Store' || name.startsWith(BACKUP_TEMP_PREFIX)
}

async function collectProjectFilePaths(projectPath: string): Promise<string[]> {
  const paths: string[] = []

  async function visit(directoryPath: string, directoryRelativePath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      if (shouldExcludeSnapshotEntry(entry.name)) continue
      const fullPath = join(directoryPath, entry.name)
      const relativePath = directoryRelativePath
        ? `${directoryRelativePath}/${entry.name}`
        : entry.name
      const info = await lstat(fullPath)
      if (info.isSymbolicLink()) {
        throw backupError(`项目包含符号链接，无法备份：${relativePath}`)
      }
      if (info.isDirectory()) {
        await visit(fullPath, relativePath)
        continue
      }
      if (!info.isFile()) {
        throw backupError(`项目包含不支持的文件类型，无法备份：${relativePath}`)
      }
      paths.push(relativePath)
    }
  }

  await visit(projectPath, '')
  return paths
}

async function snapshotRegularFile(projectPath: string, path: string): Promise<SnapshotFile> {
  const fullPath = join(projectPath, ...path.split('/'))
  const handle = await open(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw backupError(`项目文件类型在备份期间发生变化：${path}`)
    const data = await handle.readFile()
    const after = await handle.stat()
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino
    ) {
      throw backupError(`项目文件在备份期间发生变化，请重试：${path}`)
    }
    return { path, size: data.byteLength, sha256: sha256(data), data }
  } finally {
    await handle.close()
  }
}

async function readPackManifestIdentity(
  directoryPath: string,
): Promise<{ id: string; version: string } | null> {
  try {
    const raw = JSON.parse(await readFile(join(directoryPath, 'pack.json'), 'utf8')) as Record<string, unknown>
    if (typeof raw.id !== 'string' || typeof raw.version !== 'string') return null
    return { id: raw.id, version: raw.version }
  } catch {
    return null
  }
}

async function findInstalledPackDirectory(input: {
  dependency: { id: string; version?: string }
  agentCorePath: string
  userDataPath: string
}): Promise<{ directoryPath: string; version: string; origin: 'official' | 'user' } | null> {
  for (const [basePath, origin] of [
    [builtinPacksDir(input.agentCorePath), 'official'],
    [userPacksDir(input.userDataPath), 'user'],
  ] as const) {
    const entries = await readdir(basePath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const directoryPath = join(basePath, entry.name)
      const identity = await readPackManifestIdentity(directoryPath)
      if (!identity || identity.id !== input.dependency.id) continue
      if (input.dependency.version && identity.version !== input.dependency.version) continue
      if (!input.dependency.version && origin !== 'official') continue
      return { directoryPath, version: identity.version, origin }
    }
  }
  return null
}

async function collectCapabilityPackDependencies(
  projectPath: string,
  environment: ProjectBackupEnvironment,
): Promise<NovelProjectBackupPackDependency[]> {
  const { enabled } = await readNovelPacks(projectPath)
  const dependencies: NovelProjectBackupPackDependency[] = []

  for (const entry of enabled) {
    const installed = await findInstalledPackDirectory({
      dependency: entry,
      agentCorePath: environment.agentCorePath,
      userDataPath: environment.userDataPath,
    })
    if (!installed) {
      const label = entry.version ? `${entry.id}@${entry.version}` : entry.id
      throw backupError(`已启用的能力包不可读取，无法生成可验证备份：${label}`)
    }
    dependencies.push({
      id: entry.id,
      version: installed.version,
      contentHash: await computePackContentHash(installed.directoryPath),
      origin: installed.origin,
    })
  }

  return dependencies.sort((left, right) =>
    `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`),
  )
}

function parseBackupFile(value: unknown): NovelProjectBackupFile | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (
    typeof item.path !== 'string' ||
    !isSafeArchivePath(item.path) ||
    typeof item.size !== 'number' ||
    !Number.isSafeInteger(item.size) ||
    item.size < 0 ||
    typeof item.sha256 !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(item.sha256)
  ) {
    return null
  }
  return { path: item.path, size: item.size, sha256: item.sha256 }
}

function parsePackDependency(value: unknown): NovelProjectBackupPackDependency | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (
    typeof item.id !== 'string' ||
    !item.id.trim() ||
    typeof item.version !== 'string' ||
    !item.version.trim() ||
    typeof item.contentHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(item.contentHash) ||
    (item.origin !== 'official' && item.origin !== 'user')
  ) {
    return null
  }
  return {
    id: item.id,
    version: item.version,
    contentHash: item.contentHash,
    origin: item.origin,
  }
}

function parseBackupManifest(value: unknown): NovelProjectBackupManifest {
  if (!value || typeof value !== 'object') throw backupError('备份清单格式不合法。')
  const input = value as Record<string, unknown>
  if (input.kind !== 'narracat-project-backup') throw backupError('不是 NarraCat 小说项目备份。')
  if (typeof input.formatVersion !== 'number' || !Number.isInteger(input.formatVersion)) {
    throw backupError('备份格式版本缺失或不合法。')
  }
  if (input.formatVersion > NARRACAT_BACKUP_FORMAT_VERSION) {
    throw backupError('该备份由更新版本的 NarraCat 创建，请升级 App 后再恢复。')
  }
  if (input.formatVersion < NARRACAT_BACKUP_FORMAT_VERSION) {
    throw backupError('该备份格式过旧，当前版本不支持恢复。')
  }
  if (!input.novel || typeof input.novel !== 'object') throw backupError('备份缺少小说身份信息。')
  const novel = input.novel as Record<string, unknown>
  if (
    typeof novel.id !== 'string' ||
    !novel.id.trim() ||
    typeof novel.title !== 'string' ||
    !novel.title.trim() ||
    typeof input.createdAt !== 'string' ||
    typeof input.appVersion !== 'string' ||
    typeof input.agentCoreVersion !== 'string' ||
    !Array.isArray(input.files) ||
    !Array.isArray(input.capabilityPacks)
  ) {
    throw backupError('备份清单字段不完整。')
  }

  const files = input.files.map(parseBackupFile)
  if (files.some((file) => file === null)) throw backupError('备份文件清单不合法。')
  const typedFiles = files as NovelProjectBackupFile[]
  if (new Set(typedFiles.map((file) => file.path)).size !== typedFiles.length) {
    throw backupError('备份文件清单包含重复路径。')
  }
  const capabilityPacks = input.capabilityPacks.map(parsePackDependency)
  if (capabilityPacks.some((dependency) => dependency === null)) {
    throw backupError('备份能力包依赖清单不合法。')
  }

  return {
    kind: 'narracat-project-backup',
    formatVersion: NARRACAT_BACKUP_FORMAT_VERSION,
    createdAt: input.createdAt,
    appVersion: input.appVersion,
    agentCoreVersion: input.agentCoreVersion,
    novel: { id: novel.id, title: novel.title },
    files: typedFiles,
    capabilityPacks: capabilityPacks as NovelProjectBackupPackDependency[],
  }
}

function readAndValidateArchive(sourcePath: string): {
  zip: AdmZip
  manifest: NovelProjectBackupManifest
  projectEntries: Map<string, AdmZip.IZipEntry>
} {
  let zip: AdmZip
  try {
    zip = new AdmZip(sourcePath)
  } catch {
    throw backupError('备份文件无法读取或已损坏。')
  }
  const entries = zip.getEntries()
  const manifestEntries = entries.filter((entry) => entry.entryName === BACKUP_MANIFEST_ENTRY)
  if (manifestEntries.length !== 1 || manifestEntries[0].isDirectory) {
    throw backupError('备份缺少唯一的 manifest.json。')
  }
  const manifestBuffer = manifestEntries[0].getData()
  if (manifestBuffer.byteLength > BACKUP_MANIFEST_MAX_BYTES) throw backupError('备份清单体积异常。')

  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(manifestBuffer.toString('utf8'))
  } catch {
    throw backupError('备份清单不是合法 JSON。')
  }
  const manifest = parseBackupManifest(rawManifest)
  const projectEntries = new Map<string, AdmZip.IZipEntry>()

  for (const entry of entries) {
    if (entry.entryName === BACKUP_MANIFEST_ENTRY) continue
    if (
      entry.isDirectory ||
      !entry.entryName.startsWith(BACKUP_PROJECT_PREFIX) ||
      !isSafeArchivePath(entry.entryName)
    ) {
      throw backupError(`备份包含非法条目：${entry.entryName}`)
    }
    const path = entry.entryName.slice(BACKUP_PROJECT_PREFIX.length)
    if (!isSafeArchivePath(path) || projectEntries.has(path)) {
      throw backupError(`备份包含非法或重复路径：${entry.entryName}`)
    }
    const unixFileType = (entry.attr >>> 16) & 0o170000
    if (unixFileType !== 0 && unixFileType !== 0o100000) {
      throw backupError(`备份包含不支持的文件类型：${path}`)
    }
    projectEntries.set(path, entry)
  }

  if (projectEntries.size !== manifest.files.length) throw backupError('备份条目与文件清单不一致。')
  for (const file of manifest.files) {
    const entry = projectEntries.get(file.path)
    if (!entry) throw backupError(`备份缺少文件：${file.path}`)
    if (entry.header.size !== file.size) throw backupError(`备份文件大小校验失败：${file.path}`)
  }

  return { zip, manifest, projectEntries }
}

async function verifyArchive(sourcePath: string): Promise<NovelProjectBackupManifest> {
  const { manifest, projectEntries } = readAndValidateArchive(sourcePath)
  for (const file of manifest.files) {
    const data = projectEntries.get(file.path)!.getData()
    if (data.byteLength !== file.size || sha256(data) !== file.sha256) {
      throw backupError(`备份文件哈希校验失败：${file.path}`)
    }
  }
  return manifest
}

export async function createNovelProjectBackup(
  input: { projectPath: string; targetPath: string },
  environment: ProjectBackupEnvironment,
): Promise<{ filePath: string; manifest: NovelProjectBackupManifest }> {
  const project = await loadNovelProjectSummary(input.projectPath)
  if (project.status === 'invalid') throw backupError(`项目结构不完整，无法备份：${project.problem ?? project.path}`)

  const paths = await collectProjectFilePaths(input.projectPath)
  const files: SnapshotFile[] = []
  for (const path of paths) files.push(await snapshotRegularFile(input.projectPath, path))
  const capabilityPacks = await collectCapabilityPackDependencies(input.projectPath, environment)
  const manifest: NovelProjectBackupManifest = {
    kind: 'narracat-project-backup',
    formatVersion: NARRACAT_BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: environment.appVersion,
    agentCoreVersion: environment.agentCoreVersion,
    novel: { id: project.id, title: project.title },
    files: files.map(({ data: _data, ...file }) => file),
    capabilityPacks,
  }

  await mkdir(dirname(input.targetPath), { recursive: true })
  const temporaryPath = join(dirname(input.targetPath), `${BACKUP_TEMP_PREFIX}${randomUUID()}`)
  try {
    const zip = new AdmZip()
    zip.addFile(BACKUP_MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
    for (const file of files) zip.addFile(`${BACKUP_PROJECT_PREFIX}${file.path}`, file.data)
    zip.writeZip(temporaryPath)
    await verifyArchive(temporaryPath)
    await rename(temporaryPath, input.targetPath)
    return { filePath: input.targetPath, manifest }
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function resolveMissingPackDependencies(
  dependencies: NovelProjectBackupPackDependency[],
  environment: ProjectBackupEnvironment,
): Promise<NovelProjectBackupPackDependency[]> {
  const missing: NovelProjectBackupPackDependency[] = []
  for (const dependency of dependencies) {
    const installed = await findInstalledPackDirectory({
      dependency: { id: dependency.id, version: dependency.version },
      agentCorePath: environment.agentCorePath,
      userDataPath: environment.userDataPath,
    })
    if (!installed || installed.origin !== dependency.origin) {
      missing.push(dependency)
      continue
    }
    const contentHash = await computePackContentHash(installed.directoryPath).catch(() => '')
    if (contentHash !== dependency.contentHash) missing.push(dependency)
  }
  return missing
}

async function suspendMissingPackDependencies(
  projectPath: string,
  manifest: NovelProjectBackupManifest,
  missing: NovelProjectBackupPackDependency[],
): Promise<void> {
  if (missing.length === 0) return
  const missingKeys = new Set(missing.map((dependency) => `${dependency.id}@${dependency.version}`))
  const enabled = manifest.capabilityPacks
    .filter((dependency) => !missingKeys.has(`${dependency.id}@${dependency.version}`))
    .map((dependency) => ({
      id: dependency.id,
      ...(dependency.origin === 'user' ? { version: dependency.version } : {}),
    }))
  await writeNovelPacks(projectPath, enabled)
  const suspended: SuspendedNovelPacksFile = {
    format_version: 1,
    reason: 'backup-restore-missing-exact-version',
    dependencies: missing,
  }
  await writeFile(
    join(projectPath, '.narracat', SUSPENDED_PACKS_FILENAME),
    JSON.stringify(suspended, null, 2),
    'utf8',
  )
}

export async function restoreNovelProjectBackup(
  input: { sourcePath: string; destinationPath: string },
  environment: RestoreProjectBackupEnvironment,
): Promise<RestoreNovelProjectBackupResult> {
  const destinationInfo = await lstat(input.destinationPath).catch(() => null)
  if (destinationInfo) throw backupError('恢复目标目录已存在，请选择一个新的目录。')

  const { manifest, projectEntries } = readAndValidateArchive(input.sourcePath)
  if (
    environment.existingProjects.some(
      (project) => project.status !== 'invalid' && project.id === manifest.novel.id,
    )
  ) {
    throw backupError(`小说「${manifest.novel.title}」已在书库中，不能重复恢复同一 novel_id。`)
  }

  const parentPath = dirname(input.destinationPath)
  const stagingPath = join(parentPath, `.narracat-restore-tmp-${randomUUID()}`)
  await mkdir(parentPath, { recursive: true })
  try {
    await mkdir(stagingPath, { recursive: false })
    for (const file of manifest.files) {
      const data = projectEntries.get(file.path)!.getData()
      if (data.byteLength !== file.size || sha256(data) !== file.sha256) {
        throw backupError(`备份文件哈希校验失败：${file.path}`)
      }
      const targetPath = join(stagingPath, ...file.path.split('/'))
      const relativeTarget = relative(stagingPath, targetPath)
      if (!relativeTarget || relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
        throw backupError(`备份包含非法恢复路径：${file.path}`)
      }
      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(targetPath, data, { flag: 'wx' })
    }

    const stagedProject = await loadNovelProjectSummary(stagingPath)
    if (stagedProject.status === 'invalid' || stagedProject.id !== manifest.novel.id) {
      throw backupError('恢复后的项目结构或小说身份校验失败。')
    }
    const missingCapabilityPacks = await resolveMissingPackDependencies(
      manifest.capabilityPacks,
      environment,
    )
    await suspendMissingPackDependencies(stagingPath, manifest, missingCapabilityPacks)
    await rename(stagingPath, input.destinationPath)
    const project = await loadNovelProjectSummary(input.destinationPath)
    return { status: 'ok', project, missingCapabilityPacks }
  } finally {
    await rm(stagingPath, { recursive: true, force: true })
  }
}

export async function inspectNovelProjectBackup(
  sourcePath: string,
): Promise<NovelProjectBackupManifest> {
  return verifyArchive(sourcePath)
}

export function defaultRestoreDirectoryName(manifest: NovelProjectBackupManifest): string {
  return safeNovelProjectName(manifest.novel.title, manifest.novel.id)
}

export function safeNovelProjectName(title: string, fallback: string): string {
  const sanitized = title
    .normalize('NFC')
    .replace(/[/:\\?*"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return sanitized || basename(fallback)
}
