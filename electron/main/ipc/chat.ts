import { app, ipcMain } from 'electron'
import { getApiKey } from '../secrets.ts'
import {
  createCharacterChatRunManager,
  normalizeCharacterChatSendRequest,
  type CharacterChatRunManager,
} from '../chat/character-chat-runner.ts'
import { openMemoryDbReadonly } from '../novel/memory-db.ts'
import {
  characterChatTranscriptsDir,
  readCharacterChatTranscript,
  saveCharacterChatTranscript,
} from '../novel/character-chat-transcripts.ts'
import type { CharacterChatUserMode } from '@shared/types/character-chat'
import {
  characterChatProfilesDir,
  readCharacterChatProfiles,
  writeAuthorProfile,
  writeImpression,
  readImpressionMeta,
  readAuthorProfile,
} from '../novel/character-chat-profiles.ts'
import { createCharacterChatProfiler, PROFILE_REFINE_MIN_NEW_MESSAGES } from '../chat/character-chat-profiler.ts'
import { normalizeSaveProfileInput } from './character-chat-profiles.ts'
import { readCurrentConfig, userDataPath } from './inputs.ts'

const characterChatRunManagers = new WeakMap<Electron.WebContents, CharacterChatRunManager>()

/** 每会话存档目录（每个会话一个 per-file，无并发覆盖）；read/save/runner 注入共用。 */
function transcriptsDir(): string {
  return characterChatTranscriptsDir(app.getPath('userData'))
}

/** 用户画像存储目录；read/save/flush handler 与 profiler 单例共用。 */
function profilesDir(): string {
  return characterChatProfilesDir(app.getPath('userData'))
}

/** 懒初始化：app.getPath 要等 Electron app 就绪后才可调用，推迟到首次使用。 */
let _characterChatProfiler: ReturnType<typeof createCharacterChatProfiler> | null = null
function getCharacterChatProfiler(): ReturnType<typeof createCharacterChatProfiler> {
  if (!_characterChatProfiler) {
    _characterChatProfiler = createCharacterChatProfiler({
      readConfig: readCurrentConfig,
      getApiKey,
      readTranscript: (identity) => readCharacterChatTranscript(transcriptsDir(), identity),
      readImpressionMeta,
      writeAuthorProfile,
      writeImpression,
      readAuthorProfile,
      profilesDir: profilesDir(),
    })
  }
  return _characterChatProfiler
}

function readCharacterChatTranscriptInput(input: unknown): {
  projectPath: string
  characterUid: string
  userMode: CharacterChatUserMode
} {
  if (!input || typeof input !== 'object') throw new Error('角色聊天存档参数非法。')
  const { projectPath, characterUid, userMode } = input as Record<string, unknown>
  if (typeof projectPath !== 'string' || !projectPath.trim()) throw new Error('缺少项目路径。')
  if (typeof characterUid !== 'string' || !characterUid.trim()) throw new Error('缺少 character_uid。')
  const mode = userMode === 'reader' ? 'reader' : 'author'
  return { projectPath, characterUid: characterUid.trim(), userMode: mode }
}

function characterChatRunManagerForSender(sender: Electron.WebContents): CharacterChatRunManager {
  const existing = characterChatRunManagers.get(sender)
  if (existing) return existing

  const manager = createCharacterChatRunManager({
    readConfig: readCurrentConfig,
    getApiKey,
    sendEvent: (event) => sender.send('character-chat:event', event),
    appRoot: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    userDataPath: userDataPath(),
    openMemoryDb: openMemoryDbReadonly,
    // 多轮历史单源：runner 读 App transcript（character-chat-transcripts.ts），renderer 不传历史。
    readTranscript: (identity) => readCharacterChatTranscript(transcriptsDir(), identity),
    readProfiles: (identity) => readCharacterChatProfiles(profilesDir(), identity),
    onConversationSettled: (input) =>
      void getCharacterChatProfiler().maybeRefine({ ...input, minNewMessages: PROFILE_REFINE_MIN_NEW_MESSAGES }),
  })
  characterChatRunManagers.set(sender, manager)
  return manager
}

export function registerChatIpcHandlers(): void {
  ipcMain.handle('character-chat:send', async (event, input: unknown): Promise<{ runId: string }> => {
    return characterChatRunManagerForSender(event.sender).send(normalizeCharacterChatSendRequest(input))
  })

  ipcMain.handle('character-chat:cancel', (event, runId: unknown): { cancelled: boolean } => {
    if (typeof runId !== 'string' || !runId.trim()) throw new Error('角色聊天 runId 参数非法。')
    return characterChatRunManagerForSender(event.sender).cancel(runId)
  })

  ipcMain.handle('character-chat:read-transcript', async (_event, input: unknown) => {
    return readCharacterChatTranscript(transcriptsDir(), readCharacterChatTranscriptInput(input))
  })

  ipcMain.handle('character-chat:save-transcript', async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('角色聊天存档参数非法。')
    const { projectPath, characterUid, userMode } = readCharacterChatTranscriptInput(input)
    const { messages } = input as { messages?: unknown }
    return saveCharacterChatTranscript(transcriptsDir(), { projectPath, characterUid, userMode, messages })
  })

  ipcMain.handle('character-chat:read-profiles', async (_event, input: unknown) => {
    const { projectPath, characterUid } = readCharacterChatTranscriptInput(input)
    return readCharacterChatProfiles(profilesDir(), { projectPath, characterUid })
  })

  ipcMain.handle('character-chat:save-profile', async (_event, input: unknown) => {
    const { scope, content, projectPath, characterUid } = normalizeSaveProfileInput(input)
    if (scope === 'author') {
      await writeAuthorProfile(profilesDir(), content)
    } else {
      const meta = await readImpressionMeta(profilesDir(), { projectPath, characterUid })
      await writeImpression(profilesDir(), { projectPath, characterUid, body: content, lastProcessedMessageId: meta.lastProcessedMessageId })
    }
  })

  ipcMain.handle('character-chat:flush-profile', async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('flush 参数非法。')
    const { projectPath, characterUid, characterName } = input as Record<string, unknown>
    if (typeof projectPath !== 'string' || !projectPath.trim()) return
    if (typeof characterUid !== 'string' || !characterUid.trim()) return
    // flush 兜底：有新对话就提炼（minNewMessages=1），不卡常规消息阈值。
    void getCharacterChatProfiler().maybeRefine({
      projectPath,
      characterUid: characterUid.trim(),
      characterName: typeof characterName === 'string' ? characterName : '这个角色',
      minNewMessages: 1,
    })
  })
}
