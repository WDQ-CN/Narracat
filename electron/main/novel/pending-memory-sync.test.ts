import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearPendingMemorySync,
  markPendingMemorySync,
  parseClearPendingMemorySyncInput,
  readPendingMemorySync,
} from './pending-memory-sync.ts'

let projectPath: string

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'narracat-pending-'))
})

afterEach(async () => {
  await rm(projectPath, { recursive: true, force: true })
})

describe('pending-memory-sync 状态文件', () => {
  test('无文件时读出空 map', async () => {
    expect(await readPendingMemorySync(projectPath)).toEqual({})
  })

  test('mark → read → clear 闭环', async () => {
    await markPendingMemorySync(projectPath, 13, ['改动涉及「林昭」'])
    const map = await readPendingMemorySync(projectPath)
    expect(map['13'].reasons).toEqual(['改动涉及「林昭」'])
    expect(map['13'].savedAt.length).toBeGreaterThan(0)

    await clearPendingMemorySync(projectPath, 13)
    expect(await readPendingMemorySync(projectPath)).toEqual({})
  })

  test('并发标记不同章节不会互相覆盖', async () => {
    await Promise.all([
      markPendingMemorySync(projectPath, 2, ['第二章改动']),
      markPendingMemorySync(projectPath, 8, ['第八章改动']),
    ])

    const map = await readPendingMemorySync(projectPath)
    expect(map['2'].reasons).toEqual(['第二章改动'])
    expect(map['8'].reasons).toEqual(['第八章改动'])
  })

  test('损坏 json fail closed，后续 mutation 不覆盖原文件', async () => {
    await mkdir(join(projectPath, '.narracat'), { recursive: true })
    const path = join(projectPath, '.narracat', 'pending-memory-sync.json')
    await writeFile(path, '{{{', 'utf-8')

    await expect(readPendingMemorySync(projectPath)).rejects.toThrow()
    await expect(markPendingMemorySync(projectPath, 8, ['第八章改动'])).rejects.toThrow()
    expect(await readFile(path, 'utf-8')).toBe('{{{')
  })

  test('clear 不存在的章是 no-op', async () => {
    await clearPendingMemorySync(projectPath, 99)
    expect(await readPendingMemorySync(projectPath)).toEqual({})
  })

  test('parseClearPendingMemorySyncInput 校验入参', () => {
    expect(parseClearPendingMemorySyncInput({ projectPath: '/p', chapter: 3 })).toEqual({ projectPath: '/p', chapter: 3 })
    expect(() => parseClearPendingMemorySyncInput({ projectPath: '/p', chapter: 0 })).toThrow()
    expect(() => parseClearPendingMemorySyncInput({ chapter: 3 })).toThrow()
  })
})
