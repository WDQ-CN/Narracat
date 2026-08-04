// UserSkillStore：用户自定义 Skill 的导入、快照存储与卸载（ADR-0020 第四类，#292）。
//
// 与官方挂载（skill-mount-store.ts，agent-core 默认的薄叠加）分开持久化：用户 Skill 无上游来源，
// 自带一份 userData 快照目录 + 黑盒外的展示元数据，故独立成库，不动 A 阶段官方挂载-卸载契约。
//
// 形状：user-skills.json = { skills: UserSkill[] }，每条 = 一次独立挂载（绑定一个 Agent、全局）。
// 快照在 userData/user-skills/<id>/，完整递归复制原文件夹（含 references/scripts），与原文件夹脱钩。
//
// 降级纪律（对齐 skill-mount-store.ts / notifications.ts）：记录文件缺省 / 损坏 → 空列表不抛，
// 让用户 Skill 挂载始终能回退到「无用户叠加」，绝不阻断 Agent 运行。

import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { UserSkill } from '@shared/types/skill-mount'
import { estimateSkillTokens } from '@shared/lib/skill-budget'
import { SkillNameConflictError, validateSkillFolder } from './validate-skill-folder.ts'

interface UserSkillFile {
  skills: UserSkill[]
}

/** 不开放挂载的 Agent：memory-keeper 纯机械入库，无挂载语义（ADR-0020 约束 3）。
 * 渲染端已门控隐藏入口，此处作主进程信任边界的纵深防御，拒绝越过 UI 直接对其挂载。 */
const MOUNT_DISABLED_AGENT_IDS = new Set<string>(['memory-keeper'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeUserSkill(value: unknown): UserSkill | null {
  if (!isRecord(value)) return null
  const id = readString(value, 'id')
  const agentId = readString(value, 'agentId')
  const name = readString(value, 'name')
  const description = readString(value, 'description')
  const sourcePath = readString(value, 'sourcePath')
  const mountedAt = readString(value, 'mountedAt')
  if (!id || !agentId || !name || !description || !sourcePath || !mountedAt) return null

  return {
    id,
    agentId,
    name,
    description,
    sourcePath,
    hasScripts: value.hasScripts === true,
    mountedAt,
  }
}

function normalizeUserSkillFile(value: unknown): UserSkillFile {
  if (!isRecord(value) || !Array.isArray(value.skills)) return { skills: [] }
  return {
    skills: value.skills.flatMap((item) => {
      const normalized = normalizeUserSkill(item)
      return normalized ? [normalized] : []
    }),
  }
}

/** user-skills.json 路径（与 skill-mounts.json 同级，userData 根） */
export function userSkillStorePath(userDataPath: string): string {
  return join(userDataPath, 'user-skills.json')
}

/**
 * 校验用户 Skill id 安全：id 直接拼成破坏性 cp/rm 的快照路径，IPC 是信任边界。
 * 用严格白名单（非黑名单）——黑名单挡不住 '.'（path.join 归一化后 === user-skills 根，rm 会删掉整个快照根）
 * 与 'config' 之类裸名（误删 user-skills/<name>）。id 一律是导入时 randomUUID() 的产物，故只放行 UUID 形态。
 */
const SAFE_SKILL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isSafeSkillId(id: string): boolean {
  return SAFE_SKILL_ID.test(id)
}

function assertSafeSkillId(id: string): void {
  if (!isSafeSkillId(id)) throw new Error('用户 Skill id 非法。')
}

/** 某条用户 Skill 的快照目录（userData/user-skills/<id>/） */
export function userSkillSnapshotPath(userDataPath: string, id: string): string {
  return join(userDataPath, 'user-skills', id)
}

/** 剥离 SKILL.md 头部 YAML frontmatter，返回正文（frontmatter 之后部分，已去首尾空白）。
 * 无 frontmatter（不合规但宽容处理）→ 原样返回全文。对齐 validate-skill-folder 的 frontmatter 识别。 */
function stripFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)
  return (match ? content.slice(match[0].length) : content).trim()
}

/**
 * 读取一条用户 Skill 快照的 SKILL.md 正文（详情弹窗展示用，#293）。
 * 仅用户自定义 Skill 可看正文（ADR-0020 约束 1：官方 Skill 黑盒，不走此路）。
 *
 * id 过 assertSafeSkillId 越界守卫（IPC 信任边界，防 '../config' 越出 user-skills/ 误读他处）。
 * 读失败（快照缺失 / 文件损坏）降级为空串，由渲染端友好提示，绝不抛错崩溃。
 */
