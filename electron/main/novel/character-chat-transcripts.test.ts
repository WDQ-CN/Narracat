import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'

import {
  characterChatTranscriptsDir,
  characterChatTranscriptsPath,
  normalizeMessages,
  readCharacterChatTranscript,
  saveCharacterChatTranscript,
  transcriptKey,
} from './character-chat-transcripts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/** 建一个临时 userData 根，返回 { userData, dir }（dir = 每会话存档目录）。 */
async function tempUserData(): Promise<{ userData: string; dir: string }> {
  const userData = await mkdtemp(join(tmpdir(), 'narracat-transcripts-'))
  tempRoots.push(userData)
  return { userData, dir: characterChatTranscriptsDir(userData) }
}

/** 某会话归属键对应的 per-file 文件名（sha256 hex + .json）。 */
function perFileName(projectPath: string, characterUid: string, userMode: 'author' | 'reader'): string {
  const key = transcriptKey(projectPath, characterUid, userMode)
  return `${createHash('sha256').update(key, 'utf-8').digest('hex')}.json`
}

const sampleMessages = [
  { id: 'm1', role: 'user', text: '在吗', status: 'complete', createdAt: 't1' },
  { id: 'm2', role: 'character', text: '在的', status: 'complete', createdAt: 't2' },
]

describe('transcriptKey', () => {
  test('归属键含 project + uid + userMode', () => {
    const key = transcriptKey('/novels/p1', 'uid-a', 'author')
    expect(key).toContain('/novels/p1')
    expect(key).toContain('uid-a')
    expect(key).toContain('author')
    expect(key).not.toBe(transcriptKey('/novels/p1', 'uid-a', 'reader'))
  })
})

