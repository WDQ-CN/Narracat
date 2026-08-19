import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { beforeAll, describe, expect, test } from 'bun:test'

import type { CreateNovelProjectInput } from '@shared/types/novel'
import { createNarraCatPluginFixture } from '../engine/test-plugin-fixture'
import { createNovelProject, normalizeNovelDirectoryName, renderProjectAgentGuide } from './novel-create'
import { loadNovelProjectDetail } from './novel-project'
import { parseYamlRecord, readRecord } from './yaml'

let pluginPath = ''

async function tempRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `narracat-create-${name}-`))
}

function validInput(overrides: Partial<CreateNovelProjectInput> = {}): CreateNovelProjectInput {
  return {
    title: '星辰大海',
    genre: '科幻',
    automationLevel: 'auto',
    ...overrides,
  }
}

function expectUuidProjectPath(projectPath: string, root: string): string {
  // 分隔符无关：Windows 上 join 产反斜杠、mac/linux 产正斜杠——不断言分隔符，
  // 只断言「root 开头 + 尾段是 novel-UUID」；basename 本身与分隔符无关。
  expect(projectPath.startsWith(root)).toBe(true)
  expect(basename(projectPath)).toMatch(/^novel-[0-9a-f-]{36}$/)
  return basename(projectPath).replace(/^novel-/, '')
}

