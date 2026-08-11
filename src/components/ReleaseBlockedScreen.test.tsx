// ReleaseBlockedScreen 真实 DOM 挂载测试。
//
// 为什么不用 GlobalRegistrator：实测本仓同进程 GlobalRegistrator 安全共存上限=4
// （ChapterManuscriptView.interactions / StateChangesLedger / AgentThreadView.interactions /
// BookVoiceAnchors），已用满，追加第 5 个会让生命周期互相冲盖导致既有用例批量失败。
//
// 为什么也不用 @testing-library/react（跟 UpdateRow.test.tsx / UpdateBadgeDot.test.tsx 的先例
// 不同——这是本文件实测抓到、先例注释里没写的新坑）：`@testing-library/dom` 的 `screen` 是
// 进程级单例，在整个 `bun test` 进程里第一次被任意文件 `import '@testing-library/react'` 触发时
// 就把内部查询永久绑死在「那一刻」的 `document.body` 上——不管那个文件本身有没有用到 `screen`，
// 只要 import 了 `@testing-library/react` 就会触发这次绑定。本文件路径
// `src/components/ReleaseBlockedScreen.test.tsx` 按 ASCII 排序排在
// `src/components/settings/UpdateRow.test.tsx` 前面（大写 R 排在小写 s 前面），一旦本文件也
// import `@testing-library/react`，就会抢先把单例绑到本文件自己新建的 happy-dom
// document.body 上；等 UpdateRow.test.tsx 后加载、执行 `screen.getByText(...)` 时，单例早已
// 绑死在本文件那个已经 `afterAll` 关闭的 document 上，查询直接落空——实测
// `bun --no-cache run test` 全量跑会让 UpdateRow.test.tsx 唯一那条用例失败。改走
// WizardView.mount.test.tsx 的先例：不引入 `@testing-library/react`/`@testing-library/dom`，只用
// `react-dom/client` 裸 `createRoot` + `React.act` 挂载，查询走 `container.querySelector` /
// `innerHTML`，从根上避开这个进程级单例。
//
// 与先例同款的模块加载纪律：全局挂载必须发生在 react-dom/client 等模块被 import 之前，而
// ES import 会提升到模块顶部——所以先同步挂全局，再顶层 await 动态 import。
import { Window } from 'happy-dom'

const happyWindow = new Window()
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'window', { configurable: true, value: happyWindow })
Object.defineProperty(globalThis, 'document', { configurable: true, value: happyWindow.document })
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { afterAll, afterEach, describe, expect, test } = await import('bun:test')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { ReleaseBlockedScreen } = await import('./ReleaseBlockedScreen.tsx')
type ReleaseGateReason = import('@shared/types/ipc').ReleaseGateReason
type UpdaterState = import('@shared/types/ipc').UpdaterState

let container: ReturnType<typeof happyWindow.document.createElement> | null = null
let root: ReturnType<typeof createRoot> | null = null

/**
 * mock `window.electron` 的更新相关三个方法，供 I2 死胡同回归测试用。
 * 不用 GlobalRegistrator/@testing-library（本文件头注已解释原因），走 WizardView.mount.test.tsx
 * 的先例：手动挂到 happy-dom window 上，测试内直接触发 onUpdaterStateChanged 回调模拟广播。
 */
function mockElectron(initialState: UpdaterState) {
  let listener: ((next: UpdaterState) => void) | null = null
  let getStateCalls = 0
  ;(happyWindow as unknown as { electron: unknown }).electron = {
    getUpdaterState: () => {
      getStateCalls += 1
      return Promise.resolve(initialState)
    },
    onUpdaterStateChanged: (callback: (next: UpdaterState) => void) => {
      listener = callback
      return () => {
        listener = null
      }
    },
    installUpdate: () => Promise.resolve(),
  }
  return {
    emit: (next: UpdaterState) => listener?.(next),
    getStateCalls: () => getStateCalls,
  }
}

function clearElectronMock() {
  Reflect.deleteProperty(happyWindow as unknown as object, 'electron')
}

/** 点一次「立即更新并重启」按钮，等足够的微任务/宏任务把状态更新与 onClick 的 try/catch/finally 走完。 */
async function clickUpdateButton() {
  const button = container?.querySelector('button') as unknown as { click: () => void } | null
  await act(async () => {
    button?.click()
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** 真实挂载 ReleaseBlockedScreen，返回渲染出的 HTML 供文本/结构断言。 */
async function mountScreen(reason: ReleaseGateReason, notice: string): Promise<string> {
  container = happyWindow.document.createElement('div')
  happyWindow.document.body.appendChild(container)
  root = createRoot(container as unknown as Element)
  await act(async () => {
    root!.render(<ReleaseBlockedScreen reason={reason} notice={notice} />)
  })
  return container ? (container as unknown as { innerHTML: string }).innerHTML : ''
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount()
    })
    root = null
  }
  if (container) {
    container.remove()
    container = null
  }
})

