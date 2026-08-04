// runFuturePlansEffect 是角色状态面板轻提示②（spec §6.3）的完整 effect 体，需要真行为覆盖
// rows 原样展示（「未写章」过滤已下沉主进程 readCharacterFuturePlans，见评审 P2-1）、editor
// 关闭时清空不请求、cancel 防晚到写回、失败静默这几条——都要求 mock `@/lib/ipc` 的 readPlannedState。
//
// 这必须落在独立测试文件里，不能追加进 CharacterStatePanel.test.tsx：那个文件用静态
// `import { CharacterStatePanelView } from './CharacterStatePanel'`，ESM 的静态 import 会在
// 模块自身代码运行前完成链接，届时 CharacterStatePanel.tsx 内部对 `@/lib/ipc` 的静态 import
// 已经绑定到真实模块——同一文件里事后调用的 mock.module 对它不再生效。照
// use-planned-state-counts.test.ts 的既有套路：mock.module 先行，再用动态 import 取模块，
// 保证拿到的是 mock 过 ipc 之后的版本。
import { describe, expect, mock, test } from 'bun:test'
import type { PlannedStateReadResult, PlannedStateRowDto } from '@shared/types/planned-state'

const readPlannedStateMock = mock(async () => ({ available: true, rows: [] }) as PlannedStateReadResult)

// mock.module 在 bun test 里是进程级的，必须展开真实模块只覆写本测试关心的那个导出，
// 否则会把 @/lib/ipc 的其余导出剥掉，炸掉同进程里其它 import 了 @/lib/ipc 的测试文件。
const actualIpc = await import('@/lib/ipc')
mock.module('@/lib/ipc', () => ({
  ...actualIpc,
  readPlannedState: readPlannedStateMock,
}))

const { runFuturePlansEffect } = await import('./CharacterStatePanel')

function row(overrides: Partial<PlannedStateRowDto> = {}): PlannedStateRowDto {
  return {
    id: 'p1',
    chapter: 12,
    status: 'planned',
    deferredToChapter: null,
    characterUid: 'u1',
    characterName: '角色甲',
    dimension: 'cultivation_level',
    operation: 'set',
    value: '金丹',
    reason: null,
    ...overrides,
  }
}

/** 记录型 setFuturePlans。 */
function recordingSetFuturePlans() {
  const calls: PlannedStateRowDto[][] = []
  return { calls, setFuturePlans: (next: PlannedStateRowDto[]) => calls.push(next) }
}

/** 手工 deferred：测试侧精确控制 IPC promise 何时、以何种方式落定。 */
function deferred() {
  let resolve: (value: PlannedStateReadResult) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<PlannedStateReadResult>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 等微任务队列排空，让 then/catch 回调有机会执行。 */
async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('runFuturePlansEffect（真行为）', () => {
  test('拉取成功 → rows 原样展示（未写章过滤已在主进程完成，本层不再复刻 floor 判定）', async () => {
    readPlannedStateMock.mockImplementation(
      async () =>
        ({
          available: true,
          rows: [row({ id: 'a', chapter: 9 }), row({ id: 'b', chapter: 12 })],
        }) as PlannedStateReadResult,
    )
    const { calls, setFuturePlans } = recordingSetFuturePlans()

    runFuturePlansEffect({ projectPath: '/p', characterUid: 'u1', activeEditor: 'card:cultivation_level' }, setFuturePlans)
    await flushMicrotasks()

    expect(readPlannedStateMock).toHaveBeenCalledWith({ projectPath: '/p', scope: { kind: 'character', characterUid: 'u1' } })
    expect(calls).toEqual([[row({ id: 'a', chapter: 9 }), row({ id: 'b', chapter: 12 })]])
  })

  test('新书场景（无完成章）：主进程未写章过滤后仍会返回全部计划行，effect 原样透传', async () => {
    readPlannedStateMock.mockImplementation(
      async () =>
        ({
          available: true,
          rows: [row({ id: 'first-chapter-plan', chapter: 1 })],
        }) as PlannedStateReadResult,
    )
    const { calls, setFuturePlans } = recordingSetFuturePlans()

    runFuturePlansEffect({ projectPath: '/p', characterUid: 'u1', activeEditor: 'identity' }, setFuturePlans)
    await flushMicrotasks()

    expect(calls).toEqual([[row({ id: 'first-chapter-plan', chapter: 1 })]])
  })

  test('activeEditor 为 null（编辑器已关闭）→ 不发起请求，同步清空，无残留', () => {
    readPlannedStateMock.mockClear()
    const { calls, setFuturePlans } = recordingSetFuturePlans()

    const cleanup = runFuturePlansEffect({ projectPath: '/p', characterUid: 'u1', activeEditor: null }, setFuturePlans)

    expect(cleanup).toBeUndefined()
    expect(calls).toEqual([[]])
    expect(readPlannedStateMock).not.toHaveBeenCalled()
  })

  test('result.available === false → 清空（memory.db 不可读等）', async () => {
    readPlannedStateMock.mockImplementation(async () => ({ available: false, rows: [] }) as PlannedStateReadResult)
    const { calls, setFuturePlans } = recordingSetFuturePlans()

    runFuturePlansEffect({ projectPath: '/p', characterUid: 'u1', activeEditor: 'identity' }, setFuturePlans)
    await flushMicrotasks()

    expect(calls).toEqual([[]])
  })

  test('拉取失败 → 静默清空（提示是增益不是账）', async () => {
    readPlannedStateMock.mockImplementation(async () => {
      throw new Error('ipc 失败')
    })
    const { calls, setFuturePlans } = recordingSetFuturePlans()

    runFuturePlansEffect({ projectPath: '/p', characterUid: 'u1', activeEditor: 'identity' }, setFuturePlans)
    await flushMicrotasks()

    expect(calls).toEqual([[]])
  })

  test('cleanup（切换角色/编辑器）后才落定的成功结果 → 不写回，防止串数据', async () => {
    const { promise, resolve } = deferred()
    readPlannedStateMock.mockImplementation(() => promise)
    const { calls, setFuturePlans } = recordingSetFuturePlans()

    const cleanup = runFuturePlansEffect({ projectPath: '/p', characterUid: 'u1', activeEditor: 'identity' }, setFuturePlans)
    cleanup?.()
    resolve({ available: true, rows: [row({ chapter: 20 })] })
    await flushMicrotasks()

    expect(calls).toEqual([])
  })

  test('cleanup 后才落定的失败 → 同样不写回', async () => {
    const { promise, reject } = deferred()
    readPlannedStateMock.mockImplementation(() => promise)
    const { calls, setFuturePlans } = recordingSetFuturePlans()

    const cleanup = runFuturePlansEffect({ projectPath: '/p', characterUid: 'u1', activeEditor: 'identity' }, setFuturePlans)
    cleanup?.()
    reject(new Error('ipc 失败'))
    await flushMicrotasks()

    expect(calls).toEqual([])
  })
})