describe('save/read transcript（每会话一个文件）', () => {
  test('保存后能按 project + uid + userMode 恢复', async () => {
    const { dir } = await tempUserData()
    await saveCharacterChatTranscript(dir, {
      projectPath: '/novels/p1',
      characterUid: 'uid-a',
      userMode: 'author',
      messages: sampleMessages,
    })

    const restored = await readCharacterChatTranscript(dir, {
      projectPath: '/novels/p1',
      characterUid: 'uid-a',
      userMode: 'author',
    })
    expect(restored.messages.map((m) => m.text)).toEqual(['在吗', '在的'])
    expect(restored.userMode).toBe('author')
  })

  test('不存在的会话返回空 transcript（不报错）', async () => {
    const { dir } = await tempUserData()
    const restored = await readCharacterChatTranscript(dir, {
      projectPath: '/novels/p1',
      characterUid: 'uid-x',
      userMode: 'author',
    })
    expect(restored.messages).toEqual([])
  })

  test('每会话写入独立文件，文件名 = sha256(key).json', async () => {
    const { dir } = await tempUserData()
    await saveCharacterChatTranscript(dir, {
      projectPath: '/novels/p1',
      characterUid: 'uid-a',
      userMode: 'author',
      messages: sampleMessages,
    })
    const files = await readdir(dir)
    expect(files).toEqual([perFileName('/novels/p1', 'uid-a', 'author')])
  })

  test('不同 project / uid / userMode 各写各的文件，互不覆盖', async () => {
    const { dir } = await tempUserData()
    await saveCharacterChatTranscript(dir, {
      projectPath: '/novels/p1',
      characterUid: 'uid-a',
      userMode: 'author',
      messages: [
        { id: 'a', role: 'user', text: 'A 项目消息', status: 'complete', createdAt: 't' },
        { id: 'a2', role: 'character', text: 'A 回复', status: 'complete', createdAt: 't' },
      ],
    })
    await saveCharacterChatTranscript(dir, {
      projectPath: '/novels/p2',
      characterUid: 'uid-a',
      userMode: 'author',
      messages: [
        { id: 'b', role: 'user', text: 'B 项目消息', status: 'complete', createdAt: 't' },
        { id: 'b2', role: 'character', text: 'B 回复', status: 'complete', createdAt: 't' },
      ],
    })

    const files = (await readdir(dir)).sort()
    expect(files).toHaveLength(2)

    const p1 = await readCharacterChatTranscript(dir, { projectPath: '/novels/p1', characterUid: 'uid-a', userMode: 'author' })
    const p2 = await readCharacterChatTranscript(dir, { projectPath: '/novels/p2', characterUid: 'uid-a', userMode: 'author' })
    expect(p1.messages[0].text).toBe('A 项目消息')
    expect(p2.messages[0].text).toBe('B 项目消息')
  })

  test('两个不同会话「同时」保存互不丢档（并发多角色）', async () => {
    const { dir } = await tempUserData()
    // 并发保存两个会话——旧的单文件读改写在此处会互相覆盖，每会话独立文件则不会。
    await Promise.all([
      saveCharacterChatTranscript(dir, {
        projectPath: '/novels/p1',
        characterUid: 'uid-a',
        userMode: 'author',
        messages: [
          { id: 'a', role: 'user', text: '角色 A', status: 'complete', createdAt: 't' },
          { id: 'a2', role: 'character', text: '收到 A', status: 'complete', createdAt: 't' },
        ],
      }),
      saveCharacterChatTranscript(dir, {
        projectPath: '/novels/p1',
        characterUid: 'uid-b',
        userMode: 'author',
        messages: [
          { id: 'b', role: 'user', text: '角色 B', status: 'complete', createdAt: 't' },
          { id: 'b2', role: 'character', text: '收到 B', status: 'complete', createdAt: 't' },
        ],
      }),
    ])

    const a = await readCharacterChatTranscript(dir, { projectPath: '/novels/p1', characterUid: 'uid-a', userMode: 'author' })
    const b = await readCharacterChatTranscript(dir, { projectPath: '/novels/p1', characterUid: 'uid-b', userMode: 'author' })
    expect(a.messages[0].text).toBe('角色 A')
    expect(b.messages[0].text).toBe('角色 B')
  })

  test('残留 streaming 状态在持久化层折成 complete', async () => {
    const { dir } = await tempUserData()
    await saveCharacterChatTranscript(dir, {
      projectPath: '/novels/p1',
      characterUid: 'uid-a',
      userMode: 'author',
      messages: [{ id: 'm', role: 'character', text: '半句', status: 'streaming', createdAt: 't' }],
    })
    const restored = await readCharacterChatTranscript(dir, { projectPath: '/novels/p1', characterUid: 'uid-a', userMode: 'author' })
    expect(restored.messages[0].status).toBe('complete')
  })

  test('失败回合整体不入档（failed 气泡 + 无应答的孤儿 user 问句一起清）', async () => {
    const { dir } = await tempUserData()
    await saveCharacterChatTranscript(dir, {
      projectPath: '/novels/p1',
      characterUid: 'uid-a',
      userMode: 'author',
      messages: [
        { id: 'u', role: 'user', text: '在吗', status: 'complete', createdAt: 't' },
        { id: 'f', role: 'character', text: '网络错误', status: 'failed', createdAt: 't' },
      ],
    })
    const restored = await readCharacterChatTranscript(dir, { projectPath: '/novels/p1', characterUid: 'uid-a', userMode: 'author' })
    // 孤儿 user 留着会在下次被拼进新 prompt 污染上下文（#288 Codex P1），故失败回合整体不留痕。
    expect(restored.messages).toEqual([])
  })

  test('成对的多轮全部保留（不误删合法 user）', async () => {
    const { dir } = await tempUserData()
    await saveCharacterChatTranscript(dir, {
      projectPath: '/novels/p1',
      characterUid: 'uid-a',
      userMode: 'author',
      messages: [
        { id: 'u1', role: 'user', text: '问一', status: 'complete', createdAt: 't1' },
        { id: 'c1', role: 'character', text: '答一', status: 'complete', createdAt: 't2' },
        { id: 'u2', role: 'user', text: '问二', status: 'complete', createdAt: 't3' },
        { id: 'c2', role: 'character', text: '答二', status: 'complete', createdAt: 't4' },
      ],
    })
    const restored = await readCharacterChatTranscript(dir, { projectPath: '/novels/p1', characterUid: 'uid-a', userMode: 'author' })
    expect(restored.messages.map((m) => m.id)).toEqual(['u1', 'c1', 'u2', 'c2'])
  })

  test('失败回合夹在两次成功之间：中段孤儿 user 被清，不与后续 user 连缀（#288 Codex P1）', async () => {
    const { dir } = await tempUserData()
    await saveCharacterChatTranscript(dir, {
      projectPath: '/novels/p1',
      characterUid: 'uid-a',
      userMode: 'author',
      messages: [
        { id: 'u1', role: 'user', text: '第一次问', status: 'complete', createdAt: 't1' },
        { id: 'f1', role: 'character', text: '失败了', status: 'failed', createdAt: 't2' },
        { id: 'u2', role: 'user', text: '换个问法', status: 'complete', createdAt: 't3' },
        { id: 'c2', role: 'character', text: '这次答上了', status: 'complete', createdAt: 't4' },
      ],
    })
    const restored = await readCharacterChatTranscript(dir, { projectPath: '/novels/p1', characterUid: 'uid-a', userMode: 'author' })
    // u1 无应答 → 清掉；只留成对的 u2/c2，避免 u1 与 u2 在 runner 里被合并成一轮把失败问句偷带给模型。
    expect(restored.messages.map((m) => m.id)).toEqual(['u2', 'c2'])
  })

  test('读时丢弃旧档里残留的 failed 及其孤儿 user（防御性，不回放也不污染）', async () => {
    const { userData, dir } = await tempUserData()
    // 直接写一个含 failed 的 per-file（模拟历史残留），读时应被 normalizeMessage 丢弃。
    await mkdir(dir, { recursive: true })
    const key = transcriptKey('/novels/p1', 'uid-a', 'author')
    const fileName = `${createHash('sha256').update(key, 'utf-8').digest('hex')}.json`
    await writeFile(
      join(dir, fileName),
      JSON.stringify({
        projectPath: '/novels/p1',
        characterUid: 'uid-a',
        userMode: 'author',
        updatedAt: 't',
        messages: [
          { id: 'u', role: 'user', text: '在吗', status: 'complete', createdAt: 't' },
          { id: 'f', role: 'character', text: '失败残留', status: 'failed', createdAt: 't' },
        ],
      }),
      'utf-8',
    )
    void userData
    const restored = await readCharacterChatTranscript(dir, { projectPath: '/novels/p1', characterUid: 'uid-a', userMode: 'author' })
    // failed 残留被丢，剩下的孤儿 user 也无应答 → 一并清掉。
    expect(restored.messages).toEqual([])
  })

  test('存档写在 App 数据边界目录（character-chat-transcripts/），不污染 novel 项目目录', async () => {
    const { userData, dir } = await tempUserData()
    expect(dir.endsWith('character-chat-transcripts')).toBe(true)
    await saveCharacterChatTranscript(dir, {
      projectPath: '/novels/p1',
      characterUid: 'uid-a',
      userMode: 'author',
      messages: sampleMessages,
    })
    const filePath = join(dir, perFileName('/novels/p1', 'uid-a', 'author'))
    const raw = await readFile(filePath, 'utf-8')
    // per-file 落盘结构是单个 transcript（含 projectPath/messages），不再有 transcripts 容器。
    expect(raw).toContain('"projectPath"')
    expect(raw).not.toContain('"transcripts"')
    void userData
  })
})

