import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  CharacterChatMessage,
  CharacterChatTranscript,
  CharacterChatUserMode,
} from '@shared/types/character-chat'

/**
 * Character chat transcript 本机持久化（ADR-0010/#202）。
 *
 * 边界铁律：
 * - transcript 是 App 层本机历史，**不**写入 Novel project 目录、NovelMemory、Agent run、
 *   Result/Push notification。落在 userData 边界的 character-chat-transcripts/ 目录。
 * - 归属键 = Novel project identity + Character UID + user mode（MVP 固定 author，结构留 reader）。
 * - 存储为「每会话一个文件」：文件名 = sha256(transcriptKey) 的 hex，内容是单个 transcript。
 *   不同会话各写各的文件，彻底消除「读整文件→改一键→写回」的并发覆盖（#288 走查 Finding 2）。
 * - 纯函数化（normalize）便于测试；I/O 薄封装在 read/write。
 */

const VALID_ROLES = new Set(['user', 'character'])
const VALID_STATUSES = new Set(['streaming', 'complete', 'failed'])
const VALID_MODES = new Set<CharacterChatUserMode>(['author', 'reader'])

/** 旧版单文件路径——仅供惰性迁移读取，不再写入。 */
export function characterChatTranscriptsPath(userDataPath: string): string {
  return join(userDataPath, 'character-chat-transcripts.json')
}

/** 每会话存档目录（每个会话一个 <hash>.json 文件）。 */
export function characterChatTranscriptsDir(userDataPath: string): string {
  return join(userDataPath, 'character-chat-transcripts')
}

/**
 * 复合归属键：projectPath + characterUid + userMode，用 NUL（U+0000）分隔。
 * 选 NUL 是因为它绝不会出现在路径/uid/模式里 → 零碰撞；但源码里必须写成转义 '\u0000'，
 * 不能写字面 NUL 字节（'\u0000'），否则 Git 会把整个文件判成 binary、diff/review 全失效（#288 Codex P2）。
 * 运行时仍是同一个 U+0000 字节，sha256 文件名不变，老存档不失效。
 */
export function transcriptKey(projectPath: string, characterUid: string, userMode: CharacterChatUserMode): string {
  return [projectPath, characterUid, userMode].join('\u0000')
}

/** 会话归属键 → 确定性、文件系统安全的 per-file 路径（sha256 hex + .json）。 */
function transcriptFilePath(transcriptsDir: string, key: string): string {
  const hash = createHash('sha256').update(key, 'utf-8').digest('hex')
  return join(transcriptsDir, `${hash}.json`)
}

interface LegacyTranscriptFile {
  transcripts: Record<string, CharacterChatTranscript>
}

function normalizeMessage(value: unknown): CharacterChatMessage | null {
  if (!value || typeof value !== 'object') return null
  const { id, role, text, status, createdAt } = value as Record<string, unknown>
  if (typeof id !== 'string' || !id) return null
  if (typeof role !== 'string' || !VALID_ROLES.has(role)) return null
  if (typeof text !== 'string') return null
  if (typeof status !== 'string' || !VALID_STATUSES.has(status)) return null
  // 失败气泡不入档：读到旧档残留的 failed 一律丢弃，避免回放出点不动的「重试」（#288 走查 Finding 3）。
  if (status === 'failed') return null
  // 持久化时把残留的 streaming 视为 complete（流已断，回放不再继续生长）。
  const persistedStatus = status === 'streaming' ? 'complete' : status
  return {
    id,
    role: role as CharacterChatMessage['role'],
    text,
    status: persistedStatus as CharacterChatMessage['status'],
    createdAt: typeof createdAt === 'string' ? createdAt : new Date().toISOString(),
  }
}

/**
 * 丢弃「没有得到 complete 回复」的孤儿 user 消息（失败回合留下的问句）。
 *
 * failed 角色气泡已先被 normalizeMessage 丢弃，失败回合于是只剩一条无应答的 user。留着它，
 * 下次 runner 读历史时会把这条悬空问句当真实上下文，按「相邻同角色合并」拼进新一轮 prompt，
 * 把失败的问题又偷带给模型（#288 Codex P1）。规则：仅保留其后紧跟 character 回复的 user，
 * 既清末尾孤儿，也清「失败回合夹在两次成功之间」被删掉 failed 后暴露出的中段孤儿。
 */
function dropUnansweredUserMessages(messages: CharacterChatMessage[]): CharacterChatMessage[] {
  return messages.filter((message, index) =>
    message.role !== 'user' ? true : messages[index + 1]?.role === 'character',
  )
}

/** 持久化用消息 normalize：丢非法/failed、折叠 streaming→complete，再清孤儿 user。读写两端共用。 */
export function normalizeMessages(value: unknown): CharacterChatMessage[] {
  const normalized = Array.isArray(value)
    ? value.map(normalizeMessage).filter((message): message is CharacterChatMessage => message !== null)
    : []
  return dropUnansweredUserMessages(normalized)
}

