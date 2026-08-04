import { afterEach, describe, expect, test } from 'bun:test'
import { DARK_MODE_ENABLED, getThemeSnapshot, initTheme, resolveEffectiveTheme, setTheme } from './theme'

const originalWindow = globalThis.window
const originalDocument = globalThis.document

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument })
})

/**
 * 用一个最小的 localStorage + document stub 跑 initTheme，
 * 验证「强制浅色」和「不覆写存值」两个门控承诺。
 */
function mockEnv(storedTheme: string | null) {
  const store = new Map<string, string>()
  if (storedTheme !== null) store.set('narracat-theme', storedTheme)
  const setCalls: Array<[string, string]> = []

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          setCalls.push([k, v])
          store.set(k, v)
        },
      },
      // 门控关闭时 initTheme 不应触达 matchMedia；触达即让测试炸出来
      matchMedia: () => {
        throw new Error('matchMedia 不应在深色门控关闭时被调用')
      },
    },
  })

  const dataset: Record<string, string> = {}
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { dataset } },
  })

  return { dataset, setCalls, read: () => store.get('narracat-theme') ?? null }
}

describe('深色模式门控', () => {
  test('门控关闭时，已存的 dark / system / light 都解析为 light', () => {
    if (DARK_MODE_ENABLED) return // 深色放开后此断言不再适用
    expect(resolveEffectiveTheme('dark')).toBe('light')
    expect(resolveEffectiveTheme('system')).toBe('light')
    expect(resolveEffectiveTheme('light')).toBe('light')
  })

  test('initTheme 把已存深色用户强制渲染为浅色，且不覆写其存值', () => {
    if (DARK_MODE_ENABLED) return
    const env = mockEnv('dark')

    initTheme()

    expect(env.dataset.theme).toBe('light') // 看到的是浅色
    expect(env.read()).toBe('dark') // 原选择被保留，未被覆写
    expect(env.setCalls).toHaveLength(0)
  })

  test('initTheme 对已存「跟随系统」用户同样强制浅色并保留存值', () => {
    if (DARK_MODE_ENABLED) return
    const env = mockEnv('system')

    initTheme()

    expect(env.dataset.theme).toBe('light')
    expect(env.read()).toBe('system')
    expect(env.setCalls).toHaveLength(0)
  })

  test('setTheme 持久化用户选择并同步到共享快照（单一数据源，常驻 Toaster 等实例据此同步）', () => {
    if (DARK_MODE_ENABLED) return
    const env = mockEnv('light')
    initTheme() // 基线

    setTheme('dark')

    expect(env.read()).toBe('dark') // 用户选择落盘
    const snap = getThemeSnapshot() // 所有 useTheme() 实例读同一份快照
    expect(snap.theme).toBe('dark') // 单一数据源已更新
    expect(snap.effectiveTheme).toBe('light') // 门控期间仍强制浅色
    expect(env.dataset.theme).toBe('light') // DOM 同步浅色
  })
})