afterAll(async () => {
  if (originalWindowDescriptor) Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalDocumentDescriptor) Object.defineProperty(globalThis, 'document', originalDocumentDescriptor)
  else Reflect.deleteProperty(globalThis, 'document')
  await happyWindow.happyDOM.close()
})

describe('ReleaseBlockedScreen', () => {
  test('min-version 拦截给出更新按钮', async () => {
    const html = await mountScreen('min-version', '此版本已停用')
    expect(html).toContain('立即更新并重启')
    expect(container?.querySelector('button')?.textContent).toBe('立即更新并重启')
  })

  // kill / expired / hard-expired 是刻意停用，不是版本过旧——给更新按钮会把用户带进死循环。
  test('急刹车拦截不给更新按钮', async () => {
    await mountScreen('kill', '内测已暂停')
    expect(container?.querySelector('button')).toBeNull()
  })

  test('过期拦截不给更新按钮', async () => {
    await mountScreen('expired', '内测已结束')
    expect(container?.querySelector('button')).toBeNull()
  })

  test('所有 reason 都保留官网链接', async () => {
    const html = await mountScreen('min-version', '此版本已停用')
    expect(html).toContain('前往 narracat.com')
  })
})

// I2 死胡同回归：点了「立即更新并重启」却什么都没发生的三种场景之二（update-not-available
// 回 idle / error）。第三种（startUpdater 时序）不在本组件职责内，见 electron/main/index.ts。
describe('ReleaseBlockedScreen 更新兜底提示（I2）', () => {
  afterEach(() => {
    clearElectronMock()
  })

  test('点击前不出现手动下载兜底提示', async () => {
    const html = await mountScreen('min-version', '此版本已停用')
    expect(html).not.toContain('自动更新没有成功')
  })

  // 最现实的死胡同场景：minVersion 抬到了一个还没上传的版本，查询回 idle（查不到新版）。
  // 本测试不 mock window.electron——installUpdate() 访问 window.electron.installUpdate
  // 会同步抛错，被 onClick 的 try/catch 吞掉，状态维持在兜底 idle，正好复现这个场景。
  test('点击后查不到新版本（idle）→ 出现手动下载兜底提示', async () => {
    await mountScreen('min-version', '此版本已停用')
    await clickUpdateButton()
    const html = container ? (container as unknown as { innerHTML: string }).innerHTML : ''
    expect(html).toContain('自动更新没有成功')
  })

  test('点击后收到 error 状态 → 同样出现手动下载兜底提示', async () => {
    const mock = mockElectron({
      status: 'idle',
      currentVersion: '0.1.1871',
      availableVersion: null,
      percent: 0,
      manual: false,
    })
    await mountScreen('min-version', '此版本已停用')
    await clickUpdateButton()
    await act(async () => {
      mock.emit({ status: 'error', currentVersion: '0.1.1871', availableVersion: null, percent: 0, manual: true })
    })
    const html = container ? (container as unknown as { innerHTML: string }).innerHTML : ''
    expect(html).toContain('自动更新没有成功')
  })

  test('下载中不出现兜底提示（还在等，不是死胡同）', async () => {
    const mock = mockElectron({
      status: 'idle',
      currentVersion: '0.1.1871',
      availableVersion: null,
      percent: 0,
      manual: false,
    })
    await mountScreen('min-version', '此版本已停用')
    await clickUpdateButton()
    await act(async () => {
      mock.emit({ status: 'downloading', currentVersion: '0.1.1871', availableVersion: '0.1.1880', percent: 40, manual: true })
    })
    const html = container ? (container as unknown as { innerHTML: string }).innerHTML : ''
    expect(html).not.toContain('自动更新没有成功')
    expect(html).toContain('正在下载 40%')
  })

  // I2 第三点：kill/expired/hard-expired 不能靠更新自救，白调一次 IPC 与订阅没有意义。
  test('kill 拦截不启用 useUpdater：不调用 getUpdaterState', async () => {
    const mock = mockElectron({
      status: 'idle',
      currentVersion: '0.1.1871',
      availableVersion: null,
      percent: 0,
      manual: false,
    })
    await mountScreen('kill', '内测已暂停')
    expect(mock.getStateCalls()).toBe(0)
  })
})