export async function readUserSkillBody(input: { id: string; userDataPath: string }): Promise<string> {
  const { userDataPath } = input
  const id = input.id?.trim()
  if (!id) return ''
  assertSafeSkillId(id)

  try {
    const content = await readFile(join(userSkillSnapshotPath(userDataPath, id), 'SKILL.md'), 'utf-8')
    return stripFrontmatter(content)
  } catch {
    return ''
  }
}

async function readUserSkillFile(storePath: string): Promise<UserSkillFile> {
  try {
    return normalizeUserSkillFile(JSON.parse(await readFile(storePath, 'utf-8')))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { skills: [] }
    // 损坏 JSON / 读失败 → 降级为空列表，绝不抛错阻断读取
    return { skills: [] }
  }
}

async function writeUserSkillFile(storePath: string, skills: UserSkill[]): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true })
  await writeFile(storePath, `${JSON.stringify({ skills }, null, 2)}\n`, 'utf-8')
}

/** 读快照 SKILL.md 估算预加载 token（预算护栏用）；id 非法 / 快照不可读 → undefined（预算按未知占位降级）。 */
async function readSnapshotTokenEstimate(userDataPath: string, id: string): Promise<number | undefined> {
  if (!isSafeSkillId(id)) return undefined
  try {
    return estimateSkillTokens(await readFile(join(userSkillSnapshotPath(userDataPath, id), 'SKILL.md'), 'utf-8'))
  } catch {
    return undefined
  }
}

/**
 * 在读取边界给用户 Skill 列表统一补 estimatedTokens（按快照 SKILL.md 现算，不持久化——
 * 对齐官方 skill 走 diagnostics 现算）。用户 Skill 一律预加载，故其 token 必须计入预算护栏。
 */
async function withTokenEstimates(userDataPath: string, skills: UserSkill[]): Promise<UserSkill[]> {
  return Promise.all(
    skills.map(async (skill) => ({
      ...skill,
      estimatedTokens: await readSnapshotTokenEstimate(userDataPath, skill.id),
    })),
  )
}

export async function listUserSkills(storePath: string): Promise<UserSkill[]> {
  const skills = (await readUserSkillFile(storePath)).skills
  return withTokenEstimates(dirname(storePath), skills)
}

async function hasScriptsDir(folderPath: string): Promise<boolean> {
  try {
    return (await stat(join(folderPath, 'scripts'))).isDirectory()
  } catch {
    return false
  }
}

/**
 * 判断待挂 Skill 名是否与既有 Skill 撞名（#294）：
 * - 与任一官方 Skill 名撞 → 冲突（官方名来自 diagnostics.availableSkills，由 IPC 层注入）；
 * - 与该 Agent 已挂的任一用户 Skill 名撞 → 冲突（同一 Agent 下注入同名 skill 会在 SDK 加载时打架）。
 *
 * 名按规范化大小写不敏感比较（Claude Code skill 名规范为小写 kebab，但宽容比较防边角）。
 * 不同 Agent 之间不算冲突——用户 Skill 按 Agent 隔离注入，跨 Agent 同名互不可见。
 */
export function findSkillNameConflict(input: {
  name: string
  agentId: string
  officialSkillNames: string[]
  userSkills: UserSkill[]
}): boolean {
  const target = input.name.trim().toLowerCase()
  if (!target) return false
  if (input.officialSkillNames.some((skill) => skill.trim().toLowerCase() === target)) return true
  return input.userSkills.some(
    (skill) => skill.agentId === input.agentId && skill.name.trim().toLowerCase() === target,
  )
}

export interface ImportUserSkillInput {
  /** 作者选中的本地 Skill 文件夹绝对路径 */
  folderPath: string
  /** 绑定的 Agent id */
  agentId: string
  /** userData 根目录（store 与快照都落在此下） */
  userDataPath: string
  /** 官方 Skill 名集合（diagnostics.availableSkills）；撞名拒绝用，由 IPC 层注入。缺省视作无官方名。 */
  officialSkillNames?: string[]
}

/** 预检结果（#294）：在复制快照之前给渲染端的判定材料。 */
export interface UserSkillImportPreview {
  /** SKILL.md frontmatter name */
  name: string
  /** SKILL.md frontmatter description */
  description: string
  /** 是否含 scripts/ 目录（渲染端据此弹一次「含可执行脚本」确认） */
  hasScripts: boolean
  /** 是否与官方 / 该 Agent 已挂用户 Skill 撞名（true → 渲染端直接拒绝，不进入 commit） */
  conflict: boolean
}

/**
 * 导入前预检（#294）：校验文件夹 + 探测 scripts + 撞名判定，**不复制、不写记录**。
 * 渲染端据此：conflict → 直接拒绝；hasScripts → 弹确认，确认后才 commit；否则直接 commit。
 * 把撞名挡在复制之前，杜绝「先 cp 再回滚」。
 *
 * 不开放挂载的 Agent（memory-keeper）在此即抛，纵深防御越过 UI 的直接调用。
 * 校验失败抛 InvalidSkillFolderError（提示「不是有效的 Skill 文件夹」）。
 */
