import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { MemoryGraphSnapshot } from '@shared/types/memory-graph'
import type { MemoryGraphState } from './use-memory-graph'

// mock.module 换掉 @/lib/ipc 的 readMemoryGraph 后直接调用 effect 体做真行为测试
// （照 use-planned-state-counts.test.ts 的先例：不依赖真实 DOM）。
//
// mock.module 在 bun test 里是进程级的（同进程后续加载的其它测试文件也会拿到 mock 后的模块），
// 所以必须展开真实模块、只覆写本测试关心的那一个导出，否则会把 @/lib/ipc 的其余导出剥掉，
// 炸掉同进程里其它 import 了 @/lib/ipc 的测试文件（实测：全量跑 src/lib 时 8 个文件报
// "Export named 'xxx' not found in module ipc.ts"）。
const readMemoryGraphMock = mock(async () => ({ nodes: [], links: [] }) as MemoryGraphSnapshot)

const actualIpc = await import('./ipc')
mock.module('@/lib/ipc', () => ({
  ...actualIpc,
  readMemoryGraph: readMemoryGraphMock,
}))

const { runMemoryGraphEffect } = await import('./use-memory-graph')

const sample: MemoryGraphSnapshot = {
  nodes: [{ id: 'uid-a', kind: 'character', label: '苏见', ownerId: null, predicate: null, predicateLabel: null, factCount: 1, chapter: null }],
  links: [],
}

const emptyGraph: MemoryGraphSnapshot = { nodes: [], links: [] }

/**
 * 记录型 setState：像真实 useState 的 setter 一样，既接受新值也接受 (previous) => next 的
 * 函数式更新——runMemoryGraphEffect 起手用函数式更新保留上一次的 graph、只把 loading 翻回
 * true（reload 场景），只有真解析这个函数式更新才能测出这个行为，光记录「传进来的是什么」测不出。
 */
function recordingSetState(initial: MemoryGraphState) {
  let current = initial
  const states: MemoryGraphState[] = []
  const setState = (next: MemoryGraphState | ((previous: MemoryGraphState) => MemoryGraphState)) => {
    current = typeof next === 'function' ? next(current) : next
    states.push(current)
  }
  return { states, setState, current: () => current }
}

describe('runMemoryGraphEffect', () => {
  beforeEach(() => {
    readMemoryGraphMock.mockClear()
    readMemoryGraphMock.mockImplementation(async () => ({ nodes: [], links: [] }))
  })

  test('writes fetched graph and clears loading', async () => {
    readMemoryGraphMock.mockImplementation(async () => sample)
    const { states, setState } = recordingSetState({ graph: emptyGraph, loading: false })

    runMemoryGraphEffect('/p', setState)
    await Promise.resolve()
    await Promise.resolve()

    expect(readMemoryGraphMock).toHaveBeenCalledWith({ projectPath: '/p' })
    expect(states.at(-1)).toEqual({ graph: sample, loading: false })
  })

  test('falls back to an empty graph when the read fails', async () => {
    readMemoryGraphMock.mockImplementation(async () => {
      throw new Error('db gone')
    })
    const { states, setState } = recordingSetState({ graph: emptyGraph, loading: false })

    runMemoryGraphEffect('/p', setState)
    await Promise.resolve()
    await Promise.resolve()

    expect(states.at(-1)).toEqual({ graph: { nodes: [], links: [] }, loading: false })
  })

  test('skips the fetch entirely without a project path', () => {
    const { states, setState } = recordingSetState({ graph: emptyGraph, loading: false })

    const cleanup = runMemoryGraphEffect(undefined, setState)

    expect(readMemoryGraphMock).not.toHaveBeenCalled()
    expect(states).toEqual([{ graph: { nodes: [], links: [] }, loading: false }])
    expect(cleanup).toBeUndefined()
  })

  test('cancelled effect does not write late results', async () => {
    readMemoryGraphMock.mockImplementation(async () => sample)
    const { states, setState } = recordingSetState({ graph: emptyGraph, loading: false })

    const cleanup = runMemoryGraphEffect('/p', setState)
    cleanup?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(states.some((state) => state.graph === sample)).toBe(false)
  })

  // fix round 1 Important finding：reloadKey 变化触发重拉时（如 agent run 结束后刷新星图），
  // hook 应当立刻把 loading 置回 true 且保留上一次拿到的 graph（星图刷新是「正在刷新」，
  // 不是先清空再重画）。这条曾经完全没有测试执行到——4 条既有测试全部只跑「首次拉取」这一条
  // 路径，删掉那行 setState((previous) => ...) 也不会有任何测试变红。
  test('re-running after a settled result flips loading back to true while keeping the previous graph', async () => {
    readMemoryGraphMock.mockImplementation(async () => sample)
    const { setState, current } = recordingSetState({ graph: emptyGraph, loading: false })

    // 首次拉取（如首次挂载）落定，拿到 sample。
    runMemoryGraphEffect('/p', setState)
    await Promise.resolve()
    await Promise.resolve()
    expect(current()).toEqual({ graph: sample, loading: false })

    // reloadKey 变化触发第二次拉取：只看起手瞬间（第二次 fetch 挂起、永不落定）的状态——
    // 应同步把 loading 翻回 true，且 graph 仍是上一次的 sample，不被清空。
    readMemoryGraphMock.mockImplementation(() => new Promise(() => {}))
    runMemoryGraphEffect('/p', setState)

    expect(current()).toEqual({ graph: sample, loading: true })
  })
})

