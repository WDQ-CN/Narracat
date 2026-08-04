import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { CreatedNovelProject, CreateNovelProjectInput } from '@shared/types/novel'
import {
  narracatConfigPath,
  narracatStatePath,
  premisePath,
  projectScaffoldDirectories,
  relationshipsPath,
} from './novel-layout'
import { loadNovelProjectDetail } from './novel-project'
import { writeNovelPacks } from './novel-packs'
import { stringifyYamlRecord } from './yaml'

export interface CreateNovelProjectRequest {
  novelRootDir: string
  pluginPath: string
  input: CreateNovelProjectInput
}

function assertCreateNovelProjectInput(input: CreateNovelProjectInput): void {
  if (input.title.trim().length === 0) {
    throw new Error('title is required')
  }

  if (input.genre.trim().length === 0) {
    throw new Error('genre is required')
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function resolveUniqueNovelProjectIdentity(root: string): Promise<{ id: string; projectPath: string }> {
  while (true) {
    const id = randomUUID()
    const projectPath = join(root, `novel-${id}`)

    if (!(await pathExists(projectPath))) {
      return { id, projectPath }
    }
  }
}

async function createProjectDirectories(projectPath: string): Promise<void> {
  for (const directory of projectScaffoldDirectories()) {
    await mkdir(join(projectPath, directory), { recursive: true })
  }
}

async function copyTemplateFiles(pluginPath: string, projectPath: string): Promise<void> {
  const templates = [
    ['premise-template.md', premisePath()],
    ['relationships-template.md', relationshipsPath()],
  ] as const

  for (const [sourceName, targetRelativePath] of templates) {
    await copyFile(
      join(pluginPath, 'templates', sourceName),
      join(projectPath, targetRelativePath),
    )
  }
}

function stateYaml(): string {
  return stringifyYamlRecord({
    progress: {
      last_completed_chapter: 0,
      completed_chapters: [],
      in_progress_chapter: null,
      total_chapters_planned: 0,
      chapters_outlined: [],
    },
    word_count: {
      total: 0,
      by_chapter: {},
    },
    quality: {
      pending_reviews: [],
      failed_reviews: [],
    },
    foreshadowing: {
      active: [],
      resolved: [],
    },
    structure: {
      total_volumes: 0,
      total_chapters_planned: 0,
      chapter_to_volume: {},
    },
    checkpoint: {
      last_command: null,
      last_step: null,
      context_snapshot: null,
      timestamp: null,
    },
  })
}

export function renderProjectAgentGuide(input: { title: string; genre: string }): string {
  return `# AGENTS.md

本文件是 NarraCat Agent 在当前小说项目中的项目级说明：能力边界与写入规则。创作会话会自动读取本文件——你可以在保留边界与写入规则的前提下，补充这本书的个性化创作要求。

## 项目

- 小说标题：${input.title}
- 题材：${input.genre}
- 语言：zh-CN
- 项目类型：NarraCat 小说项目

## Agent 边界

NarraCat Agent 只服务当前小说项目的创作、规划、设定、审修、参考分析和写作流程。

可以协助：

- 讨论剧情、角色、世界观、节奏、文风和章节目标
- 分析参考作品对当前小说的启发
- 规划全书大纲、卷纲和章节大纲
- 生成、审修和重写章节正文
- 解释当前项目中的 NarraCat 产物

应友好拒绝：

- 与当前小说创作无关的编程、办公、财务、系统设置和泛用问答
- 要求修改 NarraCat App 或 NarraCat Agent Core 源码的请求
- 要求绕过 NarraCat 项目结构直接改写未知文件的请求

## 写入规则

普通对话默认只讨论，不写入项目文件。

只有在用户明确触发 NarraCat Agent action、GUI command chip，或明确要求执行 \`/narracat:*\` 命令时，才可以写入项目文件。

写入时必须遵守当前项目结构：

- \`.narracat/\`：项目配置、状态、上下文包和系统数据
- \`bible/\`：创作根基、参考作品、世界观、角色、规则等设定
- \`outline/\`：全书大纲、卷纲和章节大纲
- \`manuscript/\`：章节正文
- \`reviews/\`：审修报告
- \`notes/\`：用户笔记

不要臆造新的长期目录结构。若需要新增长期结构，先说明原因并请求确认。

## 内部 Agent 分工

NarraCat 会在明确的 Agent action 或 \`/narracat:*\` command flow 中调度专业 Agent。用户通常不需要直接点名这些 Agent。

- outline-architect：规划全书大纲、卷纲、章节大纲和结构调整
- world-curator：创建或调整角色、世界观、地点、规则和关系设定
- chapter-writer：生成章节正文和按修订要求改写正文
- continuity-editor：审修章节、分析连续性、质量问题和重写影响
- memory-keeper：维护 NovelMemory；只负责记忆查询、写入、强化和回滚，不创作正文

## 可用能力

GUI 通常会产品化触发这些能力；用户不需要记住底层命令。

- \`/narracat:setup\`：建立创作根基
- \`/narracat:reference\`：分析参考作品并生成参考指导
- \`/narracat:world\`：创建或调整角色、世界观和设定
- \`/narracat:plan\`：规划或调整大纲
- \`/narracat:write\`：按流程生成章节正文
- \`/narracat:review\`：审修已生成章节
- \`/narracat:rewrite\`：按要求重写章节
- \`/narracat:status\`：查看项目状态

## 数据安全

不要直接读取或修改 \`.narracat/memory.db\`。

记忆查询、写入、强化和回滚必须通过 NarraCat NovelMemory 工具和 memory-keeper 完成。若 NovelMemory 工具不可用，应说明工具不可用并停止相关记忆步骤，不要自行写 SQLite 脚本或手工修改数据库。

## 协作方式

当用户需求不明确时，先提出简短问题或给出可选方向。

当修改会影响多个文件、章节或设定时，先说明影响范围并请求确认。

输出给用户的说明应保持简洁，优先使用中文。
`
}

export function normalizeNovelDirectoryName(title: string): string {
  const normalized = title
    .trim()
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')

  return normalized || 'untitled-novel'
}

export async function createNovelProject(
  request: CreateNovelProjectRequest,
): Promise<CreatedNovelProject> {
  const { input, novelRootDir, pluginPath } = request
  assertCreateNovelProjectInput(input)
  const title = input.title.trim()
  const genre = input.genre.trim()

  await mkdir(novelRootDir, { recursive: true })
  const { id, projectPath } = await resolveUniqueNovelProjectIdentity(novelRootDir)

  await mkdir(projectPath)
  await createProjectDirectories(projectPath)
  await copyTemplateFiles(pluginPath, projectPath)
  await writeFile(
    join(projectPath, narracatConfigPath()),
    stringifyYamlRecord({
      novel_id: id,
      title,
      genre,
      language: 'zh-CN',
      automation_level: input.automationLevel,
      estimated_total_chapters: null,
      words_per_chapter: null,
      style_profile: null,
    }),
    'utf-8',
  )
  await writeFile(join(projectPath, narracatStatePath()), stateYaml(), 'utf-8')
  await writeNovelPacks(projectPath, [{ id: 'official-base' }])
  await writeFile(join(projectPath, 'AGENTS.md'), renderProjectAgentGuide({ title, genre }), 'utf-8')

  return {
    projectPath,
    project: await loadNovelProjectDetail(projectPath),
  }
}
