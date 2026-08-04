import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveWriteNextRun } from '../agent/runs/write-next'
import { resolveNarraCatCommandRun } from '../agent/runs/narracat-command'
import { createNarraCatPluginFixture } from '../engine/test-plugin-fixture'
import { createNovelProject } from './novel-create'
import { loadNovelProjectDetail } from './novel-project'
import { loadNovelWorkbenchArtifacts } from './novel-artifacts'
import { parseYamlRecord, readRecord, stringifyYamlRecord } from './yaml'

let pluginPath = ''

async function simulateCompletedFirstChapter(projectPath: string): Promise<void> {
  await mkdir(join(projectPath, 'manuscript', 'vol-01'), { recursive: true })
  await mkdir(join(projectPath, '.narracat', 'context-packs'), { recursive: true })
  await mkdir(join(projectPath, 'reviews'), { recursive: true })
  await writeFile(
    join(projectPath, 'manuscript', 'vol-01', 'ch-001.md'),
    '# 第1章: 初醒\n\n林舟醒来，舰队等待他的命令。\n',
    'utf-8',
  )
  await writeFile(
    join(projectPath, '.narracat', 'context-packs', 'ch-001.json'),
    '{"target_chapter":1,"style_guidance":{}}\n',
    'utf-8',
  )
  await writeFile(
    join(projectPath, 'reviews', 'ch-001-review.json'),
    '{"chapter":1,"verdict":"pass","issues":[]}\n',
    'utf-8',
  )

  const statePath = join(projectPath, '.narracat', 'state.yaml')
  const state = parseYamlRecord(await readFile(statePath, 'utf-8'), statePath)
  const progress = readRecord(state, 'progress')
  const wordCount = readRecord(state, 'word_count')

  progress.last_completed_chapter = 1
  progress.completed_chapters = [1]
  progress.in_progress_chapter = null
  wordCount.total = 1200
  wordCount.by_chapter = { 1: 1200 }
  state.checkpoint = { last_command: null, last_step: null, timestamp: null }

  await writeFile(statePath, stringifyYamlRecord(state), 'utf-8')
}

// Simulate what the writing Agent would produce, now that the App-side
// saveNovelSetup / saveChapterOutline writers are gone: fill premise.md to drive
// needs-setup → needs-outline.
async function simulateSetupComplete(projectPath: string): Promise<void> {
  await writeFile(
    join(projectPath, 'bible', 'premise.md'),
    '# 核心前提\n\n## 一句话概要\n失忆舰长带领流亡舰队寻找失落家园。\n',
    'utf-8',
  )
}

// Write the master / volume / chapter-1 outline and plan one chapter in state,
// driving needs-outline → ready with chapter 1 planned.
async function simulateChapterOneOutline(projectPath: string): Promise<void> {
  await mkdir(join(projectPath, 'outline', 'vol-01'), { recursive: true })
  await writeFile(join(projectPath, 'outline', 'master-outline.md'), '# 星辰大海 — 全书大纲\n', 'utf-8')
  await writeFile(join(projectPath, 'outline', 'vol-01', 'vol-outline.md'), '# 第1卷: 醒于冷舱\n', 'utf-8')
  await writeFile(join(projectPath, 'outline', 'vol-01', 'ch-001.md'), '# 第1章: 醒于冷舱\n', 'utf-8')
  await writeFile(
    join(projectPath, '.narracat', 'state.yaml'),
    [
      'progress:',
      '  last_completed_chapter: 0',
      '  completed_chapters: []',
      '  in_progress_chapter: null',
      '  total_chapters_planned: 1',
      '  chapters_outlined: [1]',
      'word_count:',
      '  total: 0',
      '  by_chapter: {}',
      'checkpoint:',
      '  last_command: null',
      '  last_step: null',
      '  timestamp: null',
      'structure:',
      '  total_volumes: 1',
      '  total_chapters_planned: 1',
      '  chapter_to_volume:',
      '    1: 1',
      '',
    ].join('\n'),
    'utf-8',
  )
}

