import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addAuthorRequest,
  authorRequestStorePath,
  listAuthorRequests,
  removeAuthorRequest,
  updateAuthorRequest,
} from './author-request-store.ts'

let dir = ''
let storePath = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'author-request-'))
  storePath = authorRequestStorePath(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('listAuthorRequests（读一律 fail-soft）', () => {
  test('文件不存在 → 空列表，不抛', async () => {
    expect(await listAuthorRequests(storePath)).toEqual([])
  })

  test('JSON 损坏 → 空列表，不抛', async () => {
    await writeFile(storePath, '{ 这不是 json', 'utf-8')
    expect(await listAuthorRequests(storePath)).toEqual([])
  })

  test('形状非法的条目被逐条丢弃，合法的保留', async () => {
    await writeFile(
      storePath,
      JSON.stringify({
        version: 1,
        requests: [
          { id: 'a', agentId: 'chapter-writer', text: '少写环境描写', createdAt: '2026-08-07T00:00:00.000Z' },
          { id: 'b' },
          null,
        ],
      }),
      'utf-8',
    )
    const requests = await listAuthorRequests(storePath)
    expect(requests).toHaveLength(1)
    expect(requests[0].id).toBe('a')
  })
})

describe('addAuthorRequest（写 fail-loud）', () => {
  test('新增一条并返回全量列表', async () => {
    const requests = await addAuthorRequest({
      storePath,
      agentId: 'chapter-writer',
      text: '少写环境描写，多写对话',
      now: '2026-08-07T00:00:00.000Z',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0].agentId).toBe('chapter-writer')
    expect(requests[0].text).toBe('少写环境描写，多写对话')
    expect(requests[0].createdAt).toBe('2026-08-07T00:00:00.000Z')
    expect(requests[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('空白正文被拒绝', async () => {
    await expect(
      addAuthorRequest({ storePath, agentId: 'chapter-writer', text: '   ', now: 'x' }),
    ).rejects.toThrow()
  })

  test('并发新增两条都在，后写的不覆盖先写的', async () => {
    await Promise.all([
      addAuthorRequest({ storePath, agentId: 'chapter-writer', text: '第一条', now: 'x' }),
      addAuthorRequest({ storePath, agentId: 'chapter-writer', text: '第二条', now: 'y' }),
    ])
    const texts = (await listAuthorRequests(storePath)).map((item) => item.text).sort()
    expect(texts).toEqual(['第一条', '第二条'])
  })
})

describe('updateAuthorRequest / removeAuthorRequest', () => {
  test('改写正文', async () => {
    const [created] = await addAuthorRequest({ storePath, agentId: 'chapter-writer', text: '旧', now: 'x' })
    const requests = await updateAuthorRequest({ storePath, id: created.id, text: '新' })
    expect(requests[0].text).toBe('新')
  })

  test('改不存在的 id 抛错（作者按了保存，静默失败最坏）', async () => {
    await expect(updateAuthorRequest({ storePath, id: 'nope', text: '新' })).rejects.toThrow()
  })

  test('删除一条', async () => {
    const [created] = await addAuthorRequest({ storePath, agentId: 'chapter-writer', text: '要删的', now: 'x' })
    expect(await removeAuthorRequest({ storePath, id: created.id })).toEqual([])
  })

  test('删不存在的 id 幂等不抛', async () => {
    await expect(removeAuthorRequest({ storePath, id: 'nope' })).resolves.toEqual([])
  })
})