function normalizeTranscript(value: unknown): CharacterChatTranscript | null {
  if (!value || typeof value !== 'object') return null
  const { projectPath, characterUid, userMode, messages, updatedAt } = value as Record<string, unknown>
  if (typeof projectPath !== 'string' || !projectPath) return null
  if (typeof characterUid !== 'string' || !characterUid) return null
  const mode = typeof userMode === 'string' && VALID_MODES.has(userMode as CharacterChatUserMode)
    ? (userMode as CharacterChatUserMode)
    : 'author'
  const normalizedMessages = normalizeMessages(messages)
  return {
    projectPath,
    characterUid,
    userMode: mode,
    messages: normalizedMessages,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : new Date().toISOString(),
  }
}

/** 读取并 normalize 单个 per-file transcript；ENOENT 返回 null（交由迁移/兜底处理）。 */
async function readPerFileTranscript(filePath: string): Promise<CharacterChatTranscript | null> {
  try {
    return normalizeTranscript(JSON.parse(await readFile(filePath, 'utf-8')))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }
}

/** 写单个会话的 per-file transcript（先 mkdir 目录，再整段落盘）。 */
async function writePerFileTranscript(
  transcriptsDir: string,
  key: string,
  transcript: CharacterChatTranscript,
): Promise<void> {
  await mkdir(transcriptsDir, { recursive: true })
  await writeFile(transcriptFilePath(transcriptsDir, key), `${JSON.stringify(transcript, null, 2)}\n`, 'utf-8')
}

/**
 * 惰性迁移：从旧版单文件 character-chat-transcripts.json 取该 key 的 entry。
 * 旧文件不存在或无该 key 时返回 null；旧文件保留不删（安全）。
 */
async function readLegacyEntry(transcriptsDir: string, key: string): Promise<CharacterChatTranscript | null> {
  const legacyPath = characterChatTranscriptsPath(legacyUserDataPathFor(transcriptsDir))
  try {
    const raw = JSON.parse(await readFile(legacyPath, 'utf-8')) as LegacyTranscriptFile | null
    const entry = raw && typeof raw === 'object' ? raw.transcripts?.[key] : undefined
    return entry ? normalizeTranscript(entry) : null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }
}

/** transcripts 目录（<userData>/character-chat-transcripts）→ userData，定位旧单文件。 */
function legacyUserDataPathFor(transcriptsDir: string): string {
  return join(transcriptsDir, '..')
}

export interface TranscriptIdentity {
  projectPath: string
  characterUid: string
  userMode: CharacterChatUserMode
}

function emptyTranscript(identity: TranscriptIdentity): CharacterChatTranscript {
  return {
    projectPath: identity.projectPath,
    characterUid: identity.characterUid,
    userMode: identity.userMode,
    messages: [],
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 读取某一会话存档；不存在返回空 transcript（不报错）。
 *
 * 入参 transcriptsDir = characterChatTranscriptsDir(userData)。
 * 惰性迁移：per-file 不存在时回退读旧单文件该 key 的 entry，命中则写入 per-file 并返回
 * （无缝保留 dogfood 历史），旧单文件保留不删。
 */
export async function readCharacterChatTranscript(
  transcriptsDir: string,
  identity: TranscriptIdentity,
): Promise<CharacterChatTranscript> {
  const key = transcriptKey(identity.projectPath, identity.characterUid, identity.userMode)
  const existing = await readPerFileTranscript(transcriptFilePath(transcriptsDir, key))
  if (existing) return existing

  const legacy = await readLegacyEntry(transcriptsDir, key)
  if (legacy) {
    // 命中旧档：迁移到 per-file 后返回，下次直接走 per-file。
    await writePerFileTranscript(transcriptsDir, key, legacy)
    return legacy
  }

  return emptyTranscript(identity)
}

/**
 * 覆盖保存某一会话存档（renderer 持完整消息列表，main 整段落盘）。
 *
 * 入参 transcriptsDir = characterChatTranscriptsDir(userData)。
 * 只写该会话的 per-file（单个 transcript），不读改写共享文件 → 不同会话各写各的，无争用。
 * 只接受 user/character 终态消息（normalize 折叠 streaming→complete、丢弃 failed），不写入正史与记忆。
 */
export async function saveCharacterChatTranscript(
  transcriptsDir: string,
  input: { projectPath: string; characterUid: string; userMode: CharacterChatUserMode; messages: unknown },
  now = () => new Date().toISOString(),
): Promise<CharacterChatTranscript> {
  if (typeof input.projectPath !== 'string' || !input.projectPath) throw new Error('transcript 缺少项目路径。')
  if (typeof input.characterUid !== 'string' || !input.characterUid) throw new Error('transcript 缺少 character_uid。')
  const userMode = VALID_MODES.has(input.userMode) ? input.userMode : 'author'
  const messages = normalizeMessages(input.messages)

  const transcript: CharacterChatTranscript = {
    projectPath: input.projectPath,
    characterUid: input.characterUid,
    userMode,
    messages,
    updatedAt: now(),
  }

  const key = transcriptKey(input.projectPath, input.characterUid, userMode)
  await writePerFileTranscript(transcriptsDir, key, transcript)
  return transcript
}