describe('novel project creation', () => {
  beforeAll(async () => {
    pluginPath = await createNarraCatPluginFixture('narracat-create-plugin-')
  })

  test('normalizes unsafe titles into usable directory names', () => {
    expect(normalizeNovelDirectoryName(' 星辰/大海:*? ')).toBe('星辰-大海')
    expect(normalizeNovelDirectoryName('   ')).toBe('untitled-novel')
    expect(normalizeNovelDirectoryName('...---   ')).toBe('untitled-novel')
  })

  test('creates a NarraCat-compatible minimal project', async () => {
    const root = await tempRoot('minimal')
    const result = await createNovelProject({
      novelRootDir: root,
      pluginPath,
      input: validInput(),
    })

    const projectUuid = expectUuidProjectPath(result.projectPath, root)
    await expect(stat(join(result.projectPath, '.narracat', 'config.yaml'))).resolves.toBeTruthy()
    await expect(stat(join(result.projectPath, '.narracat', 'state.yaml'))).resolves.toBeTruthy()
    await expect(stat(join(result.projectPath, '.narracat', 'context-packs'))).resolves.toBeTruthy()

    const packsFile = await readFile(join(result.projectPath, '.narracat', 'packs.json'), 'utf-8')
    expect(JSON.parse(packsFile)).toEqual({ format_version: 1, enabled: [{ id: 'official-base' }] })
    await expect(stat(join(result.projectPath, 'bible', 'premise.md'))).resolves.toBeTruthy()
    await expect(stat(join(result.projectPath, 'bible', 'relationships.md'))).resolves.toBeTruthy()
    await expect(stat(join(result.projectPath, 'bible', 'characters'))).resolves.toBeTruthy()
    await expect(stat(join(result.projectPath, 'bible', 'world'))).resolves.toBeTruthy()
    await expect(stat(join(result.projectPath, 'bible', 'references'))).resolves.toBeTruthy()
    await expect(stat(join(result.projectPath, 'bible', 'reference-guidance'))).rejects.toThrow()
    await expect(stat(join(result.projectPath, 'bible', 'style-guide.md'))).rejects.toThrow()
    await expect(stat(join(result.projectPath, 'bible', 'style-analysis-report.md'))).rejects.toThrow()
    await expect(stat(join(result.projectPath, 'outline'))).resolves.toBeTruthy()
    await expect(stat(join(result.projectPath, 'manuscript'))).resolves.toBeTruthy()
    await expect(stat(join(result.projectPath, 'reviews'))).resolves.toBeTruthy()
    await expect(stat(join(result.projectPath, 'notes'))).resolves.toBeTruthy()
    await expect(stat(join(result.projectPath, 'AGENTS.md'))).resolves.toBeTruthy()

    const config = await readFile(join(result.projectPath, '.narracat', 'config.yaml'), 'utf-8')
    expect(config).toContain(`novel_id: ${projectUuid}`)
    expect(config).toContain('title: 星辰大海')
    expect(config).toContain('genre: 科幻')
    expect(config).toContain('language: zh-CN')
    expect(config).toContain('automation_level: auto')
    expect(config).toContain('words_per_chapter: null')
    expect(config).toContain('style_profile: null')
    expect(config).toContain('estimated_total_chapters: null')

    const state = await readFile(join(result.projectPath, '.narracat', 'state.yaml'), 'utf-8')
    expect(state).toContain('last_completed_chapter: 0')
    expect(state).toContain('completed_chapters: []')
    expect(state).toContain('in_progress_chapter: null')
    expect(state).toContain('total_chapters_planned: 0')
    expect(state).toContain('chapters_outlined: []')
    expect(state).toContain('by_chapter: {}')
    expect(state).toContain('context_snapshot: null')

    const detail = await loadNovelProjectDetail(result.projectPath)
    expect(detail).toMatchObject({
      id: projectUuid,
      title: '星辰大海',
      genre: '科幻',
      status: 'needs-setup',
      chapterProgress: '0 / 0 章',
    })
    expect(result.project).toMatchObject(detail)
  })

  test('generates a project Agent guide from stable project facts only', async () => {
    const root = await tempRoot('agent-guide')
    const result = await createNovelProject({
      novelRootDir: root,
      pluginPath,
      input: validInput({
        title: ' 星辰大海 ',
        genre: ' 科幻 ',
      }),
    })

    const guide = await readFile(join(result.projectPath, 'AGENTS.md'), 'utf-8')

    expect(guide).toBe(renderProjectAgentGuide({ title: '星辰大海', genre: '科幻' }))
    expect(guide).toContain('# AGENTS.md')
    expect(guide).not.toContain('Claude Code')
    expect(guide).not.toContain('SDK')
    expect(guide).not.toContain('CLAUDE.md')
    expect(guide).toContain('- 小说标题：星辰大海')
    expect(guide).toContain('- 题材：科幻')
    expect(guide).toContain('- 语言：zh-CN')
    expect(guide).toContain('- 项目类型：NarraCat 小说项目')
    expect(guide).toContain('普通对话默认只讨论，不写入项目文件。')
    expect(guide).toContain('只有在用户明确触发 NarraCat Agent action、GUI command chip，或明确要求执行 `/narracat:*` 命令时')
    expect(guide).toContain('不要直接读取或修改 `.narracat/memory.db`。')
    expect(guide).toContain('记忆查询、写入、强化和回滚必须通过 NarraCat NovelMemory 工具和 memory-keeper 完成。')

    for (const command of [
      '/narracat:setup',
      '/narracat:reference',
      '/narracat:world',
      '/narracat:plan',
      '/narracat:write',
      '/narracat:review',
      '/narracat:rewrite',
      '/narracat:status',
    ]) {
      expect(guide).toContain(command)
    }

    expect(guide).not.toContain('last_completed_chapter')
    expect(guide).not.toContain('chapters_outlined')
    expect(guide).not.toContain('total_chapters_planned')
  })

  test('matches the NarraCat init command config and state contract', async () => {
    const root = await tempRoot('init-contract')
    const result = await createNovelProject({
      novelRootDir: root,
      pluginPath,
      input: validInput(),
    })

    const config = parseYamlRecord(
      await readFile(join(result.projectPath, '.narracat', 'config.yaml'), 'utf-8'),
      'config.yaml',
    )
    expect(Object.keys(config).sort()).toEqual([
      'automation_level',
      'estimated_total_chapters',
      'genre',
      'language',
      'novel_id',
      'style_profile',
      'title',
      'words_per_chapter',
    ])
    expect(config.title).toBe('星辰大海')
    expect(config.genre).toBe('科幻')
    expect(config.language).toBe('zh-CN')
    expect(config.automation_level).toBe('auto')
    expect(config.words_per_chapter).toBeNull()
    expect(config.style_profile).toBeNull()
    expect(config.estimated_total_chapters).toBeNull()
    expect(config).not.toHaveProperty('voltage_bestof')
    expect(config.novel_id).toBe(basename(result.projectPath).replace(/^novel-/, ''))

    const state = parseYamlRecord(
      await readFile(join(result.projectPath, '.narracat', 'state.yaml'), 'utf-8'),
      'state.yaml',
    )
    expect(Object.keys(state).sort()).toEqual([
      'checkpoint',
      'foreshadowing',
      'progress',
      'quality',
      'structure',
      'word_count',
    ])
    expect(readRecord(state, 'progress')).toEqual({
      last_completed_chapter: 0,
      completed_chapters: [],
      in_progress_chapter: null,
      total_chapters_planned: 0,
      chapters_outlined: [],
    })
    expect(readRecord(state, 'checkpoint')).toEqual({
      last_command: null,
      last_step: null,
      context_snapshot: null,
      timestamp: null,
    })
  })

  test('does not overwrite an existing project directory', async () => {
    const root = await tempRoot('collision')
    await mkdir(join(root, '星辰大海'), { recursive: true })
    await writeFile(join(root, '星辰大海', 'note.txt'), 'keep me', 'utf-8')

    const result = await createNovelProject({
      novelRootDir: root,
      pluginPath,
      input: validInput({
        automationLevel: 'collaborative',
      }),
    })

    expectUuidProjectPath(result.projectPath, root)
    await expect(readFile(join(root, '星辰大海', 'note.txt'), 'utf-8')).resolves.toBe('keep me')
  })

  test('creates the novel root directory when it does not exist yet', async () => {
    const root = join(await tempRoot('missing-root'), 'novels')

    const result = await createNovelProject({
      novelRootDir: root,
      pluginPath,
      input: validInput(),
    })

    expectUuidProjectPath(result.projectPath, root)
    await expect(stat(join(result.projectPath, '.narracat', 'config.yaml'))).resolves.toBeTruthy()
  })

  test('rejects blank titles', async () => {
    const root = await tempRoot('blank-title')

    await expect(
      createNovelProject({
        novelRootDir: root,
        pluginPath,
        input: validInput({ title: '   ' }),
      }),
    ).rejects.toThrow(/title/i)
  })

  test('does not require story scale during project creation', async () => {
    const root = await tempRoot('scale-deferred')

    const result = await createNovelProject({
      novelRootDir: root,
      pluginPath,
      input: validInput(),
    })

    const config = parseYamlRecord(
      await readFile(join(result.projectPath, '.narracat', 'config.yaml'), 'utf-8'),
      'config.yaml',
    )
    expect(config.words_per_chapter).toBeNull()
    expect(config.estimated_total_chapters).toBeNull()
  })
})
