import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { runCorpusHealthProbe } from './corpus-probe.ts'

const ENV_KEYS = ['NARRACAT_CORPUS_TOKEN', 'NARRACAT_CORPUS_URL', 'NARRACAT_CORPUS_DIR'] as const

const originalEnv: Record<(typeof ENV_KEYS)[number], string | undefined> = {
  NARRACAT_CORPUS_TOKEN: undefined,
  NARRACAT_CORPUS_URL: undefined,
  NARRACAT_CORPUS_DIR: undefined,
}
const originalFetch = globalThis.fetch

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
  globalThis.fetch = originalFetch
})

describe('runCorpusHealthProbe', () => {
  test('未配置凭证 → disabled，且不发任何请求', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('{}')
    }) as typeof fetch

    const result = await runCorpusHealthProbe()

    expect(result.ok).toBe(false)
    expect(result.mode).toBe('disabled')
    expect(called).toBe(false)
  })

  test('配置本地语料目录 → local，不发请求', async () => {
    process.env.NARRACAT_CORPUS_DIR = '/tmp/corpus'
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('{}')
    }) as typeof fetch

    const result = await runCorpusHealthProbe()

    expect(result.ok).toBe(true)
    expect(result.mode).toBe('local')
    expect(called).toBe(false)
  })

  test('remote 200 → ok，透传 totalEntries', async () => {
    process.env.NARRACAT_CORPUS_TOKEN = 'tok-1'
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, total_entries: 4141 }), { status: 200 })) as typeof fetch

    const result = await runCorpusHealthProbe()

    expect(result.ok).toBe(true)
    expect(result.mode).toBe('remote')
    expect(result.totalEntries).toBe(4141)
  })

  test('remote 非 200 → ok:false / mode:remote', async () => {
    process.env.NARRACAT_CORPUS_TOKEN = 'tok-1'
    globalThis.fetch = (async () => new Response('oops', { status: 500 })) as typeof fetch

    const result = await runCorpusHealthProbe()

    expect(result.ok).toBe(false)
    expect(result.mode).toBe('remote')
  })

  test('remote 超时/网络异常 → ok:false / mode:remote', async () => {
    process.env.NARRACAT_CORPUS_TOKEN = 'tok-1'
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch

    const result = await runCorpusHealthProbe()

    expect(result.ok).toBe(false)
    expect(result.mode).toBe('remote')
  })
})