describe('Golden Path project contract', () => {
  beforeAll(async () => {
    pluginPath = await createNarraCatPluginFixture('narracat-golden-path-plugin-')
  })

  test('carries the client-created genre seed into setup without running init', async () => {
    const root = await mkdtemp(join(tmpdir(), 'narracat-setup-genre-'))
    const created = await createNovelProject({
      novelRootDir: root,
      pluginPath,
      input: {
        title: '问道长生',
        genre: '仙侠',
        automationLevel: 'auto',
      },
    })
    const config = parseYamlRecord(
      await readFile(join(created.projectPath, '.narracat', 'config.yaml'), 'utf-8'),
      'config.yaml',
    )
    const setupSource = await readFile(join(process.cwd(), 'agent-core', 'narracat', 'commands', 'setup.md'), 'utf-8')
    const setupRun = resolveNarraCatCommandRun(
      {
        threadId: 'thread-setup',
        command: 'setup',
        prompt: '开始设定引导',
        projectPath: created.projectPath,
      },
      {
        pluginPath,
        readCommandFile: (_pluginPath, commandName) => {
          expect(commandName).toBe('setup')
          return setupSource
        },
      },
    )

    expect(config.genre).toBe('仙侠')
    expect(setupRun.prompt).toContain(`当前小说项目根目录：${created.projectPath}`)
    // 抽象契约：不锁 setup.md 原文措辞，只要求 setup prompt 引用项目 config 并携带 genre 关键词，
    // 保证客户端创建项目时写入的题材种子能进入 setup 会话。
    expect(setupRun.prompt).toContain('config.yaml')
    expect(setupRun.prompt).toContain('genre')
  })

  test('flows from empty project to outline planning and readable first chapter output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'narracat-golden-path-'))
    const created = await createNovelProject({
      novelRootDir: root,
      pluginPath,
      input: {
        title: '星辰大海',
        genre: '科幻',
        automationLevel: 'auto',
      },
    })
    const projectPath = created.projectPath

    expect(created.project.status).toBe('needs-setup')
    await expect(loadNovelWorkbenchArtifacts({ projectPath, objectId: 'master-outline' })).resolves.toMatchObject({
      objectKind: 'master-outline',
      artifacts: [expect.objectContaining({ id: 'master-outline', exists: false })],
    })

    await simulateSetupComplete(projectPath)
    const setupDetail = await loadNovelProjectDetail(projectPath)
    expect(setupDetail.status).toBe('needs-outline')

    await simulateChapterOneOutline(projectPath)
    const outlineDetail = await loadNovelProjectDetail(projectPath)

    expect(outlineDetail.status).toBe('ready')
    expect(outlineDetail.chapterProgress).toBe('0 / 1 章')
    expect(outlineDetail.treeItems).toContainEqual(
      expect.objectContaining({ id: 'volume-outline-1', kind: 'volume-outline', exists: true }),
    )
    expect(outlineDetail.treeItems).toContainEqual(
      expect.objectContaining({ id: 'chapter-1', kind: 'chapter', status: 'planned' }),
    )
    await expect(loadNovelWorkbenchArtifacts({ projectPath, objectId: 'volume-outline-1' })).resolves.toMatchObject({
      objectKind: 'volume-outline',
      artifacts: [expect.objectContaining({ id: 'volume-outline-1', exists: true })],
    })

    const writeRun = await resolveWriteNextRun(
      { projectPath, selectedChapter: 1, userPrompt: '写第 1 章' },
      { pluginPath },
    )
    expect(writeRun).toMatchObject({ chapterNumber: 1, volumeNumber: 1, maxTurns: 72 })
    expect(writeRun.prompt).toContain('你正在当前小说项目中执行 NarraCat command：/narracat:write')
    expect(writeRun.prompt).toContain('$ARGUMENTS：1')
    expect(writeRun.prompt).toContain('--- NarraCat command source begin ---')

    await simulateCompletedFirstChapter(projectPath)

    const chapteredDetail = await loadNovelProjectDetail(projectPath, 1)
    expect(chapteredDetail.chapterProgress).toBe('1 / 1 章')
    expect(chapteredDetail.wordCountLabel).toBe('1200 字')
    expect(chapteredDetail.tocItems).toContainEqual(
      expect.objectContaining({ id: 'chapter-1', status: 'completed', active: true }),
    )
    await expect(
      loadNovelWorkbenchArtifacts({ projectPath, objectId: 'chapter-1', volumeNumber: 1 }),
    ).resolves.toMatchObject({
      objectKind: 'chapter',
      artifacts: [
        expect.objectContaining({ id: 'chapter-outline', exists: true }),
        expect.objectContaining({ id: 'manuscript', exists: true, content: expect.stringContaining('林舟醒来') }),
        expect.objectContaining({ id: 'context-pack', exists: true }),
        expect.objectContaining({ id: 'review', exists: true }),
        // 深审标注随轻审同住 reviews/，黄金路径只跑轻审故缺失（ADR-0021）。
        expect.objectContaining({ id: 'deep-review', exists: false }),
      ],
    })
  })
})
