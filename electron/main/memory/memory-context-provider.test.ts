import { describe, expect, it } from 'bun:test'
import { createConfigWatchingContextProvider } from './memory-context-provider.ts'

describe('createConfigWatchingContextProvider', () => {
  it('mtime 未变：并发/多次调用共享同一次创建', async () => {
    let creates = 0
    const getContext = createConfigWatchingContextProvider({
      statMtimeMs: () => 100,
      createContext: async () => {
        creates += 1
        return { id: creates }
      },
    })
    const [a, b] = await Promise.all([getContext(), getContext()])
    const c = await getContext()
    expect(creates).toBe(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('mtime 变化：重建上下文并关闭旧上下文（setup 写 config.yaml 后预算字段可见的根治缝）', async () => {
    let mtime = 100
    let creates = 0
    const closed: Array<{ id: number }> = []
    const getContext = createConfigWatchingContextProvider({
      statMtimeMs: () => mtime,
      createContext: async () => {
        creates += 1
        return { id: creates }
      },
      closeContext: (ctx) => closed.push(ctx),
    })
    const first = await getContext()
    mtime = 200
    const second = await getContext()
    expect(creates).toBe(2)
    expect(second).not.toBe(first)
    expect(closed).toEqual([{ id: 1 }])
    // 变回缓存态
    expect(await getContext()).toBe(second)
    expect(creates).toBe(2)
  })

  it('创建失败：缓存清空，下次调用重试（不粘死在失败态）', async () => {
    let fail = true
    let creates = 0
    const getContext = createConfigWatchingContextProvider({
      statMtimeMs: () => 100,
      createContext: async () => {
        creates += 1
        if (fail) throw new Error('config 读取失败')
        return { id: creates }
      },
    })
    await expect(getContext()).rejects.toThrow('config 读取失败')
    fail = false
    const ctx = await getContext()
    expect(ctx).toEqual({ id: 2 })
  })

  it('旧上下文关闭抛错不阻断重建', async () => {
    let mtime = 100
    const getContext = createConfigWatchingContextProvider({
      statMtimeMs: () => mtime,
      createContext: async () => ({ at: mtime }),
      closeContext: () => {
        throw new Error('close 失败')
      },
    })
    await getContext()
    mtime = 200
    expect(await getContext()).toEqual({ at: 200 })
  })
})
