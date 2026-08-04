/**
 * NovelMemory utilityProcess 宿主管理器：每小说项目一个长驻 worker（对齐「每 run 一个 mcp-server
 * 进程绑一个项目」的既有隔离直觉，上游 spec 已拍板），惰性 fork、复用、崩溃后下次调用重连。
 * electron 依赖走懒 import（默认 fork 实现里），本模块可被 bun test 以 DI 假进程直测。
 */
import type { MemoryToolCallResult, MemoryWorkerOutbound } from '@shared/types/memory-rpc'

export interface MemoryWorkerProcessLike {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  kill(): boolean
}

/** worker 档位（拆旧刀3）：chat-secret-filter = 聊天只读代理档，env 注入 NARRACAT_CHAT_SECRET_FILTER=1
 * （引擎 core 从 env 落入 context，未打标「本人已知晓」的 secret 事实对模型不可见）。滤网是进程级
 * env 语义，与默认档共用一个 worker 会互相污染——按（项目, 档位）双键各持进程。 */
export type MemoryWorkerProfile = 'default' | 'chat-secret-filter'

export interface CreateMemoryHostArgs {
  resolveWorkerModulePath(): string
  /** 按项目+档位组装 worker env（NOVEL_CONFIG_PATH / NARRACAT_MEMORY_CORE_ENTRY / 模型与用户包目录） */
  buildEnv(projectPath: string, profile: MemoryWorkerProfile): Record<string, string>
  /** DI 缝：缺省用 electron utilityProcess.fork（懒 import） */
  fork?(modulePath: string, env: Record<string, string>): Promise<MemoryWorkerProcessLike>
}

export interface MemoryToolCallOptions {
  /** 调用方（pi 工具 execute）的取消信号：abort 即解除等待 reject；worker 侧该次调用会继续跑完，
   * 结果按未知 id 丢弃（协议无 per-call 取消，已记录残留）。 */
  signal?: AbortSignal
  /** 每调用超时毫秒数，缺省 DEFAULT_TOOL_CALL_TIMEOUT_MS。 */
  timeoutMs?: number
  /** worker 档位，缺省 'default'。 */
  profile?: MemoryWorkerProfile
}

export interface MemoryHost {
  callTool(
    projectPath: string,
    tool: string,
    args: Record<string, unknown>,
    options?: MemoryToolCallOptions,
  ): Promise<MemoryToolCallResult>
  shutdown(): void
}

/** 每调用超时兜底（生产接线门前项④）：此前工具调用挂起只能靠 run 层 30min 空闲看门狗收尸，
 * 单调用维度收紧到 2min——放得下 embedding 首载+大批量检索，接不住的属真挂起该 fail-loud。 */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 120_000

async function forkUtilityProcess(modulePath: string, env: Record<string, string>): Promise<MemoryWorkerProcessLike> {
  const { utilityProcess } = await import('electron')
  return utilityProcess.fork(modulePath, [], {
    serviceName: 'narracat-memory',
    env: { ...(process.env as Record<string, string>), ...env },
  }) as unknown as MemoryWorkerProcessLike
}

interface WorkerEntry {
  worker: Promise<MemoryWorkerProcessLike>
  /** 一旦 attachListeners 跑过（即 worker 可用）就同步登记，供 shutdown() 同步 kill——`.then()` 的
   * 反应永远异步触发（即便 promise 已 fulfilled 也要等一次 microtask），若 shutdown() 只靠
   * `entry.worker.then(kill)`，调用方在同一同步轮次内检查是否已 kill 会看到假象（未 await 直接
   * 断言的用例会失败）。 */
  workerRef?: MemoryWorkerProcessLike
  ready: Promise<void>
  pending: Map<number, { resolve(result: MemoryToolCallResult): void; reject(error: Error): void }>
  nextId: number
  alive: boolean
}

