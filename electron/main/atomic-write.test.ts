import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFile, type AtomicWriteOperations } from './atomic-write.ts'

describe('atomicWriteFile', () => {
  let root: string
  let targetPath: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'narracat-atomic-write-'))
    targetPath = join(root, 'state.json')
    await writeFile(targetPath, 'old\n', 'utf-8')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('原子替换目标且不残留临时文件', async () => {
    await atomicWriteFile(targetPath, 'new\n')

    expect(await readFile(targetPath, 'utf-8')).toBe('new\n')
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('rename 失败时保留完整旧文件并清理临时文件', async () => {
    const operations: AtomicWriteOperations = {
      open,
      stat,
      rm,
      rename: async () => {
        throw new Error('simulated rename failure')
      },
    }

    await expect(atomicWriteFile(targetPath, 'new\n', operations)).rejects.toThrow('simulated rename failure')
    expect(await readFile(targetPath, 'utf-8')).toBe('old\n')
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test.each(['writeFile', 'sync'] as const)('%s 失败时保留完整旧文件并清理临时文件', async (failedMethod) => {
    const operations: AtomicWriteOperations = {
      rename,
      stat,
      rm,
      open: (async (...args: Parameters<typeof open>) => {
        const handle = await open(...args)
        if (args[1] !== 'wx') return handle
        return new Proxy(handle, {
          get(target, property) {
            if (property === failedMethod) {
              return async () => {
                throw new Error(`simulated ${failedMethod} failure`)
              }
            }
            const value = Reflect.get(target, property, target)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
      }) as typeof open,
    }

    await expect(atomicWriteFile(targetPath, 'new\n', operations)).rejects.toThrow(`simulated ${failedMethod} failure`)
    expect(await readFile(targetPath, 'utf-8')).toBe('old\n')
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('目标目录不存在时不会在其它位置创建文件', async () => {
    const missingTarget = join(root, 'missing', 'state.json')
    await expect(atomicWriteFile(missingTarget, 'new\n')).rejects.toThrow()
    expect(await readdir(root)).toEqual(['state.json'])
  })
})
