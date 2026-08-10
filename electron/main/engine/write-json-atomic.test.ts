import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withJsonFileLock, writeJsonFileAtomic } from './write-json-atomic'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'write-json-atomic-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeJsonFileAtomic', () => {
  test('正常写入可读回', async () => {
    const storePath = join(dir, 'store.json')
    await writeJsonFileAtomic(storePath, { hello: 'world' })
    expect(JSON.parse(await readFile(storePath, 'utf-8'))).toEqual({ hello: 'world' })
  })

  test('落盘格式为两空格缩进 JSON + 末尾换行，与既有三处存储保持一致', async () => {
    const storePath = join(dir, 'store.json')
    await writeJsonFileAtomic(storePath, { a: 1 })
    expect(await readFile(storePath, 'utf-8')).toBe(`${JSON.stringify({ a: 1 }, null, 2)}\n`)
  })

  test('并发多次写入同一路径，最终内容是最后一次且没有条目丢失', async () => {
    const storePath = join(dir, 'concurrent.json')
    await Promise.all([
      writeJsonFileAtomic(storePath, { seq: 1 }),
      writeJsonFileAtomic(storePath, { seq: 2 }),
      writeJsonFileAtomic(storePath, { seq: 3 }),
    ])
    expect(JSON.parse(await readFile(storePath, 'utf-8'))).toEqual({ seq: 3 })
  })

  test('写入后目录里没有残留临时文件', async () => {
    const storePath = join(dir, 'store.json')
    await Promise.all([
      writeJsonFileAtomic(storePath, { a: 1 }),
      writeJsonFileAtomic(storePath, { a: 2 }),
      writeJsonFileAtomic(storePath, { a: 3 }),
    ])
    expect(await readdir(dir)).toEqual(['store.json'])
  })
})

describe('withJsonFileLock', () => {
  test('把整段读-改-写纳入同一条队列，并发调用不丢条目', async () => {
    const storePath = join(dir, 'store.json')
    async function upsert(key: string, value: number) {
      return withJsonFileLock(storePath, async (write) => {
        let current: Record<string, number> = {}
        try {
          current = JSON.parse(await readFile(storePath, 'utf-8'))
        } catch {
          current = {}
        }
        const next = { ...current, [key]: value }
        await write(next)
        return next
      })
    }

    await Promise.all([upsert('a', 1), upsert('b', 2), upsert('c', 3)])
    expect(JSON.parse(await readFile(storePath, 'utf-8'))).toEqual({ a: 1, b: 2, c: 3 })
  })
})
