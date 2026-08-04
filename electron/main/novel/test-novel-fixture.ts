import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export type NovelProjectFixtureState = 'empty' | 'setup' | 'outlined' | 'chaptered'

export interface DynamicBibleGroupFixture {
  dirName: string
  files: Record<string, string>
}

export interface CreateNovelProjectFixtureOptions {
  name?: string
  title?: string
  state?: NovelProjectFixtureState
  contextPackContent?: string
  dynamicBibleGroups?: DynamicBibleGroupFixture[]
}

export interface NovelProjectFixture {
  root: string
  title: string
}

const defaultContextPack = '{"target_chapter":1,"style_guidance":{}}\n'

export async function writeNovelFixtureFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const path = join(root, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf-8')
}

export async function writeZeroPlannedState(root: string): Promise<void> {
  await writeNovelFixtureFile(
    root,
    join('.narracat', 'state.yaml'),
    stateYaml({
      completedChapters: [],
      lastCompletedChapter: 0,
      totalChaptersPlanned: 0,
      totalVolumes: 0,
      wordCountByChapter: {},
      wordCountTotal: 0,
      chapterToVolume: {},
    }),
  )
}

export async function createNovelProjectFixture({
  contextPackContent = defaultContextPack,
  dynamicBibleGroups = [],
  name = 'project',
  state = 'chaptered',
  title = '星辰大海',
}: CreateNovelProjectFixtureOptions = {}): Promise<NovelProjectFixture> {
  const root = await mkdtemp(join(tmpdir(), `narracat-novel-${name}-`))

  await mkdir(join(root, '.narracat', 'context-packs'), { recursive: true })
  await mkdir(join(root, 'outline', 'vol-01'), { recursive: true })
  await mkdir(join(root, 'manuscript', 'vol-01'), { recursive: true })
  await mkdir(join(root, 'reviews'), { recursive: true })
  await mkdir(join(root, 'bible', 'characters'), { recursive: true })
  await mkdir(join(root, 'bible', 'world'), { recursive: true })
  await mkdir(join(root, 'bible', 'references'), { recursive: true })

  await writeNovelFixtureFile(
    root,
    join('.narracat', 'config.yaml'),
    [
      'novel_id: novel-1',
      `title: ${title}`,
      'language: zh-CN',
      'automation_level: auto',
      'estimated_total_chapters: null',
      'words_per_chapter: null',
      'style_profile: null',
      '',
    ].join('\n'),
  )

  if (state === 'empty') {
    await writeTemplateSetupFiles(root)
    await writeZeroPlannedState(root)
  } else {
    await writeFilledSetupFiles(root)
    await writeStateForFixture(root, state)
  }

  if (state === 'outlined' || state === 'chaptered') {
    await writeOutlineFiles(root)
  }

  if (state === 'chaptered') {
    await writeChapterArtifacts(root, contextPackContent)
  }

  for (const group of dynamicBibleGroups) {
    for (const [fileName, content] of Object.entries(group.files)) {
      await writeNovelFixtureFile(root, join('bible', group.dirName, fileName), content)
    }
  }

  return { root, title }
}

async function writeStateForFixture(root: string, state: Exclude<NovelProjectFixtureState, 'empty'>): Promise<void> {
  if (state === 'setup') {
    await writeZeroPlannedState(root)
    return
  }

  await writeNovelFixtureFile(
    root,
    join('.narracat', 'state.yaml'),
    stateYaml({
      completedChapters: state === 'chaptered' ? [1] : [],
      lastCompletedChapter: state === 'chaptered' ? 1 : 0,
      totalChaptersPlanned: 2,
      totalVolumes: 1,
      wordCountByChapter: state === 'chaptered' ? { 1: 2100 } : {},
      wordCountTotal: state === 'chaptered' ? 2100 : 0,
      chapterToVolume: { 1: 1, 2: 1 },
    }),
  )
}

