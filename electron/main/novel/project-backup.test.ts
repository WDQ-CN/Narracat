import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'

import { writeNovelPacks } from './novel-packs'
import {
  createNovelProjectBackup,
  inspectNovelProjectBackup,
  restoreNovelProjectBackup,
  type ProjectBackupEnvironment,
} from './project-backup'
import { createNovelProjectFixture, writeNovelFixtureFile } from './test-novel-fixture'

let root: string
let agentCorePath: string
let userDataPath: string
let environment: ProjectBackupEnvironment

async function writePack(input: {
  basePath: string
  directoryName: string
  id: string
  version: string
}): Promise<string> {
  const directoryPath = join(input.basePath, input.directoryName)
  await mkdir(join(directoryPath, 'cards'), { recursive: true })
  await writeFile(
    join(directoryPath, 'pack.json'),
    JSON.stringify({
      pack_format_version: 1,
      id: input.id,
      name: input.id,
      author: 'fixture',
      version: input.version,
      cards: [],
    }),
    'utf8',
  )
  await writeFile(join(directoryPath, 'README.md'), `${input.id}@${input.version}\n`, 'utf8')
  return directoryPath
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'narracat-project-backup-'))
  agentCorePath = join(root, 'agent-core')
  userDataPath = join(root, 'user-data')
  await writePack({
    basePath: join(agentCorePath, 'packs'),
    directoryName: 'base',
    id: 'official-base',
    version: '1.0.0',
  })
  environment = {
    appVersion: '0.1.0-test',
    agentCoreVersion: '2026.07.27',
    agentCorePath,
    userDataPath,
  }
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('novel project backup', () => {
  test('round-trips all regular project files with hashes, including drafts, revisions and unknown files', async () => {
    const project = await createNovelProjectFixture({ name: 'backup-round-trip' })
    const draftPath = join('.narracat', 'manuscript-drafts', 'ch-001.json')
    const revisionPath = join('.narracat', 'manuscript-revisions', 'ch-001', 'revision-1.md')
    const unknownPath = join('future-assets', 'unknown.bin')
    await writeNovelFixtureFile(project.root, draftPath, '{"content":"未提交草稿"}\n')
    await writeNovelFixtureFile(project.root, revisionPath, '历史修订\n')
    await writeNovelFixtureFile(project.root, unknownPath, 'future-data')
    await writeNovelFixtureFile(project.root, '.DS_Store', 'ignored')
    await writeNovelFixtureFile(project.root, '.narracat-backup-tmp-stale', 'ignored')

    const backupPath = join(root, '星辰大海.narracatbackup')
    const created = await createNovelProjectBackup(
      { projectPath: project.root, targetPath: backupPath },
      environment,
    )
    const manifest = await inspectNovelProjectBackup(backupPath)

    expect(created.filePath).toBe(backupPath)
    expect(manifest.novel).toEqual({ id: 'novel-1', title: '星辰大海' })
    expect(manifest.files.map((file) => file.path)).toContain(draftPath)
    expect(manifest.files.map((file) => file.path)).toContain(revisionPath)
    expect(manifest.files.map((file) => file.path)).toContain(unknownPath)
    expect(manifest.files.map((file) => file.path)).not.toContain('.DS_Store')
    expect(manifest.files.map((file) => file.path)).not.toContain('.narracat-backup-tmp-stale')
    expect(manifest.capabilityPacks).toEqual([
      expect.objectContaining({ id: 'official-base', version: '1.0.0', origin: 'official' }),
    ])

    const destinationPath = join(root, 'restored', '星辰大海')
    const restored = await restoreNovelProjectBackup(
      { sourcePath: backupPath, destinationPath },
      { ...environment, existingProjects: [] },
    )
    expect(restored.project).toMatchObject({
      id: 'novel-1',
      title: '星辰大海',
      path: destinationPath,
    })
    expect(restored.missingCapabilityPacks).toEqual([])
    expect(await readFile(join(destinationPath, draftPath), 'utf8')).toBe('{"content":"未提交草稿"}\n')
    expect(await readFile(join(destinationPath, revisionPath), 'utf8')).toBe('历史修订\n')
    expect(await readFile(join(destinationPath, unknownPath), 'utf8')).toBe('future-data')

    await rm(project.root, { recursive: true, force: true })
  })

  test('rejects a source symlink and reports its project-relative path', async () => {
    const project = await createNovelProjectFixture({ name: 'backup-symlink' })
    const outsidePath = join(root, 'outside.txt')
    await writeFile(outsidePath, 'secret', 'utf8')
    await symlink(outsidePath, join(project.root, 'linked-secret.txt'))

    await expect(
      createNovelProjectBackup(
        { projectPath: project.root, targetPath: join(root, 'unsafe.narracatbackup') },
        environment,
      ),
    ).rejects.toThrow('linked-secret.txt')
    await rm(project.root, { recursive: true, force: true })
  })

  test('rejects tampering and removes the incomplete restore directory', async () => {
    const project = await createNovelProjectFixture({ name: 'backup-tamper' })
    const backupPath = join(root, 'tampered.narracatbackup')
    await createNovelProjectBackup({ projectPath: project.root, targetPath: backupPath }, environment)
    const zip = new AdmZip(backupPath)
    zip.updateFile('project/bible/premise.md', Buffer.from('tampered'))
    zip.writeZip(backupPath)

    const destinationPath = join(root, 'restore-parent', 'restored')
    await expect(
      restoreNovelProjectBackup(
        { sourcePath: backupPath, destinationPath },
        { ...environment, existingProjects: [] },
      ),
    ).rejects.toThrow(/大小校验失败|哈希校验失败/)
    expect(existsSync(destinationPath)).toBe(false)
    const siblings = await readdir(join(root, 'restore-parent')).catch(() => [])
    expect(siblings.filter((name) => name.startsWith('.narracat-restore-tmp-'))).toEqual([])
    await rm(project.root, { recursive: true, force: true })
  })

  test('rejects a real zip-slip entry before extraction', async () => {
    const project = await createNovelProjectFixture({ name: 'backup-zip-slip' })
    await writeNovelFixtureFile(project.root, join('XX', 'evil.txt'), 'outside')
    const backupPath = join(root, 'zip-slip.narracatbackup')
    await createNovelProjectBackup({ projectPath: project.root, targetPath: backupPath }, environment)

    const placeholder = 'project/XX/evil.txt'
    const malicious = 'project/../evil.txt'
    expect(placeholder.length).toBe(malicious.length)
    const raw = await readFile(backupPath)
    const patched = Buffer.from(
      raw.toString('binary').split(placeholder).join(malicious),
      'binary',
    )
    await writeFile(backupPath, patched)

    await expect(inspectNovelProjectBackup(backupPath)).rejects.toThrow('非法条目')
    expect(existsSync(join(root, 'evil.txt'))).toBe(false)
    await rm(project.root, { recursive: true, force: true })
  })

  test('rejects an unknown newer format and duplicate novel identity without modifying the backup', async () => {
    const project = await createNovelProjectFixture({ name: 'backup-version' })
    const backupPath = join(root, 'version.narracatbackup')
    await createNovelProjectBackup({ projectPath: project.root, targetPath: backupPath }, environment)
    const originalBackup = await readFile(backupPath)

    await expect(
      restoreNovelProjectBackup(
        { sourcePath: backupPath, destinationPath: join(root, 'duplicate') },
        {
          ...environment,
          existingProjects: [
            {
              id: 'novel-1',
              title: '已存在',
              genre: '未分类',
              coverPreset: 'cover-01',
              path: '/library/existing',
              status: 'ready',
              chapterProgress: '0 / 1 章',
              wordCountLabel: '0 字',
              wordCountTotal: 0,
            },
          ],
        },
      ),
    ).rejects.toThrow('不能重复恢复同一 novel_id')
    expect(await readFile(backupPath)).toEqual(originalBackup)

    const zip = new AdmZip(backupPath)
    const manifest = JSON.parse(zip.readAsText('manifest.json')) as Record<string, unknown>
    zip.updateFile('manifest.json', Buffer.from(JSON.stringify({ ...manifest, formatVersion: 999 })))
    zip.writeZip(backupPath)
    await expect(inspectNovelProjectBackup(backupPath)).rejects.toThrow('升级 App')
    await rm(project.root, { recursive: true, force: true })
  })

  test('suspends a missing exact user-pack version and records the dependency instead of substituting latest', async () => {
    const project = await createNovelProjectFixture({ name: 'backup-missing-pack' })
    const installedPackPath = await writePack({
      basePath: join(userDataPath, 'packs'),
      directoryName: 'slow-burn@1.0.0',
      id: 'slow-burn',
      version: '1.0.0',
    })
    await writePack({
      basePath: join(userDataPath, 'packs'),
      directoryName: 'slow-burn@2.0.0',
      id: 'slow-burn',
      version: '2.0.0',
    })
    await writeNovelPacks(project.root, [
      { id: 'official-base' },
      { id: 'slow-burn', version: '1.0.0' },
    ])
    const backupPath = join(root, 'packs.narracatbackup')
    await createNovelProjectBackup({ projectPath: project.root, targetPath: backupPath }, environment)
    await rm(installedPackPath, { recursive: true, force: true })

    const destinationPath = join(root, 'restored-with-missing-pack')
    const restored = await restoreNovelProjectBackup(
      { sourcePath: backupPath, destinationPath },
      { ...environment, existingProjects: [] },
    )
    expect(restored.missingCapabilityPacks).toEqual([
      expect.objectContaining({ id: 'slow-burn', version: '1.0.0', origin: 'user' }),
    ])
    expect(
      JSON.parse(await readFile(join(destinationPath, '.narracat', 'packs.json'), 'utf8')),
    ).toEqual({ format_version: 1, enabled: [{ id: 'official-base' }] })
    expect(
      JSON.parse(
        await readFile(
          join(destinationPath, '.narracat', 'backup-suspended-packs.json'),
          'utf8',
        ),
      ),
    ).toMatchObject({
      reason: 'backup-restore-missing-exact-version',
      dependencies: [{ id: 'slow-burn', version: '1.0.0' }],
    })
    await rm(project.root, { recursive: true, force: true })
  })
})