export async function previewUserSkillImport(input: ImportUserSkillInput): Promise<UserSkillImportPreview> {
  const { folderPath, agentId, userDataPath, officialSkillNames = [] } = input
  if (!agentId.trim()) throw new Error('缺少 Agent id。')
  if (MOUNT_DISABLED_AGENT_IDS.has(agentId)) throw new Error('该 Agent 不开放挂载。')

  const validated = await validateSkillFolder(folderPath)
  const hasScripts = await hasScriptsDir(folderPath)
  // 撞名判定只用 name，走内部 raw 读，免去富集 token 的多余快照读。
  const userSkills = (await readUserSkillFile(userSkillStorePath(userDataPath))).skills
  const conflict = findSkillNameConflict({ name: validated.name, agentId, officialSkillNames, userSkills })

  return { name: validated.name, description: validated.description, hasScripts, conflict }
}

/**
 * 导入一个本地文件夹为用户 Skill：
 * 1. 按 Claude Code skill 规范校验（validateSkillFolder：SKILL.md + name + description）；
 * 2. 生成稳定 id，递归复制整个文件夹为快照到 userData/user-skills/<id>/（含 references/scripts）；
 * 3. 追加一条挂载记录（绑定 agentId、全局）。
 *
 * 返回写后全量用户 Skill 列表。校验失败抛 InvalidSkillFolderError（提示「不是有效的 Skill 文件夹」）；
 * 同名冲突抛 SkillNameConflictError（提示「已存在同名 Skill」）。
 *
 * #294 安全/校验层：scripts 确认是渲染端交互（在 previewUserSkillImport 之后弹一次），本函数不弹；
 * 撞名拒绝在复制快照之前完成（信任边界纵深防御，即便绕过 preview 直接调用也挡得住），杜绝先 cp 再回滚。
 */
export async function importUserSkill(input: ImportUserSkillInput): Promise<UserSkill[]> {
  const { folderPath, agentId, userDataPath, officialSkillNames = [] } = input
  if (!agentId.trim()) throw new Error('缺少 Agent id。')
  if (MOUNT_DISABLED_AGENT_IDS.has(agentId)) throw new Error('该 Agent 不开放挂载。')

  const validated = await validateSkillFolder(folderPath)
  const hasScripts = await hasScriptsDir(folderPath)

  const storePath = userSkillStorePath(userDataPath)
  const file = await readUserSkillFile(storePath)
  // 撞名拒绝在复制之前：与官方名或该 Agent 已挂用户名撞 → 抛错，不留快照、不写记录。
  if (findSkillNameConflict({ name: validated.name, agentId, officialSkillNames, userSkills: file.skills })) {
    throw new SkillNameConflictError()
  }

  const id = randomUUID()
  const snapshotPath = userSkillSnapshotPath(userDataPath, id)
  // 递归复制整个文件夹为快照（含 references/scripts），与原文件夹脱钩。
  await mkdir(dirname(snapshotPath), { recursive: true })
  await cp(folderPath, snapshotPath, { recursive: true })

  const skill: UserSkill = {
    id,
    agentId,
    name: validated.name,
    description: validated.description,
    sourcePath: folderPath,
    hasScripts,
    mountedAt: new Date().toISOString(),
  }

  const skills = [...file.skills, skill]
  try {
    await writeUserSkillFile(storePath, skills)
  } catch (error) {
    // 写记录失败：回滚刚复制的快照，避免留下无记录引用的孤儿快照目录占盘
    await rm(snapshotPath, { recursive: true, force: true })
    throw error
  }
  return withTokenEstimates(userDataPath, skills)
}

/**
 * 卸载一条用户 Skill：移除挂载记录 + 删除快照目录。
 * 找不到 id 时静默（幂等）；快照删除用 force，缺目录不报错。返回写后全量列表。
 */
export async function uninstallUserSkill(input: { id: string; userDataPath: string }): Promise<UserSkill[]> {
  const { userDataPath } = input
  const id = input.id?.trim()
  if (!id) throw new Error('缺少用户 Skill id。')
  assertSafeSkillId(id)

  const storePath = userSkillStorePath(userDataPath)
  const file = await readUserSkillFile(storePath)
  const skills = file.skills.filter((skill) => skill.id !== id)
  await writeUserSkillFile(storePath, skills)

  // 删快照在写记录之后：即便删除失败，记录已无该 id，列表不会再展示残留快照。
  await rm(userSkillSnapshotPath(userDataPath, id), { recursive: true, force: true })
  return withTokenEstimates(userDataPath, skills)
}
