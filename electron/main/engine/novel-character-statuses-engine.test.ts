import { describe, expect, test } from 'bun:test'

import {
  readCharacterStatusesViaEngine,
  type NovelCharacterStatusesMcpClient,
  type NovelCharacterStatusesMcpClientFactory,
} from './novel-memory-mcp-client'

const UID_A = 'aaaa1111-1111-4111-8111-111111111111'
const UID_B = 'bbbb2222-2222-4222-8222-222222222222'
const RESOURCES = { appRoot: '/app', resourcesPath: undefined }

/** 记录调用并按脚本返回的假客户端工厂。 */
function fakeFactory(script: {
  text?: string
  throwOnCall?: boolean
}): {
  factory: NovelCharacterStatusesMcpClientFactory
  calls: Array<Record<string, unknown>>
  spawned: number
  closed: number
} {
  const calls: Array<Record<string, unknown>> = []
  let spawned = 0
  let closed = 0
  const factory: NovelCharacterStatusesMcpClientFactory = () => {
    spawned += 1
    const client: NovelCharacterStatusesMcpClient = {
      async callTool(args) {
        calls.push(args)
        if (script.throwOnCall) throw new Error('engine spawn failed')
        return script.text ?? ''
      },
      async close() {
        closed += 1
      },
    }
    return client
  }
  return {
    factory,
    calls,
    get spawned() {
      return spawned
    },
    get closed() {
      return closed
    },
  }
}

describe('readCharacterStatusesViaEngine', () => {
  test('解析引擎 statuses 回填为 Map（只含有状态的 uid）', async () => {
    const harness = fakeFactory({
      text: JSON.stringify({
        ok: true,
        at_chapter: 3,
        statuses: { [UID_A]: '右臂带伤', [UID_B]: '精神紧绷' },
      }),
    })
    const result = await readCharacterStatusesViaEngine(
      '/proj',
      [UID_A, UID_B],
      3,
      RESOURCES,
      harness.factory,
    )
    expect(result.get(UID_A)).toBe('右臂带伤')
    expect(result.get(UID_B)).toBe('精神紧绷')
    // at_chapter 透传、character_uids 透传。
    expect(harness.calls[0]).toEqual({ character_uids: [UID_A, UID_B], at_chapter: 3 })
    expect(harness.closed).toBe(1)
  })

  test('空 uid 列表：不 spawn 引擎、直接返回空 Map（零开销）', async () => {
    const harness = fakeFactory({ text: 'unused' })
    const result = await readCharacterStatusesViaEngine('/proj', [], 3, RESOURCES, harness.factory)
    expect(result.size).toBe(0)
    expect(harness.spawned).toBe(0)
    expect(harness.calls.length).toBe(0)
  })

  test('at_chapter 为 null 时不传该参数（引擎用最新已入库章）', async () => {
    const harness = fakeFactory({ text: JSON.stringify({ ok: true, statuses: {} }) })
    await readCharacterStatusesViaEngine('/proj', [UID_A], null, RESOURCES, harness.factory)
    expect(harness.calls[0]).toEqual({ character_uids: [UID_A] })
  })

  test('引擎调用抛错：降级返回空 Map，且仍 close', async () => {
    const harness = fakeFactory({ throwOnCall: true })
    const result = await readCharacterStatusesViaEngine(
      '/proj',
      [UID_A],
      3,
      RESOURCES,
      harness.factory,
    )
    expect(result.size).toBe(0)
    expect(harness.closed).toBe(1)
  })

  test('工具返回非 JSON / 空文本：降级返回空 Map', async () => {
    const harnessBad = fakeFactory({ text: '不是 JSON' })
    expect(
      (await readCharacterStatusesViaEngine('/proj', [UID_A], 3, RESOURCES, harnessBad.factory))
        .size,
    ).toBe(0)
    const harnessEmpty = fakeFactory({ text: '' })
    expect(
      (await readCharacterStatusesViaEngine('/proj', [UID_A], 3, RESOURCES, harnessEmpty.factory))
        .size,
    ).toBe(0)
  })

  test('忽略非字符串 / 空白 status 值', async () => {
    const harness = fakeFactory({
      text: JSON.stringify({
        ok: true,
        statuses: { [UID_A]: '   ', [UID_B]: 42 },
      }),
    })
    const result = await readCharacterStatusesViaEngine(
      '/proj',
      [UID_A, UID_B],
      null,
      RESOURCES,
      harness.factory,
    )
    expect(result.size).toBe(0)
  })
})
