import type { NovelProjectSummary } from './novel'

export const NARRACAT_BACKUP_EXTENSION = '.narracatbackup'
export const NARRACAT_BACKUP_FORMAT_VERSION = 1

export interface NovelProjectBackupFile {
  path: string
  size: number
  sha256: string
}

export interface NovelProjectBackupPackDependency {
  id: string
  version: string
  contentHash: string
  origin: 'official' | 'user'
}

export interface NovelProjectBackupManifest {
  kind: 'narracat-project-backup'
  formatVersion: typeof NARRACAT_BACKUP_FORMAT_VERSION
  createdAt: string
  appVersion: string
  agentCoreVersion: string
  novel: {
    id: string
    title: string
  }
  files: NovelProjectBackupFile[]
  capabilityPacks: NovelProjectBackupPackDependency[]
}

export interface CreateNovelProjectBackupInput {
  projectPath: string
  targetPath: string
}

export interface CreateNovelProjectBackupResult {
  status: 'ok'
  filePath: string
  manifest: NovelProjectBackupManifest
}

export type CreateNovelProjectBackupDialogResult =
  | { status: 'canceled' }
  | CreateNovelProjectBackupResult

export interface RestoreNovelProjectBackupInput {
  sourcePath: string
  destinationPath: string
}

export interface RestoreNovelProjectBackupResult {
  status: 'ok'
  project: NovelProjectSummary
  missingCapabilityPacks: NovelProjectBackupPackDependency[]
}

export type RestoreNovelProjectBackupDialogResult =
  | { status: 'canceled' }
  | RestoreNovelProjectBackupResult

export interface SuspendedNovelPacksFile {
  format_version: 1
  reason: 'backup-restore-missing-exact-version'
  dependencies: NovelProjectBackupPackDependency[]
}
