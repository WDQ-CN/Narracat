// validateSkillFolder：按 Claude Code skill 规范校验一个本地文件夹是否是合法 Skill。
//
// 本文件只做「是不是有效 skill 文件夹」这一层（#292）：存在 SKILL.md + 合规 frontmatter
// （至少含 name + description）。在其上层叠的两道安全/校验（#294）由 user-skill-store 主导：
// 同名冲突拒绝（SkillNameConflictError，本文件定义、store 判定）、scripts 确认弹窗（渲染端交互）。

import type { Stats } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface ValidatedSkillFolder {
  /** SKILL.md frontmatter name（Claude Code skill 标识，运行时注入用名） */
  name: string
  /** SKILL.md frontmatter description（作者面向简介） */
  description: string
}

/** 校验失败：不是有效的 Skill 文件夹。message 直接面向作者展示。 */
export class InvalidSkillFolderError extends Error {
  constructor(message = '不是有效的 Skill 文件夹。') {
    super(message)
    this.name = 'InvalidSkillFolderError'
  }
}

/**
 * 同名冲突：与官方 Skill 撞名、或该 Agent 已挂同名用户 Skill（#294）。
 * SDK 加载时同名 skill 会互相覆盖打架，故挂载前拒绝。message 直接面向作者展示。
 */
export class SkillNameConflictError extends Error {
  constructor(message = '已存在同名 Skill。') {
    super(message)
    this.name = 'SkillNameConflictError'
  }
}

/**
 * Claude Code skill 名规范：小写 kebab-case（字母/数字段以单个连字符相连），与 skill 目录名一致。
 * 校验在此即拒非规范名（含 '.'、空格、大写、路径段、Windows 保留名等），杜绝坏名进快照——
 * 该 name 之后会作 inline 注入段标题（`### <name>`）与登记名，规范名保证展示与匹配稳定，
 * 是信任边界第一道。
 */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function extractFrontmatter(content: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  return match ? match[1] : null
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * 校验本地文件夹是否符合 Claude Code skill 规范，返回 frontmatter 关键字段。
 * 不合规一律抛 InvalidSkillFolderError（提示「不是有效的 Skill 文件夹」），不区分具体原因——
 * 作者无需知道 frontmatter 细节，只需「这文件夹能不能挂」。
 */
export async function validateSkillFolder(folderPath: string): Promise<ValidatedSkillFolder> {
  const skillMdPath = join(folderPath, 'SKILL.md')

  let info: Stats
  try {
    info = await stat(skillMdPath)
  } catch {
    throw new InvalidSkillFolderError()
  }
  if (!info.isFile()) throw new InvalidSkillFolderError()

  let content: string
  try {
    content = await readFile(skillMdPath, 'utf-8')
  } catch {
    throw new InvalidSkillFolderError()
  }

  const frontmatter = extractFrontmatter(content)
  if (!frontmatter) throw new InvalidSkillFolderError()

  let parsed: Record<string, unknown> | null
  try {
    parsed = parseYaml(frontmatter) as Record<string, unknown> | null
  } catch {
    throw new InvalidSkillFolderError()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InvalidSkillFolderError()

  const name = readString(parsed, 'name')
  const description = readString(parsed, 'description')
  if (!name || !description) throw new InvalidSkillFolderError()
  // name 非小写 kebab → 不是合规 Claude Code skill 名，拒绝（防越界拼接 + 与 SDK skill 目录名对齐）
  if (!SKILL_NAME_PATTERN.test(name)) throw new InvalidSkillFolderError()

  return { name, description }
}
