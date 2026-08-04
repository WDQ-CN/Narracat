// SkillMountStore：把用户的 Skill 挂载叠加持久化到 userData。
//
// 形状：{ mounts: AgentSkillMount[] }。一条记录 = 用户对某 (agentId, skillId) 的一次叠加决策
// （mounted / unmounted）。同一 (agentId, skillId) 至多保留一条（写入即 upsert）。
//
// 降级纪律（对齐 notifications.ts）：文件缺省 → 空叠加；损坏 JSON / 非法结构 → 空叠加不抛，
// 让挂载始终回退到「纯 Agent Core 默认」，绝不阻断 Agent 运行。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentSkillMount, SkillMountMode } from '@shared/types/skill-mount'

interface SkillMountFile {
  mounts: AgentSkillMount[]
}

const VALID_MODES: SkillMountMode[] = ['preload', 'on-demand']

// (agentId, skillId) 复合键的字段分隔符。显式可见的 '::'：agentId / skillId 均取自
// agent / skill 的 frontmatter `name`（不含 '::'），无歧义，且让本文件保持纯文本可正常 diff。
const MOUNT_KEY_SEPARATOR = '::'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeSkillMount(value: unknown): AgentSkillMount | null {
  if (!isRecord(value)) return null

  const agentId = readString(value, 'agentId')
  const skillId = readString(value, 'skillId')
  const mode = value.mode
  if (!agentId || !skillId || typeof mode !== 'string' || !VALID_MODES.includes(mode as SkillMountMode)) {
    return null
  }

  const state = value.state === 'unmounted' ? 'unmounted' : 'mounted'
  return { agentId, skillId, mode: mode as SkillMountMode, state }
}

function normalizeSkillMountFile(value: unknown): SkillMountFile {
  if (!isRecord(value) || !Array.isArray(value.mounts)) return { mounts: [] }
  return {
    mounts: value.mounts.flatMap((item) => {
      const normalized = normalizeSkillMount(item)
      return normalized ? [normalized] : []
    }),
  }
}

export function skillMountStorePath(userDataPath: string): string {
  return join(userDataPath, 'skill-mounts.json')
}

async function readSkillMountFile(storePath: string): Promise<SkillMountFile> {
  try {
    return normalizeSkillMountFile(JSON.parse(await readFile(storePath, 'utf-8')))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { mounts: [] }
    // 损坏 JSON / 读失败 → 降级为空叠加，绝不抛错阻断挂载读取
    return { mounts: [] }
  }
}

async function writeSkillMountFile(storePath: string, mounts: AgentSkillMount[]): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true })
  await writeFile(storePath, `${JSON.stringify({ mounts }, null, 2)}\n`, 'utf-8')
}

function mountKey(mount: Pick<AgentSkillMount, 'agentId' | 'skillId'>): string {
  return `${mount.agentId}${MOUNT_KEY_SEPARATOR}${mount.skillId}`
}

/** upsert：同一 (agentId, skillId) 覆盖，保持其余记录原顺序，新增追加到末尾 */
function upsertMount(mounts: AgentSkillMount[], next: AgentSkillMount): AgentSkillMount[] {
  const key = mountKey(next)
  let replaced = false
  const out = mounts.map((mount) => {
    if (mountKey(mount) === key) {
      replaced = true
      return next
    }
    return mount
  })
  if (!replaced) out.push(next)
  return out
}

export async function listSkillMounts(storePath: string): Promise<AgentSkillMount[]> {
  return (await readSkillMountFile(storePath)).mounts
}

/** 设置一条挂载叠加（mounted 或 unmounted），写后返回全量挂载列表 */
export async function setSkillMount(storePath: string, input: unknown): Promise<AgentSkillMount[]> {
  const mount = normalizeSkillMount(input)
  if (!mount) throw new Error('Skill 挂载参数非法。')

  const file = await readSkillMountFile(storePath)
  const mounts = upsertMount(file.mounts, mount)
  await writeSkillMountFile(storePath, mounts)
  return mounts
}

/** 移除某 (agentId, skillId) 的用户叠加记录（回归该 skill 的默认语义），写后返回全量列表 */
export async function removeSkillMount(storePath: string, input: unknown): Promise<AgentSkillMount[]> {
  if (!isRecord(input)) throw new Error('Skill 卸载参数非法。')
  const agentId = readString(input, 'agentId')
  const skillId = readString(input, 'skillId')
  if (!agentId || !skillId) throw new Error('Skill 卸载参数非法。')

  const file = await readSkillMountFile(storePath)
  const key = mountKey({ agentId, skillId })
  const mounts = file.mounts.filter((mount) => mountKey(mount) !== key)
  await writeSkillMountFile(storePath, mounts)
  return mounts
}

/** 一键恢复某 Agent 到默认挂载：清除该 Agent 全部用户叠加，写后返回全量列表 */
export async function resetAgentSkillMounts(storePath: string, input: unknown): Promise<AgentSkillMount[]> {
  if (!isRecord(input)) throw new Error('恢复默认参数非法。')
  const agentId = readString(input, 'agentId')
  if (!agentId) throw new Error('恢复默认参数非法。')

  const file = await readSkillMountFile(storePath)
  const mounts = file.mounts.filter((mount) => mount.agentId !== agentId)
  await writeSkillMountFile(storePath, mounts)
  return mounts
}
