/**
 * NovelMemory utilityProcess worker 入口（electron-vite 独立 entry，产物 out/main/memory-worker.js）。
 * 跑在 Electron utilityProcess（Node 环境）内：动态加载引擎 core dist + 注入根 node_modules 的
 * Electron-ABI better-sqlite3。禁止 import 'electron'（utilityProcess 无渲染面），只用 process.parentPort。
 */
import Database from 'better-sqlite3'
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MEMORY_EMBEDDING_SELFTEST_TOOL } from '@shared/types/memory-rpc'
import type { MemoryWorkerOutbound } from '@shared/types/memory-rpc'
import { createConfigWatchingContextProvider } from './memory-context-provider.ts'
import { createMemoryWorkerRuntime } from './memory-worker-runtime.ts'
import type { ToolContext } from './memory-core-module.ts'
import type { MemoryCoreModule } from './memory-core-module.ts'

const port = process.parentPort
if (!port) throw new Error('memory-worker 必须运行在 Electron utilityProcess 内（process.parentPort 缺失）')

function post(message: MemoryWorkerOutbound): void {
  port.postMessage(message)
}

async function boot(): Promise<void> {
  const coreEntry = process.env.NARRACAT_MEMORY_CORE_ENTRY
  const configPath = process.env.NOVEL_CONFIG_PATH
  if (!coreEntry || !configPath) {
    throw new Error('memory-worker 缺少 NARRACAT_MEMORY_CORE_ENTRY / NOVEL_CONFIG_PATH 环境变量')
  }
  const core = (await import(pathToFileURL(coreEntry).href)) as MemoryCoreModule
  // 不用引擎 createLazyToolRunner（缓存到进程死）：长驻 worker 下 config.yaml 会被 setup 等流程
  // 更新，按 mtime 失效重建上下文（见 memory-context-provider.ts 头注的根因记录）。
  const getContext = createConfigWatchingContextProvider<ToolContext>({
    statMtimeMs: () => {
      try {
        return statSync(configPath).mtimeMs
      } catch {
        return 0
      }
    },
    createContext: async () => {
      const ctx = await core.createToolContext({ configPath, sqliteDriver: Database })
      // 与 MCP stdio 壳同语义：契约 backfill 在首次工具调用返回前完成（向量 backfill 在其内部后台跑）
      await core.runStartupBackfills(ctx)
      return ctx
    },
    closeContext: (ctx) => {
      ;(ctx as { db?: { close?: () => void } }).db?.close?.()
    },
  })
  const runtime = createMemoryWorkerRuntime({
    runTool: async (name, args) => {
      // worker 级伪工具（拆旧刀5 前置）：embedding 自检进程内直调，sqlite 注入根 N-API 驱动
      //（引擎自带 node-ABI 驱动在本进程 DLOPEN 必败）；不触碰工具上下文（无需 config.yaml 存在）。
      if (name === MEMORY_EMBEDDING_SELFTEST_TOOL) {
        const selftestEntry = join(dirname(coreEntry), 'embedding-selftest.js')
        const selftest = (await import(pathToFileURL(selftestEntry).href)) as {
          runEmbeddingSelfTest(options?: { createDatabase?: () => unknown }): Promise<unknown>
        }
        const report = await selftest.runEmbeddingSelfTest({ createDatabase: () => new Database(':memory:') })
        return { text: JSON.stringify(report), isError: false }
      }
      return core.runTool(name, args, getContext)
    },
  })
  port.on('message', (event) => {
    void runtime.handleMessage(event.data).then((outbound) => {
      if (outbound) post(outbound)
    })
  })
  post({ type: 'ready' })
}

boot().catch((error) => {
  post({ type: 'fatal', error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