export function createMemoryHost(args: CreateMemoryHostArgs): MemoryHost {
  const fork = args.fork ?? forkUtilityProcess
  const entries = new Map<string, WorkerEntry>()

  function spawn(projectPath: string, profile: MemoryWorkerProfile, key: string): WorkerEntry {
    const entry: WorkerEntry = {
      worker: undefined as unknown as Promise<MemoryWorkerProcessLike>,
      ready: undefined as unknown as Promise<void>,
      pending: new Map(),
      nextId: 0,
      alive: true,
    }
    let readyResolve!: () => void
    let readyReject!: (error: Error) => void
    entry.ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject
    })
    // ready 可能在无人 await 前就 reject（fatal/exit 竞态）；挂个空 catch 防未处理 rejection
    entry.ready.catch(() => {})

    const fail = (error: Error) => {
      entry.alive = false
      readyReject(error)
      for (const { reject } of entry.pending.values()) reject(error)
      entry.pending.clear()
      if (entries.get(key) === entry) entries.delete(key)
    }

    const attachListeners = (worker: MemoryWorkerProcessLike): MemoryWorkerProcessLike => {
      entry.workerRef = worker
      worker.on('message', (raw) => {
        const message = raw as MemoryWorkerOutbound
        if (message.type === 'ready') return readyResolve()
        if (message.type === 'fatal') return fail(new Error(`记忆引擎启动失败：${message.error}`))
        const waiter = entry.pending.get(message.id)
        if (!waiter) return
        entry.pending.delete(message.id)
        if (message.type === 'tool-result') waiter.resolve({ text: message.text, isError: message.isError })
        else waiter.reject(new Error(message.error))
      })
      worker.on('exit', (code) => fail(new Error(`记忆引擎进程已退出（code ${code}）`)))
      return worker
    }

    entry.worker = fork(args.resolveWorkerModulePath(), args.buildEnv(projectPath, profile)).then(attachListeners)
    entry.worker.catch((error: unknown) => fail(error instanceof Error ? error : new Error(String(error))))
    entries.set(key, entry)
    return entry
  }

  return {
    async callTool(projectPath, tool, toolArgs, options = {}) {
      if (options.signal?.aborted) throw new Error('记忆工具调用已取消')
      const profile = options.profile ?? 'default'
      const key = `${profile}\n${projectPath}`
      const entry = entries.get(key) ?? spawn(projectPath, profile, key)
      const worker = await entry.worker
      await entry.ready
      // await 让出的两次 microtask 窗口内，worker 可能已 exit/fatal：fail() 会清空 pending 并把 entry
      // 逐出 map，若这里不查 alive 直接注册 waiter，promise 将无人 resolve/reject（对死进程
      // postMessage 是 no-op），只能靠上层 30min 空闲看门狗兜底——改为立即 reject，与 exit 路径同风格。
      if (!entry.alive) throw new Error('记忆引擎进程已退出，取消本次调用')
      const id = ++entry.nextId
      const result = new Promise<MemoryToolCallResult>((resolve, reject) => {
        // 取消/超时都只解除等待并从 pending 摘号：worker 侧调用继续跑完，回包按未知 id 丢弃
        // （message 处理器的 `if (!waiter) return` 分支），协议零改动。
        const settle = (fn: () => void) => {
          entry.pending.delete(id)
          clearTimeout(timer)
          options.signal?.removeEventListener('abort', onAbort)
          fn()
        }
        const onAbort = () => settle(() => reject(new Error('记忆工具调用已取消')))
        const timeoutMs = options.timeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS
        const timer = setTimeout(
          () => settle(() => reject(new Error(`记忆工具调用超时（${Math.round(timeoutMs / 1000)}s）：${tool}`))),
          timeoutMs,
        )
        options.signal?.addEventListener('abort', onAbort, { once: true })
        entry.pending.set(id, {
          resolve: (value) => settle(() => resolve(value)),
          reject: (error) => settle(() => reject(error)),
        })
      })
      worker.postMessage({ type: 'tool-call', id, tool, args: toolArgs })
      return result
    },
    shutdown() {
      for (const entry of entries.values()) {
        if (entry.workerRef) entry.workerRef.kill()
        else void entry.worker.then((worker) => worker.kill()).catch(() => {})
      }
      entries.clear()
    },
  }
}
