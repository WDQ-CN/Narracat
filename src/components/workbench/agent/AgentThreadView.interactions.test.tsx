// 对话流贴底跟随回归测试（dogfood #1）。
//
// 断点：AgentThreadContent 在空线程时 mount（工作台常态）走空状态提前 return，contentRef 为
// null；「唯一钉底司机」ResizeObserver effect 依赖数组原为 []，只在 mount 跑一次就早退——首条
// 消息出现后 observer 永远没挂上，流式输出完全不跟随。修复 = effect 依赖 hasMessages，空→非空
// 转换时重跑并真正 observe。
//
// 本文件用真实 DOM（happy-dom）+ 可记录的 ResizeObserver 全局 stub 锁住：
//   ① 空线程 mount → 首条消息出现后，observer 确实 observe 了消息内容容器（回归核心）；
//   ② 贴底状态下 observer 回调把 viewport.scrollTop 钉到 scrollHeight；
//   ③ 用户上滑离底后 observer 回调不再钉底，只亮「最新」按钮。
// happy-dom 没有真实布局引擎，「内容高度变化触发 RO 回调」这一环无法在测试里发生，由 stub 手动
// 触发代替；真实 RO 的触发行为留真机验证。
//
// happy-dom 全局注册必须先于 @testing-library/react 的加载（ES import 会提升），沿用
// ChapterManuscriptView.interactions.test.tsx 的「先 register() 再顶层 await import()」写法，
// afterAll 里 unregister() 并恢复被覆写的全局 ResizeObserver。
import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register()

const { afterAll, afterEach, beforeEach, describe, expect, test } = await import('bun:test')
// 注意：不要用 @testing-library/dom 的 `screen`——它在模块加载时绑定当时的 global document，
// 同进程里先跑的其它 interactions 测试注册/注销过 happy-dom 后，`screen` 会指向已被拆掉的旧
// document（单文件跑绿、全量跑挂）。统一用当前 global document 查询。
const { act, cleanup, fireEvent, render, waitFor } = await import('@testing-library/react')
const { AgentThreadContent } = await import('./AgentThreadView')
const { AgentPanelContent } = await import('../AgentPanel')
const { TooltipProvider } = await import('@/components/ui/tooltip')
// AgentPanelContent → AgentComposer 底栏挂了 AgentModelSwitcher（切片②T3），其 useNavigate 需要
// Router 上下文，否则真实 DOM render 会抛「useNavigate() may be used only in the context of a
// <Router> component」。
const { MemoryRouter } = await import('react-router')
const { useAgentStore } = await import('@/lib/agent-store')
import { POOL_DEFAULT_FIELDS, type AppConfig } from '@shared/types/config'
import type { AgentMessage, AgentRun, AgentThread } from '@shared/types/agent'

type ElectronApi = typeof window.electron

const stubAppConfig: AppConfig = {
  ...POOL_DEFAULT_FIELDS,
  apiKeyMetadata: {},
  novelRootDir: '',
  recentNovelPaths: [],
  systemNotificationsEnabled: true,
  introVersion: 0,
}

// AgentComposer 底栏的 AgentModelSwitcher（切片②T3）mount 时会拉取 config；window.electron 在
// 真机由 preload 经 contextBridge 注入，测试环境（happy-dom）没有 Electron 进程，只挂这一个
// 出口，其余 ElectronApi 字段本文件用不到，不补全 mock。
;(window as unknown as { electron: Partial<ElectronApi> }).electron = {
  getConfig: (async () => ({ config: stubAppConfig })) as unknown as ElectronApi['getConfig'],
}

type ResizeObserverCallbackLike = (entries: unknown[], observer: unknown) => void

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = []
  readonly callback: ResizeObserverCallbackLike
  observed: Element[] = []

  constructor(callback: ResizeObserverCallbackLike) {
    this.callback = callback
    ResizeObserverStub.instances.push(this)
  }

  observe(element: Element) {
    this.observed.push(element)
  }

  unobserve(element: Element) {
    this.observed = this.observed.filter((observed) => observed !== element)
  }

  disconnect() {
    this.observed = []
  }
}

