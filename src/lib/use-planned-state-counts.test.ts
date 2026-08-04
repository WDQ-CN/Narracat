// usePlannedStateCounts 是 useEffect 驱动的异步拉取 hook（模式照 use-pending-memory-sync.ts）。
//
// 本仓 happy-dom（@happy-dom/global-registrator）+ @testing-library/react 的真实 DOM 测试目前
// 只安全共存 2 个文件（ChapterManuscriptView.interactions.test.tsx / StateChangesLedger.test.tsx /
// AgentThreadView.interactions.test.tsx）——实测加入第 3、4 个 register()/unregister() 文件后，
// 不管新文件放哪个目录、内容多精简（哪怕只 render 一个裸 div），StateChangesLedger.test.tsx 里
// 用 waitFor 断言 `[data-state-ledger="true"]` 的真实 DOM 交互测试就会随机性地读到空 DOM 而挂掉
// （单独跑该文件、跟其它 2 个既有 happy-dom 文件一起跑都绿，只有新增第 3/4 个文件时才复现）——
// 这是 bun test 内部调度 + happy-dom 全局单例交互的既有基础设施脆弱点，不是这个 hook 或这份
// PR 引入的 bug，但新增测试文件必须避开它。
//
// 所以 hook 的完整 effect 体抽成了可注入 setCounts 的独立函数 runPlannedStateCountsEffect
// （projectPath 缺失回落 / 拉取写回 / 报错静默回落 / cleanup 取消防晚到写回），这里用
// mock.module 换掉 @/lib/ipc 的 readPlannedStateCounts 后直接调用它做真行为测试——注入记录型
// setCounts、用手工 deferred 控制 IPC promise 落定时机，全程不碰 window/document，零 happy-dom
// 依赖，安全跟其它任何测试文件共存。剩下唯一没被真行为覆盖的是 useEffect 那一行接线
// （effect 体 + 依赖数组），用逐字源码断言锁定。
import { describe, expect, mock, test } from 'bun:test'
import type { PlannedStateCounts } from '@shared/types/planned-state'

const readPlannedStateCountsMock = mock(async () => ({}) as PlannedStateCounts)

// mock.module 在 bun test 里是进程级的（同进程后续加载的其它测试文件也会拿到 mock 后的模块），
// 所以必须展开真实模块、只覆写本测试关心的那一个导出，否则会把 @/lib/ipc 的其余导出剥掉，
// 炸掉同进程里其它 import 了 @/lib/ipc 的测试文件。
const actualIpc = await import('./ipc')
mock.module('@/lib/ipc', () => ({
  ...actualIpc,
  readPlannedStateCounts: readPlannedStateCountsMock,
}))

const { runPlannedStateCountsEffect } = await import('./use-planned-state-counts')

/** 手工 deferred：测试侧精确控制 IPC promise 何时、以何种方式落定。 */
function deferred() {
  let resolve: (value: PlannedStateCounts) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<PlannedStateCounts>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 记录型 setCounts。 */
function recordingSetCounts() {
  const calls: PlannedStateCounts[] = []
  return { calls, setCounts: (next: PlannedStateCounts) => calls.push(next) }
}

/** 等微任务队列排空，让 then/catch 回调有机会执行。 */
async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('runPlannedStateCountsEffect（真行为）', () => {
  test('拉取成功 → setCounts 收到按章计数映射', async () => {
    readPlannedStateCountsMock.mockImplementation(async () => ({ '12': 2, '13': 1 }))
    const { calls, setCounts } = recordingSetCounts()

    runPlannedStateCountsEffect('/p', setCounts)
    await flushMicrotasks()

    expect(readPlannedStateCountsMock).toHaveBeenCalledWith({ projectPath: '/p' })
    expect(calls).toEqual([{ '12': 2, '13': 1 }])
  })

  test('拉取失败 → 静默回落，setCounts 收到空映射', async () => {
    readPlannedStateCountsMock.mockImplementation(async () => {
      throw new Error('ipc 失败')
    })
    const { calls, setCounts } = recordingSetCounts()

    runPlannedStateCountsEffect('/p', setCounts)
    await flushMicrotasks()

    expect(calls).toEqual([{}])
  })

  test('projectPath 缺失 → 不发起拉取，同步回落空映射，无 cleanup', () => {
    readPlannedStateCountsMock.mockClear()
    const { calls, setCounts } = recordingSetCounts()

    const cleanup = runPlannedStateCountsEffect(undefined, setCounts)

    expect(cleanup).toBeUndefined()
    expect(calls).toEqual([{}])
    expect(readPlannedStateCountsMock).not.toHaveBeenCalled()
  })

  test('cleanup（组件卸载/依赖变化）后才落定的成功结果 → 不写回', async () => {
    const { promise, resolve } = deferred()
    readPlannedStateCountsMock.mockImplementation(() => promise)
    const { calls, setCounts } = recordingSetCounts()

    const cleanup = runPlannedStateCountsEffect('/p', setCounts)
    cleanup?.()
    resolve({ '12': 9 })
    await flushMicrotasks()

    expect(calls).toEqual([])
  })

  test('cleanup 后才落定的失败 → 同样不把 {} 写回去', async () => {
    const { promise, reject } = deferred()
    readPlannedStateCountsMock.mockImplementation(() => promise)
    const { calls, setCounts } = recordingSetCounts()

    const cleanup = runPlannedStateCountsEffect('/p', setCounts)
    cleanup?.()
    reject(new Error('ipc 失败'))
    await flushMicrotasks()

    expect(calls).toEqual([])
  })
})

describe('usePlannedStateCounts（useEffect 接线，逐字源码锁定）', () => {
  test('effect 体逐字调用 runPlannedStateCountsEffect，依赖数组为 [projectPath, reloadKey]', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const source = readFileSync(fileURLToPath(new URL('./use-planned-state-counts.ts', import.meta.url)), 'utf-8')

    expect(source).toContain(
      'useEffect(() => runPlannedStateCountsEffect(projectPath, setCounts), [projectPath, reloadKey])',
    )
  })
})