async function writeTemplateSetupFiles(root: string): Promise<void> {
  await writeNovelFixtureFile(root, join('bible', 'premise.md'), '# 核心前提\n\n（用一句话概括整个故事）\n')
  await writeNovelFixtureFile(
    root,
    join('bible', 'relationships.md'),
    [
      '# 角色关系图谱',
      '',
      '## 核心关系',
      '',
      '| 角色 A | 关系 | 角色 B | 备注 |',
      '|---|---|---|---|',
      '',
      '## 阵营/势力',
      '',
      '（如有阵营划分在此描述）',
      '',
    ].join('\n'),
  )
  await writeNovelFixtureFile(root, join('bible', 'characters', '角色名.md'), '# 角色名\n\n## 基本信息\n- 全名:\n')
  await writeNovelFixtureFile(root, join('bible', 'world', '设定名称.md'), '# 设定名称\n\n## 概述\n（一段话概括）\n')
}

async function writeFilledSetupFiles(root: string): Promise<void> {
  await writeNovelFixtureFile(root, join('bible', 'premise.md'), '# 核心前提\n\n## 一句话概要\n真实前提\n')
  await writeNovelFixtureFile(root, join('bible', 'characters', '林舟.md'), '# 林舟\n\n目标明确\n')
  await writeNovelFixtureFile(root, join('bible', 'world', '边境城.md'), '# 边境城\n\n边境城是主角旅程的起点。\n')
}

async function writeOutlineFiles(root: string): Promise<void> {
  await writeNovelFixtureFile(root, join('outline', 'master-outline.md'), '# 全书大纲\n')
  await writeNovelFixtureFile(root, join('outline', 'vol-01', 'vol-outline.md'), '# 第一卷\n')
  await writeNovelFixtureFile(root, join('outline', 'vol-01', 'ch-001.md'), '# 第1章: 初醒\n')
  await writeNovelFixtureFile(root, join('outline', 'vol-01', 'ch-002.md'), '# 第2章: 远行\n')
}

async function writeChapterArtifacts(root: string, contextPackContent: string): Promise<void> {
  await writeNovelFixtureFile(root, join('manuscript', 'vol-01', 'ch-001.md'), '# 第1章: 初醒\n\n正文\n')
  await writeNovelFixtureFile(root, join('.narracat', 'context-packs', 'ch-001.json'), contextPackContent)
  await writeNovelFixtureFile(
    root,
    join('reviews', 'ch-001-review.json'),
    '{"chapter":1,"verdict":"pass","issues":[]}\n',
  )
}

function stateYaml({
  chapterToVolume,
  completedChapters,
  lastCompletedChapter,
  totalChaptersPlanned,
  totalVolumes,
  wordCountByChapter,
  wordCountTotal,
}: {
  chapterToVolume: Record<number, number>
  completedChapters: number[]
  lastCompletedChapter: number
  totalChaptersPlanned: number
  totalVolumes: number
  wordCountByChapter: Record<number, number>
  wordCountTotal: number
}): string {
  return [
    'progress:',
    `  last_completed_chapter: ${lastCompletedChapter}`,
    `  completed_chapters: [${completedChapters.join(', ')}]`,
    '  in_progress_chapter: null',
    `  total_chapters_planned: ${totalChaptersPlanned}`,
    `  chapters_outlined: [${outlinedChapters(chapterToVolume).join(', ')}]`,
    'word_count:',
    `  total: ${wordCountTotal}`,
    ...recordLines('by_chapter', wordCountByChapter, 2),
    'checkpoint:',
    '  last_command: null',
    '  last_step: null',
    '  timestamp: null',
    'structure:',
    `  total_volumes: ${totalVolumes}`,
    `  total_chapters_planned: ${totalChaptersPlanned}`,
    ...recordLines('chapter_to_volume', chapterToVolume, 2),
    '',
  ].join('\n')
}

function outlinedChapters(record: Record<number, number>): number[] {
  return Object.keys(record)
    .map(Number)
    .filter((value) => Number.isInteger(value))
    .sort((left, right) => left - right)
}

function recordLines(label: string, record: Record<number, number>, indent: number): string[] {
  const entries = Object.entries(record)
  const prefix = ' '.repeat(indent)

  if (entries.length === 0) {
    return [`${prefix}${label}: {}`]
  }

  return [`${prefix}${label}:`, ...entries.map(([key, value]) => `${prefix}  ${key}: ${value}`)]
}
