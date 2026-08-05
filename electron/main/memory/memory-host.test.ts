import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { resolveNarraCatAgentCorePath } from '../engine/engine.ts'
import type { MemoryWorkerProcessLike } from './memory-host.ts'
import { createMemoryHost } from './memory-host.ts'
import { buildMemoryWorkerEnv } from './index.ts'
import type { MemoryHostPaths } from './index.ts'

interface FakeWorker extends MemoryWorkerProcessLike {
  sent: unknown[]
  emit(event: 'message' | 'exit', payload: unknown): void
  env: Record<string, string>
}

function makeFakeWorker(env: Record<string, string>): FakeWorker {
  const listeners = new Map<string, Array<(payload: unknown) => void>>()
  return {
    sent: [],
    env,
    postMessage(message: unknown) {
      this.sent.push(message)
    },
    on(event: string, listener: (payload: never) => void) {
      const list = listeners.get(event) ?? []
      list.push(listener as (payload: unknown) => void)
      listeners.set(event, list)
      return this
    },
    kill: () => true,
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    },
  }
}

function makeHost() {
  const workers: FakeWorker[] = []
  const host = createMemoryHost({
    resolveWorkerModulePath: () => '/out/main/memory-worker.js',
    buildEnv: (projectPath, profile) => ({
      NOVEL_CONFIG_PATH: `${projectPath}/.narracat/config.yaml`,
      ...(profile === 'chat-secret-filter' ? { NARRACAT_CHAT_SECRET_FILTER: '1' } : {}),
    }),
    fork: async (_modulePath, env) => {
      const worker = makeFakeWorker(env)
      workers.push(worker)
      // 嵌套两层 queueMicrotask（而非单层）：host.spawn() 对 fork() 返回值的 `.then(attachListeners)`
      // 只需等 fork() 落定后的 1 个 microtask 轮次即可挂上监听器；这里派发 emit 前特意多等一轮，
      // 确保 emit 排在监听器挂好之后触发，不然 fake 在 fork() 尚未返回前就同步入队的单层
      // queueMicrotask 会抢在 `.then()` 反应前执行，emit 时无人监听、消息丢失（已用独立复现脚本验证：
      // 单层 queueMicrotask 及一到三次 `await Promise.resolve()` 均不足以让监听器先挂上，只有再嵌套
      // 一层 queueMicrotask 才稳定生效）。
      queueMicrotask(() => queueMicrotask(() => worker.emit('message', { type: 'ready' })))
      return worker
    },
  })
  return { host, workers }
}

