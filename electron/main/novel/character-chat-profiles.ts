import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { CharacterChatProfiles } from '@shared/types/character-chat'

/**
 * 角色聊天用户画像本机持久化（ADR-0010）。
 *
 * 边界铁律：只落 userData/character-chat-profiles/，绝不写入 Novel project / NovelMemory。
 * - 全局作者画像：单文件 author-profile.md（跨项目跨角色共享，"你是谁"）。
 * - 每角色印象：impressions/<sha256(projectPath + NUL + characterUid)>.md（"它眼里的你"）。
 * - markdown 正文 + 极简 frontmatter（key: value 行）记账（updatedAt / lastProcessedMessageId）。
 *   自己解析极简 frontmatter，不引 yaml 依赖。
 */

export const AUTHOR_PROFILE_MAX_CHARS = 1500
export const IMPRESSION_MAX_CHARS = 1000

export function characterChatProfilesDir(userDataPath: string): string {
  return join(userDataPath, 'character-chat-profiles')
}

interface ProfileIdentity {
  projectPath: string
  characterUid: string
}

function authorProfilePath(profilesDir: string): string {
  return join(profilesDir, 'author-profile.md')
}

/** NUL（U+0000）分隔 → 零碰撞。本环境编辑工具会把转义序列误写成字面 NUL 字节，故用 String.fromCharCode(0) 在运行时生成 U+0000，等价且源码安全。 */
function impressionFilePath(profilesDir: string, identity: ProfileIdentity): string {
  const key = [identity.projectPath, identity.characterUid].join(String.fromCharCode(0))
  const hash = createHash('sha256').update(key, 'utf-8').digest('hex')
  return join(profilesDir, 'impressions', `${hash}.md`)
}

/** 解析极简 frontmatter（--- 包裹的 key: value 行），返回 meta 与正文 body。 */
function parseProfileDoc(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith('---\n')) return { meta: {}, body: raw.trim() }
  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) return { meta: {}, body: raw.trim() }
  const metaBlock = raw.slice(4, end)
  const body = raw.slice(end + 5)
  const meta: Record<string, string> = {}
  for (const line of metaBlock.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return { meta, body: body.trim() }
}

function serializeProfileDoc(meta: Record<string, string>, body: string): string {
  const metaLines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`)
  return `---\n${metaLines.join('\n')}\n---\n\n${body.trim()}\n`
}

function clampBody(body: string, max: number): string {
  const trimmed = body.trim()
  if (trimmed.length <= max) return trimmed
  const chars = [...trimmed]
  return chars.length <= max ? trimmed : chars.slice(0, max).join('')
}

async function readDoc(filePath: string): Promise<{ meta: Record<string, string>; body: string } | null> {
  try {
    return parseProfileDoc(await readFile(filePath, 'utf-8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function readCharacterChatProfiles(
  profilesDir: string,
  identity: ProfileIdentity,
): Promise<CharacterChatProfiles> {
  const author = await readDoc(authorProfilePath(profilesDir))
  const impression = await readDoc(impressionFilePath(profilesDir, identity))
  return {
    authorProfile: author?.body ?? '',
    impression: impression?.body ?? '',
  }
}

export async function readImpressionMeta(
  profilesDir: string,
  identity: ProfileIdentity,
): Promise<{ body: string; lastProcessedMessageId: string | null }> {
  const doc = await readDoc(impressionFilePath(profilesDir, identity))
  return {
    body: doc?.body ?? '',
    lastProcessedMessageId: doc?.meta.lastProcessedMessageId || null,
  }
}

/** 读全局作者画像（含 updatedAt，供后台提炼做 compare-and-skip 基准）。 */
export async function readAuthorProfile(profilesDir: string): Promise<{ body: string; updatedAt: string | null }> {
  const doc = await readDoc(authorProfilePath(profilesDir))
  return { body: doc?.body ?? '', updatedAt: doc?.meta.updatedAt || null }
}

// 全局作者画像写串行链：author-profile.md 跨角色/跨会话共享，多角色后台提炼 + 手动保存可能并发，
// 串行化所有写 + 配合 CAS 防 lost-update（后写用陈旧内容覆盖前写）。
let authorWriteChain: Promise<unknown> = Promise.resolve()

/**
 * 写全局作者画像。串行执行；传 expectedUpdatedAt（后台提炼）则做 compare-and-skip：
 * 写前重读，若 updatedAt 已变（被其他写者更新）则放弃本次（返回 false），避免用陈旧内容覆盖。
 * 不传 expectedUpdatedAt（手动保存）= 强制写（用户编辑优先）。返回是否真正写入。
 */
export function writeAuthorProfile(
  profilesDir: string,
  body: string,
  opts: { expectedUpdatedAt?: string | null; now?: () => string } = {},
): Promise<boolean> {
  const run = authorWriteChain.then(async () => {
    const filePath = authorProfilePath(profilesDir)
    if (opts.expectedUpdatedAt !== undefined) {
      const current = await readDoc(filePath)
      if ((current?.meta.updatedAt || null) !== opts.expectedUpdatedAt) return false
    }
    await mkdir(dirname(filePath), { recursive: true })
    const now = opts.now ?? (() => new Date().toISOString())
    await writeFile(filePath, serializeProfileDoc({ updatedAt: now() }, clampBody(body, AUTHOR_PROFILE_MAX_CHARS)), 'utf-8')
    return true
  })
  authorWriteChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export async function writeImpression(
  profilesDir: string,
  input: ProfileIdentity & { body: string; lastProcessedMessageId: string | null },
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  const filePath = impressionFilePath(profilesDir, input)
  await mkdir(dirname(filePath), { recursive: true })
  const meta: Record<string, string> = { updatedAt: now() }
  if (input.lastProcessedMessageId) meta.lastProcessedMessageId = input.lastProcessedMessageId
  await writeFile(filePath, serializeProfileDoc(meta, clampBody(input.body, IMPRESSION_MAX_CHARS)), 'utf-8')
}
