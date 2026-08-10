import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  proseOverrideStorePath,
  readProseOverrides,
  removeProseOverride,
  removeProseOverrides,
  setProseOverride,
} from './prose-override-store'

let dir = ''
let storePath = ''
const NOW = '2026-08-06T10:00:00+08:00'

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prose-store-'))
  storePath = proseOverrideStorePath(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function args(id: string, text: string) {
  return { storePath, id, text, baseText: '官方原文', baseEngineVersion: '4.0.162', now: NOW }
}

describe('readProseOverrides', () => {
  test('文件不存在 → 空对象，不抛', async () => {
    expect(await readProseOverrides(storePath)).toEqual({})
  })

  test('JSON 损坏 → 空对象，不抛', async () => {
    await writeFile(storePath, '{ 这不是 json', 'utf-8')
    expect(await readProseOverrides(storePath)).toEqual({})
  })

  test('形状非法的条目被丢弃，合法条目保留', async () => {
    await writeFile(
      storePath,
      JSON.stringify({
        version: 1,
        overrides: {
          good: { text: '我的', baseText: '官方', baseEngineVersion: '4.0.162', updatedAt: NOW },
          bad: { text: 123 },
        },
      }),
      'utf-8',
    )
    const result = await readProseOverrides(storePath)
    expect(Object.keys(result)).toEqual(['good'])
  })
})

describe('setProseOverride', () => {
  test('写入后可读回', async () => {
    await setProseOverride(args('writer-persona', '毒舌说书人'))
    const result = await readProseOverrides(storePath)
    expect(result['writer-persona'].text).toBe('毒舌说书人')
    expect(result['writer-persona'].baseText).toBe('官方原文')
    expect(result['writer-persona'].updatedAt).toBe(NOW)
  })

  test('空串合法：语义是删掉这条官方规则', async () => {
    await setProseOverride(args('writer-persona', ''))
    const result = await readProseOverrides(storePath)
    expect(result['writer-persona'].text).toBe('')
  })

  test('id 非 kebab-case 抛错', async () => {
    await expect(setProseOverride(args('Bad_Id', 'x'))).rejects.toThrow()
  })

  test('改写同一 id 覆盖而非累加', async () => {
    await setProseOverride(args('writer-persona', 'あ'.repeat(2000)))
    await setProseOverride(args('writer-persona', '短一点'))
    const result = await readProseOverrides(storePath)
    expect(result['writer-persona'].text).toBe('短一点')
  })
})

describe('并发写入', () => {
  test('并发 setProseOverride 两个不同 id，两条都在', async () => {
    await Promise.all([setProseOverride(args('block-a', 'A')), setProseOverride(args('block-b', 'B'))])
    const result = await readProseOverrides(storePath)
    expect(Object.keys(result).sort()).toEqual(['block-a', 'block-b'])
    expect(result['block-a'].text).toBe('A')
    expect(result['block-b'].text).toBe('B')
  })
})

describe('removeProseOverride', () => {
  test('移除单条', async () => {
    await setProseOverride(args('block-one', '甲'))
    await setProseOverride(args('block-two', '乙'))
    const result = await removeProseOverride({ storePath, id: 'block-one' })
    expect(Object.keys(result)).toEqual(['block-two'])
  })

  test('移除不存在的 id 是幂等的，不抛', async () => {
    const result = await removeProseOverride({ storePath, id: 'no-such' })
    expect(result).toEqual({})
  })
})

describe('removeProseOverrides（按 id 批量移除，供「恢复当前 Agent 默认」用）', () => {
  test('只删指定 ids，其余条目不受影响', async () => {
    await setProseOverride(args('block-one', '甲'))
    await setProseOverride(args('block-two', '乙'))
    await setProseOverride(args('block-three', '丙'))
    const result = await removeProseOverrides({ storePath, ids: ['block-one', 'block-three'] })
    expect(Object.keys(result)).toEqual(['block-two'])
    expect(await readProseOverrides(storePath)).toEqual(result)
  })

  test('证伪「误清其他 Agent」：两个 Agent 各有覆盖，只按一方 ids 移除，另一方原样保留', async () => {
    // writer-persona / writer-voice 模拟写手 Agent 的块，outline-scope 模拟另一个 Agent（大纲架构师）的块
    await setProseOverride(args('writer-persona', '毒舌说书人'))
    await setProseOverride(args('writer-voice', '第一人称'))
    await setProseOverride(args('outline-scope', '只写单线'))

    // 恢复写手 Agent：只传它自己的块 id 集合
    const result = await removeProseOverrides({ storePath, ids: ['writer-persona', 'writer-voice'] })

    expect(Object.keys(result)).toEqual(['outline-scope'])
    expect(result['outline-scope'].text).toBe('只写单线')
    const onDisk = await readProseOverrides(storePath)
    expect(onDisk).toEqual(result)
  })

  test('ids 为空是无副作用的幂等返回，不改动存量', async () => {
    await setProseOverride(args('block-one', '甲'))
    const before = await readProseOverrides(storePath)
    const result = await removeProseOverrides({ storePath, ids: [] })
    expect(result).toEqual(before)
    expect(await readProseOverrides(storePath)).toEqual(before)
  })

  test('ids 里含不存在的 id 不报错，存在的条目照常被移除', async () => {
    await setProseOverride(args('block-one', '甲'))
    const result = await removeProseOverrides({ storePath, ids: ['block-one', 'no-such'] })
    expect(result).toEqual({})
  })

  test('并发批量移除与写入交叠，不丢条目（沿用并发写入用例写法）', async () => {
    await setProseOverride(args('block-a', 'A'))
    await setProseOverride(args('block-b', 'B'))
    await Promise.all([
      removeProseOverrides({ storePath, ids: ['block-a'] }),
      setProseOverride(args('block-c', 'C')),
    ])
    const result = await readProseOverrides(storePath)
    expect(Object.keys(result).sort()).toEqual(['block-b', 'block-c'])
  })
})
