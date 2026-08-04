/**
 * MemoryHost 进程级单例：worker 路径按本模块产物位置解析（bundle 进 out/main/index.js，
 * 相邻即 memory-worker.js，dev/打包同构）；env 组装对齐 createNovelMemoryServerEnv 的三件
 * （config 路径 / 打包档离线模型 / 用户能力包目录）+ core 入口。App 退出时 Electron 自动回收
 * utilityProcess 子进程，无需显式钩子。
 */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { resolveEmbeddingModelPath } from '../engine/embedding-model.ts'
import { resolveNarraCatAgentCorePath } from '../engine/engine.ts'
import { resolveMemoryEngineEntries } from '../engine/memory-core-entries.ts'
import { userPacksDir } from '../packs/pack-store.ts'
import { createMemoryHost } from './memory-host.ts'
import type { MemoryHost, MemoryWorkerProfile } from './memory-host.ts'

export interface MemoryHostPaths {
  appRoot: string
  resourcesPath?: string
  userDataPath?: string
  agentCorePath: string
}

export function buildMemoryWorkerEnv(
  projectPath: string,
  paths: MemoryHostPaths,
  profile: MemoryWorkerProfile = 'default',
): Record<string, string> {
  const memoryEntries = resolveMemoryEngineEntries(paths.agentCorePath)
  const env: Record<string, string> = {
    NARRACAT_MEMORY_CORE_ENTRY: memoryEntries.coreEntry,
    NOVEL_CONFIG_PATH: join(projectPath, '.narracat', 'config.yaml'),
  }
  const embeddingModelPath = resolveEmbeddingModelPath({ appRoot: paths.appRoot, resourcesPath: paths.resourcesPath })
  if (embeddingModelPath) env.NARRACAT_EMBEDDING_MODEL_PATH = embeddingModelPath
  if (paths.userDataPath) env.NARRACAT_USER_PACKS_DIR = userPacksDir(paths.userDataPath)
  // 聊天只读代理档（拆旧刀3）：滤网是进程级 env 语义，档位独立 worker，见 memory-host.ts 头注
  if (profile === 'chat-secret-filter') env.NARRACAT_CHAT_SECRET_FILTER = '1'
  return env
}

/** App 直调面（立项卡/大纲/角色状态等）的便捷入口：agentCorePath 就地解析（拆旧刀3）。 */
export interface EngineCallPaths {
  appRoot: string
  resourcesPath?: string
  userDataPath?: string
}

export function getMemoryHostFor(paths: EngineCallPaths): MemoryHost {
  return getMemoryHost({ ...paths, agentCorePath: resolveNarraCatAgentCorePath(paths) })
}

let singleton: MemoryHost | undefined

export function getMemoryHost(paths: MemoryHostPaths): MemoryHost {
  if (!singleton) {
    singleton = createMemoryHost({
      resolveWorkerModulePath: () => fileURLToPath(new URL('./memory-worker.js', import.meta.url)),
      buildEnv: (projectPath, profile) => buildMemoryWorkerEnv(projectPath, paths, profile),
    })
  }
  return singleton
}