// Radix ScrollArea 内部也可能实例化 ResizeObserver，统一替换成 stub 后按「observe 的元素
// 是否包含消息内容容器」来定位钉底司机那一只。
const originalResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
HTMLElement.prototype.scrollIntoView = () => {}

const streamingMessage: AgentMessage = {
  id: 'assistant-run-1',
  role: 'assistant',
  createdAt: '2026-07-12T00:00:01.000Z',
  status: 'running',
  parts: [{ id: 'part-1', type: 'text', text: '第一段流式输出。', status: 'running' }],
}

function getContentElement(): Element {
  const anchor = document.querySelector('[data-agent-thread-end="true"]')
  if (!anchor?.parentElement) throw new Error('消息内容容器未渲染')
  return anchor.parentElement
}

function getViewportElement(): HTMLElement {
  const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
  if (!viewport) throw new Error('scroll-area viewport 未渲染')
  return viewport
}

function findContentObserver(content: Element): ResizeObserverStub | undefined {
  return ResizeObserverStub.instances.find((instance) => instance.observed.includes(content))
}

function mockViewportMetrics(viewport: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(viewport, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(viewport, 'clientHeight', { value: clientHeight, configurable: true })
}

beforeEach(() => {
  ResizeObserverStub.instances = []
  useAgentStore.getState().resetAgentState()
})

afterEach(() => {
  cleanup()
})

afterAll(async () => {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView
  await GlobalRegistrator.unregister()
})

describe('对话流贴底跟随（真实 DOM）', () => {
  test('① 空线程 mount 后首条消息出现，钉底司机必须真正 observe 内容容器（dogfood #1 回归）', async () => {
    const view = render(<AgentThreadContent messages={[]} threadId="thread-1" />)

    // 空状态分支：内容容器不存在，任何 observer 都不可能观察到它。
    expect(document.querySelector('[data-agent-thread-end="true"]')).toBeNull()

    await act(async () => {
      view.rerender(<AgentThreadContent messages={[streamingMessage]} threadId="thread-1" />)
    })

    const content = getContentElement()
    expect(findContentObserver(content)).toBeDefined()
  })

  test('② 贴底状态下 observer 回调把 viewport.scrollTop 钉到 scrollHeight', async () => {
    const view = render(<AgentThreadContent messages={[]} threadId="thread-1" />)
    await act(async () => {
      view.rerender(<AgentThreadContent messages={[streamingMessage]} threadId="thread-1" />)
    })

    const viewport = getViewportElement()
    mockViewportMetrics(viewport, { scrollHeight: 1000, clientHeight: 400 })
    viewport.scrollTop = 0

    const observer = findContentObserver(getContentElement())
    if (!observer) throw new Error('钉底 observer 未挂上')
    await act(async () => {
      observer.callback([], observer)
    })

    expect(viewport.scrollTop).toBe(1000)
  })

  test('③ 用户上滑离底后 observer 回调不钉底，只亮「最新」按钮', async () => {
    const view = render(<AgentThreadContent messages={[]} threadId="thread-1" />)
    await act(async () => {
      view.rerender(<AgentThreadContent messages={[streamingMessage]} threadId="thread-1" />)
    })

    const viewport = getViewportElement()
    mockViewportMetrics(viewport, { scrollHeight: 1000, clientHeight: 400 })

    // 用户上滑到离底 500px（阈值 64px 之外）→ shouldStickToBottomRef 翻 false。
    viewport.scrollTop = 100
    await act(async () => {
      fireEvent.scroll(viewport)
    })

    const observer = findContentObserver(getContentElement())
    if (!observer) throw new Error('钉底 observer 未挂上')
    await act(async () => {
      observer.callback([], observer)
    })

    expect(viewport.scrollTop).toBe(100)
    expect(document.querySelector('[data-agent-jump-to-latest="true"]')).not.toBeNull()
  })
})

const interruptedRun: AgentRun = {
  id: 'interrupted-run-1',
  threadId: 'thread-tabs',
  command: 'write-next',
  prompt: '继续写下一章',
  status: 'interrupted',
  startedAt: '2026-07-27T00:00:00.000Z',
  finishedAt: '2026-07-27T00:00:01.000Z',
}

function createInterruptedThread(messages: AgentMessage[]): AgentThread {
  return {
    id: 'thread-tabs',
    messages,
    activeRun: null,
    lastRun: interruptedRun,
  }
}

async function renderInterruptedPanel(thread: AgentThread) {
  useAgentStore.setState({
    activeThreadId: thread.id,
    threadsById: { [thread.id]: thread },
  })
  let view!: ReturnType<typeof render>
  // AgentModelSwitcher（切片②T3）mount 时异步拉取 config；这里用 act 把那次状态更新落进当前
  // act 作用域，避免「An update ... was not wrapped in act(...)」噪声警告。
  await act(async () => {
    view = render(
      <TooltipProvider>
        <MemoryRouter>
          <AgentPanelContent thread={thread} threadId={thread.id} />
        </MemoryRouter>
      </TooltipProvider>,
    )
  })
  return view
}

function getPanelTab(label: '对话' | '进度'): HTMLButtonElement {
  const tab = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (candidate) => candidate.textContent === label,
  )
  if (!tab) throw new Error(`未找到 ${label} tab`)
  return tab
}

