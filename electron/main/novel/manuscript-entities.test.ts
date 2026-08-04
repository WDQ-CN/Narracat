import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectManuscriptEntityNames } from './manuscript-entities.ts'
import type { MemoryDbReader } from './memory-db.ts'

let projectPath: string

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'narracat-entities-'))
  await mkdir(join(projectPath, 'bible', 'characters'), { recursive: true })
  await writeFile(
    join(projectPath, 'bible', 'characters', 'lin-zhao.md'),
    [
      '<!-- character_identity: {"character_uid":"C-001","name":"林昭"} -->',
      '# 林昭',
      '',
      '## 基本信息',
      '- 别名: 小昭、昭爷',
    ].join('\n'),
    'utf-8',
  )
})

afterEach(async () => {
  await rm(projectPath, { recursive: true, force: true })
})

function fakeReader(rows: Array<{ description: string }>): MemoryDbReader {
  return {
    all<T>(): T[] {
      return rows as T[]
    },
    close() {},
  }
}

describe('collectManuscriptEntityNames', () => {
  test('收集角色名 + 别名 + 短伏笔描述，去重', async () => {
    const names = await collectManuscriptEntityNames({
      projectPath,
      openMemoryDb: () => fakeReader([{ description: '断剑' }, { description: '这是一条很长很长的伏笔描述不该被当作关键词匹配' }]),
    })
    expect(names).toContain('林昭')
    expect(names).toContain('小昭')
    expect(names).toContain('昭爷')
    expect(names).toContain('断剑')
    expect(names.some((n) => n.includes('很长很长'))).toBe(false)
  })

  test('无记忆库（openMemoryDb 抛错）时静默回退，只给角色名', async () => {
    const names = await collectManuscriptEntityNames({
      projectPath,
      openMemoryDb: () => {
        throw new Error('no db')
      },
    })
    expect(names).toContain('林昭')
  })

  test('无角色档案目录时返回空数组不抛错', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'narracat-entities-empty-'))
    try {
      expect(await collectManuscriptEntityNames({ projectPath: empty })).toEqual([])
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})