describe('惰性迁移（旧单文件 → per-file）', () => {
  test('per-file 不存在时从旧单文件回灌该 key 的 entry，并写入 per-file', async () => {
    const { userData, dir } = await tempUserData()
    // 写一个旧版单文件（{ transcripts: { [key]: transcript } }）。
    const key = transcriptKey('/novels/p1', 'uid-a', 'author')
    await writeFile(
      characterChatTranscriptsPath(userData),
      JSON.stringify({
        transcripts: {
          [key]: {
            projectPath: '/novels/p1',
            characterUid: 'uid-a',
            userMode: 'author',
            updatedAt: 't',
            messages: [
              { id: 'old', role: 'user', text: '旧 dogfood 消息', status: 'complete', createdAt: 't' },
              { id: 'old2', role: 'character', text: '旧 dogfood 回复', status: 'complete', createdAt: 't' },
            ],
          },
        },
      }),
      'utf-8',
    )

    const restored = await readCharacterChatTranscript(dir, { projectPath: '/novels/p1', characterUid: 'uid-a', userMode: 'author' })
    expect(restored.messages[0].text).toBe('旧 dogfood 消息')

    // 迁移落地：per-file 已写入，旧单文件保留不删（安全）。
    const files = await readdir(dir)
    expect(files).toEqual([perFileName('/novels/p1', 'uid-a', 'author')])
    const legacyStillThere = await readFile(characterChatTranscriptsPath(userData), 'utf-8')
    expect(legacyStillThere).toContain('旧 dogfood 消息')
  })

  test('旧单文件不存在且 per-file 也无 → 返回空 transcript', async () => {
    const { dir } = await tempUserData()
    const restored = await readCharacterChatTranscript(dir, { projectPath: '/novels/p9', characterUid: 'uid-z', userMode: 'author' })
    expect(restored.messages).toEqual([])
  })
})

describe('normalizeMessages（多气泡回放）', () => {
  test('多气泡回合：user + 多条 character 全部保留，顺序不变', () => {
    const messages = normalizeMessages([
      { id: 'u1', role: 'user', text: '你什么感觉', status: 'complete', createdAt: 't' },
      { id: 'c1', role: 'character', text: '说不好。', status: 'complete', createdAt: 't' },
      { id: 'c2', role: 'character', text: '第一反应是气。', status: 'complete', createdAt: 't' },
      { id: 'c3', role: 'character', text: '后来才懂。', status: 'complete', createdAt: 't' },
    ])
    expect(messages.map((m) => `${m.role}:${m.text}`)).toEqual([
      'user:你什么感觉',
      'character:说不好。',
      'character:第一反应是气。',
      'character:后来才懂。',
    ])
  })
})
