import { describe, expect, test } from 'bun:test'
import { fetchProviderModels } from './provider-models'

function fakeFetch(response: { status?: number; body?: unknown; fail?: boolean }): typeof fetch {
  return (async () => {
    if (response.fail) throw new Error('network down')
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      json: async () => response.body,
    } as Response
  }) as typeof fetch
}

describe('fetchProviderModels', () => {
  test('解析 anthropic wire 的 {data:[{id}]} 形态，去重保序', async () => {
    const result = await fetchProviderModels(
      { baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'sk-x' },
      fakeFetch({ body: { data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }] } }),
    )
    expect(result).toEqual({ ok: true, models: ['deepseek-v4-pro', 'deepseek-v4-flash'] })
  })

  test('baseUrl 为空走 anthropic 官方端点', async () => {
    let requested = ''
    const spy: typeof fetch = (async (url: unknown) => {
      requested = String(url)
      return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response
    }) as typeof fetch
    await fetchProviderModels({ baseUrl: '', apiKey: 'sk-x' }, spy)
    expect(requested).toBe('https://api.anthropic.com/v1/models')
  })

  test('HTTP 4xx/5xx → ok:false 带状态码信息', async () => {
    const result = await fetchProviderModels({ baseUrl: 'https://x.example', apiKey: 'k' }, fakeFetch({ status: 404, body: {} }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('404')
  })

  test('网络异常/响应不是 {data:[]} 形态 → ok:false，不抛出', async () => {
    expect((await fetchProviderModels({ baseUrl: 'https://x.example', apiKey: 'k' }, fakeFetch({ fail: true }))).ok).toBe(false)
    expect((await fetchProviderModels({ baseUrl: 'https://x.example', apiKey: 'k' }, fakeFetch({ body: { whatever: 1 } }))).ok).toBe(false)
  })
})