// useEffect 接线本体（依赖数组、初始 loading 表达式）这里选源码锁定而不是真实 DOM 渲染测试，
// 不是因为「同进程共存有硬上限」——那条旧结论（use-planned-state-counts.test.ts 顶部注释写的
// 「只安全共存 2 个」）已经过时：交叉核对现状（2026-08-06）用 `grep -rl GlobalRegistrator src`
// 实测命中 9 个真实 DOM 测试文件，package.json 的 test 脚本把它们全纳入同一次 bun test 进程；
// LearnFromBookView.test.tsx 头注更明确记录「上限=3」已被 PR#501 评审修复推翻——
// BookVoiceAnchors.test.tsx 作为第 4 个注册文件连续 10 次全量 `bun --no-cache run test` 实测
// 10/10 全绿。真实 DOM 测试在这里技术上是可行的。
// 选源码锁定的真实理由是成本收益比：这两处（把哪个函数接到 useEffect、依赖数组填什么、初始值
// 怎么算）纯粹是「胶水」，行为本身已经被上面 runMemoryGraphEffect 的真行为测试覆盖到了——为了
// 守住两行胶水代码去新增第 10 个 GlobalRegistrator 注册文件不划算。源码锁定要防的只是「胶水
// 写法被改错或误删」，锁到完整语句边界（含尾逗号/闭合括号）就足够卡住任何会改变行为的插入。
describe('useMemoryGraph（useEffect 接线，逐字源码锁定）', () => {
  test('effect 体逐字调用 runMemoryGraphEffect，依赖数组为 [projectPath, reloadKey]', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const source = readFileSync(fileURLToPath(new URL('./use-memory-graph.ts', import.meta.url)), 'utf-8')

    expect(source).toContain(
      'useEffect(() => runMemoryGraphEffect(projectPath, setState), [projectPath, reloadKey])',
    )
  })

  test('初始 loading 态跟着 Boolean(projectPath) 走（锁到语句边界，防止改成掺了其它条件的宽松子串仍能过）', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const source = readFileSync(fileURLToPath(new URL('./use-memory-graph.ts', import.meta.url)), 'utf-8')

    // 锁住从 `loading:` 到紧接着的语句收尾（尾逗号 + 下一行闭合 `})`）——任何在
    // `Boolean(projectPath)` 和尾逗号之间插入的内容（如改成 `Boolean(projectPath) && x`）
    // 都会让这段精确子串消失，测试真的会变红，不是只匹配前缀就过。
    expect(source).toContain('    loading: Boolean(projectPath),\n  })')
  })
})