describe('createMemoryHost', () => {
  it('同项目复用一个 worker，不同项目各起一个（env 各绑各的 config）', async () => {
    const { host, workers } = makeHost()
    const call = (project: string, id: string) => {
      const promise = host.callTool(project, 'novel_query', { query: id })
      return promise
    }
    const p1 = call('/novels/a', '1')
    await Bun.sleep(0)
    workers[0].emit('message', { type: 'tool-result', id: (workers[0].sent[0] as { id: number }).id, text: 'r1', isError: false })
    await p1
    const p2 = call('/novels/a', '2')
    await Bun.sleep(0)
    workers[0].emit('message', { type: 'tool-result', id: (workers[0].sent[1] as { id: number }).id, text: 'r2', isError: false })
    await p2
    const p3 = call('/novels/b', '3')
    await Bun.sleep(0)
    workers[1].emit('message', { type: 'tool-result', id: (workers[1].sent[0] as { id: number }).id, text: 'r3', isError: false })
    await p3
    expect(workers).toHaveLength(2)
    expect(workers[0].env.NOVEL_CONFIG_PATH).toBe('/novels/a/.narracat/config.yaml')
    expect(workers[1].env.NOVEL_CONFIG_PATH).toBe('/novels/b/.narracat/config.yaml')
  })

  it('同项目不同档位各起一个 worker：chat-secret-filter 档 env 带滤网，默认档不带（拆旧刀3）', async () => {
    const { host, workers } = makeHost()
    const p1 = host.callTool('/novels/a', 'novel_query', { query: '1' })
    await Bun.sleep(0)
    workers[0].emit('message', { type: 'tool-result', id: (workers[0].sent[0] as { id: number }).id, text: 'r1', isError: false })
    await p1

    const p2 = host.callTool('/novels/a', 'novel_character_state', {}, { profile: 'chat-secret-filter' })
    await Bun.sleep(0)
    expect(workers).toHaveLength(2)
    workers[1].emit('message', { type: 'tool-result', id: (workers[1].sent[0] as { id: number }).id, text: 'r2', isError: false })
    await p2

    expect(workers[0].env.NARRACAT_CHAT_SECRET_FILTER).toBeUndefined()
    expect(workers[1].env.NARRACAT_CHAT_SECRET_FILTER).toBe('1')
    expect(workers[1].env.NOVEL_CONFIG_PATH).toBe('/novels/a/.narracat/config.yaml')

    // 同档位复用：再调 chat 档不再新 fork
    const p3 = host.callTool('/novels/a', 'novel_query', {}, { profile: 'chat-secret-filter' })
    await Bun.sleep(0)
    expect(workers).toHaveLength(2)
    workers[1].emit('message', { type: 'tool-result', id: (workers[1].sent[1] as { id: number }).id, text: 'r3', isError: false })
    await p3
  })

  it('按 id 路由响应（乱序返回不串号）', async () => {
    const { host, workers } = makeHost()
    const p1 = host.callTool('/novels/a', 'novel_query', { query: '1' })
    const p2 = host.callTool('/novels/a', 'novel_query', { query: '2' })
    await Bun.sleep(0)
    const [m1, m2] = workers[0].sent as Array<{ id: number }>
    workers[0].emit('message', { type: 'tool-result', id: m2.id, text: 'second', isError: false })
    workers[0].emit('message', { type: 'tool-result', id: m1.id, text: 'first', isError: true })
    expect(await p2).toEqual({ text: 'second', isError: false })
    expect(await p1).toEqual({ text: 'first', isError: true })
  })

  it('tool-failure → reject', async () => {
    const { host, workers } = makeHost()
    const p = host.callTool('/novels/a', 'novel_query', {})
    await Bun.sleep(0)
    workers[0].emit('message', { type: 'tool-failure', id: (workers[0].sent[0] as { id: number }).id, error: 'boom' })
    await expect(p).rejects.toThrow('boom')
  })

  it('worker exit → 在途调用全部 reject，下次调用重新 fork', async () => {
    const { host, workers } = makeHost()
    const p = host.callTool('/novels/a', 'novel_query', {})
    await Bun.sleep(0)
    workers[0].emit('exit', 1)
    await expect(p).rejects.toThrow(/退出/)
    const p2 = host.callTool('/novels/a', 'novel_query', {})
    await Bun.sleep(0)
    expect(workers).toHaveLength(2)
    workers[1].emit('message', { type: 'tool-result', id: (workers[1].sent[0] as { id: number }).id, text: 'ok', isError: false })
    await p2
  })

  it('fatal → ready 前的调用 reject，进程被弃用', async () => {
    const workers: FakeWorker[] = []
    const host = createMemoryHost({
      resolveWorkerModulePath: () => '/w.js',
      buildEnv: () => ({}),
      fork: async (_m, env) => {
        const worker = makeFakeWorker(env)
        workers.push(worker)
        // 同 makeHost() 里的说明：嵌套两层，确保 fatal 消息排在 attachListeners 挂好监听器之后触发。
        queueMicrotask(() => queueMicrotask(() => worker.emit('message', { type: 'fatal', error: 'core 加载失败' })))
        return worker
      },
    })
    await expect(host.callTool('/novels/a', 'novel_query', {})).rejects.toThrow(/core 加载失败/)
  })

  it('ready 与 postMessage 之间的崩溃窗：exit 抢在 await entry.ready 续体前发生也不永挂', async () => {
    // 复现 callTool 里 `await entry.worker; await entry.ready;` 两次让出 microtask 之间的崩溃窗：
    // ready 消息触发 readyResolve() 后，callTool 的续体要等一个额外 microtask 才能恢复执行；
    // 若在这个窗口内同步紧接着 emit exit，fail() 会先于续体跑完（清 pending、把 entry 逐出 map）。
    // 没有 alive 检查时，续体会把 waiter 注册进已死 entry 的 pending、对死进程 postMessage（no-op），
    // 该 promise 永无 resolve/reject——本用例断言此时应立即 reject，而非挂起。
    const workers: FakeWorker[] = []
    const host = createMemoryHost({
      resolveWorkerModulePath: () => '/w.js',
      buildEnv: () => ({}),
      fork: async (_m, env) => {
        const worker = makeFakeWorker(env)
        workers.push(worker)
        queueMicrotask(() =>
          queueMicrotask(() => {
            worker.emit('message', { type: 'ready' })
            worker.emit('exit', 1)
          })
        )
        return worker
      },
    })
    await expect(host.callTool('/novels/a', 'novel_query', {})).rejects.toThrow(/退出/)
  })

  it('每调用超时（门前项④）：超时后 reject 且摘号，迟到回包按未知 id 丢弃不炸', async () => {
    const { host, workers } = makeHost()
    const p = host.callTool('/novels/a', 'novel_query', {}, { timeoutMs: 5 })
    await expect(p).rejects.toThrow(/超时/)
    // 迟到回包：pending 已摘号，`if (!waiter) return` 分支静默丢弃
    const sent = workers[0].sent[0] as { id: number }
    expect(() =>
      workers[0].emit('message', { type: 'tool-result', id: sent.id, text: 'late', isError: false }),
    ).not.toThrow()
  })

  it('AbortSignal 取消（门前项④）：abort 即解除等待 reject；已 aborted 的 signal 直接拒绝不发 RPC', async () => {
    const { host, workers } = makeHost()
    const abortController = new AbortController()
    const p = host.callTool('/novels/a', 'novel_query', {}, { signal: abortController.signal })
    await Bun.sleep(0)
    abortController.abort()
    await expect(p).rejects.toThrow(/已取消/)

    const aborted = new AbortController()
    aborted.abort()
    const sentBefore = workers[0].sent.length
    await expect(host.callTool('/novels/a', 'novel_query', {}, { signal: aborted.signal })).rejects.toThrow(/已取消/)
    expect(workers[0].sent.length).toBe(sentBefore)
  })

  it('正常回包会清掉超时定时器（结果照常返回）', async () => {
    const { host, workers } = makeHost()
    const p = host.callTool('/novels/a', 'novel_query', {}, { timeoutMs: 60_000 })
    await Bun.sleep(0)
    workers[0].emit('message', { type: 'tool-result', id: (workers[0].sent[0] as { id: number }).id, text: 'ok', isError: false })
    await expect(p).resolves.toEqual({ text: 'ok', isError: false })
  })

  it('shutdown kill 所有 worker', async () => {
    const { host, workers } = makeHost()
    const p = host.callTool('/novels/a', 'novel_query', {})
    await Bun.sleep(0)
    workers[0].emit('message', { type: 'tool-result', id: (workers[0].sent[0] as { id: number }).id, text: 'ok', isError: false })
    await p
    let killed = false
    workers[0].kill = () => {
      killed = true
      return true
    }
    host.shutdown()
    expect(killed).toBe(true)
  })
})

