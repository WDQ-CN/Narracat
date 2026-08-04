import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AUTHOR_PROFILE_MAX_CHARS,
  characterChatProfilesDir,
  readAuthorProfile,
  readCharacterChatProfiles,
  readImpressionMeta,
  writeAuthorProfile,
  writeImpression,
} from './character-chat-profiles.ts'

let dir: string
beforeEach(async () => {
  dir = characterChatProfilesDir(await mkdtemp(join(tmpdir(), 'ncprof-')))
})
afterEach(async () => {
  await rm(join(dir, '..'), { recursive: true, force: true })
})

const id = { projectPath: '/p/book', characterUid: 'char_1' }

describe('character-chat-profiles', () => {
  it('未写入时读到空画像', async () => {
    expect(await readCharacterChatProfiles(dir, id)).toEqual({ authorProfile: '', impression: '' })
  })

  it('作者画像 + 角色印象往返；印象带增量游标', async () => {
    await writeAuthorProfile(dir, '- 爱追问细节')
    await writeImpression(dir, { ...id, body: '- 站阿九那边', lastProcessedMessageId: 'ccm-9' })

    expect(await readCharacterChatProfiles(dir, id)).toEqual({
      authorProfile: '- 爱追问细节',
      impression: '- 站阿九那边',
    })
    expect((await readImpressionMeta(dir, id)).lastProcessedMessageId).toBe('ccm-9')
  })

  it('作者画像全局共享：换 characterUid 仍读到同一份作者画像，但印象各自独立', async () => {
    await writeAuthorProfile(dir, '- 偏爱暗黑快节奏')
    await writeImpression(dir, { ...id, body: '甲印象', lastProcessedMessageId: 'a' })
    const other = { projectPath: '/p/book', characterUid: 'char_2' }
    const read = await readCharacterChatProfiles(dir, other)
    expect(read.authorProfile).toBe('- 偏爱暗黑快节奏')
    expect(read.impression).toBe('')
  })

  it('超长正文写入前硬截断', async () => {
    await writeAuthorProfile(dir, 'x'.repeat(AUTHOR_PROFILE_MAX_CHARS + 500))
    const read = await readCharacterChatProfiles(dir, id)
    expect(read.authorProfile.length).toBeLessThanOrEqual(AUTHOR_PROFILE_MAX_CHARS)
  })

  it('frontmatter 不混进正文 body', async () => {
    await writeImpression(dir, { ...id, body: '正文一行', lastProcessedMessageId: 'ccm-1' })
    expect((await readCharacterChatProfiles(dir, id)).impression).toBe('正文一行')
  })
})

describe('writeAuthorProfile 全局画像并发保护（CAS 防 lost-update）', () => {
  it('不传 expectedUpdatedAt = 强制写（手动保存优先），返回 true', async () => {
    expect(await writeAuthorProfile(dir, 'v1')).toBe(true)
    expect((await readAuthorProfile(dir)).body).toBe('v1')
  })

  it('expectedUpdatedAt 与当前一致 → 正常写入', async () => {
    await writeAuthorProfile(dir, 'v1')
    const { updatedAt } = await readAuthorProfile(dir)
    expect(await writeAuthorProfile(dir, 'v2', { expectedUpdatedAt: updatedAt })).toBe(true)
    expect((await readAuthorProfile(dir)).body).toBe('v2')
  })

  it('expectedUpdatedAt 陈旧（被其他写者抢先）→ 跳过不覆盖，返回 false', async () => {
    const stale = '2026-01-01T00:00:00.000Z'
    await writeAuthorProfile(dir, 'v1', { now: () => stale })
    // 另一写者更新了文件（updatedAt 变成 t2）
    await writeAuthorProfile(dir, 'v2', { now: () => '2026-02-02T00:00:00.000Z' })
    // 基于陈旧 stale 的后台提炼写应跳过，不能覆盖 v2
    expect(await writeAuthorProfile(dir, 'v3-stale', { expectedUpdatedAt: stale })).toBe(false)
    expect((await readAuthorProfile(dir)).body).toBe('v2')
  })
})