describe('Agent 恢复态 Tab（真实 DOM）', () => {
  test('切到进度再返回对话，保留输入框草稿与同一 DOM 节点', async () => {
    const thread = createInterruptedThread([
      {
        id: 'message-1',
        role: 'user',
        createdAt: '2026-07-27T00:00:00.000Z',
        status: 'complete',
        parts: [{ id: 'part-1', type: 'text', text: '继续写下一章', status: 'complete' }],
      },
    ])
    await renderInterruptedPanel(thread)

    const composer = document.querySelector<HTMLDivElement>('[role="textbox"][aria-label="向 Agent 描述任务"]')
    if (!composer) throw new Error('未渲染 Agent 输入框')
    composer.textContent = '保留这段尚未发送的草稿'
    fireEvent.input(composer)

    fireEvent.click(getPanelTab('进度'))
    expect(getPanelTab('进度').getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('[data-agent-panel-view="conversation"]')?.hasAttribute('hidden')).toBe(
      true,
    )

    fireEvent.click(getPanelTab('对话'))
    expect(getPanelTab('对话').getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('[role="textbox"][aria-label="向 Agent 描述任务"]')).toBe(composer)
    expect(composer.textContent).toBe('保留这段尚未发送的草稿')
  })

  test('等待回答通知会从进度切回对话，聚焦问题卡后再清除定位请求', async () => {
    const questionRequestId = 'question-tabs-1'
    const thread = createInterruptedThread([
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: '2026-07-27T00:00:00.000Z',
        status: 'running',
        parts: [
          {
            id: 'question-part-1',
            type: 'question',
            questionRequestId,
            toolCallId: 'tool-question-1',
            questions: [
              {
                header: '推进方式',
                question: '接下来怎么继续？',
                options: [
                  { label: '直接继续', description: '沿用当前方案' },
                  { label: '先调整', description: '先修改方案' },
                ],
              },
            ],
            status: 'running',
          },
        ],
      },
    ])
    await renderInterruptedPanel(thread)
    fireEvent.click(getPanelTab('进度'))

    await act(async () => {
      useAgentStore.getState().focusQuestionRequest(questionRequestId, thread.id)
    })

    await waitFor(() => {
      expect(getPanelTab('对话').getAttribute('aria-selected')).toBe('true')
      expect(useAgentStore.getState().focusedQuestionRequestIdsByThreadId[thread.id]).toBeUndefined()
    })
    expect(document.activeElement).toBe(
      document.querySelector(`[data-agent-question-card="${questionRequestId}"]`),
    )
  })
})