describe('buildMemoryWorkerEnv 语料服务 env 透传', () => {
  const paths: MemoryHostPaths = {
    appRoot: process.cwd(),
    agentCorePath: resolveNarraCatAgentCorePath({ appRoot: process.cwd() }),
  }

  // 宿主 shell/.env 若已配置 NARRACAT_CORPUS_*（.env.example 正引导维护者这么做），
  // 会泄入本文件的 process.env 读取——stubEnv 覆盖不了「本来就有值」，须显式保存并清空。
  const CORPUS_ENV_KEYS = ['NARRACAT_CORPUS_TOKEN', 'NARRACAT_CORPUS_URL', 'NARRACAT_CORPUS_DIR'] as const
  const savedCorpusEnv: Partial<Record<(typeof CORPUS_ENV_KEYS)[number], string>> = {}

  beforeEach(() => {
    for (const key of CORPUS_ENV_KEYS) {
      if (process.env[key] !== undefined) savedCorpusEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of CORPUS_ENV_KEYS) {
      if (savedCorpusEnv[key] !== undefined) process.env[key] = savedCorpusEnv[key]
      else delete process.env[key]
      delete savedCorpusEnv[key]
    }
  })

  it('语料服务 env 透传：有 token 时注入 NARRACAT_CORPUS_TOKEN，URL/DIR 跟随 env', () => {
    process.env.NARRACAT_CORPUS_TOKEN = 'tok-x'
    process.env.NARRACAT_CORPUS_URL = 'http://localhost:8787'
    const env = buildMemoryWorkerEnv('/novels/a', paths)
    expect(env.NARRACAT_CORPUS_TOKEN).toBe('tok-x')
    expect(env.NARRACAT_CORPUS_URL).toBe('http://localhost:8787')
  })

  it('无 token 无 dir 时不注入语料 env（fork 默认态干净）', () => {
    const env = buildMemoryWorkerEnv('/novels/a', paths)
    expect(env.NARRACAT_CORPUS_TOKEN).toBeUndefined()
    expect(env.NARRACAT_CORPUS_URL).toBeUndefined()
    expect(env.NARRACAT_CORPUS_DIR).toBeUndefined()
  })
})
