/**
 * NovelMemory core/tools 入口解析：消费 narracat.manifest.json 的 mcpServer.coreEntry/toolsEntry
 * （切片⑥引入，终结该段死字段状态）。字段缺失或文件不存在一律 fail-loud——静默回退硬编码路径
 * 会让 manifest 漂移永远查不出来。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface MemoryEngineEntries {
  coreEntry: string
  toolsEntry: string
}

export function resolveMemoryEngineEntries(agentCorePath: string): MemoryEngineEntries {
  const manifestPath = join(agentCorePath, 'narracat.manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    mcpServer?: { coreEntry?: unknown; toolsEntry?: unknown }
  }
  const resolveEntry = (field: 'coreEntry' | 'toolsEntry'): string => {
    const relative = manifest.mcpServer?.[field]
    if (typeof relative !== 'string' || !relative) {
      throw new Error(`引擎清单 ${manifestPath} 缺少 mcpServer.${field}（需要引擎 ≥4.0.155）`)
    }
    const absolute = join(agentCorePath, relative)
    if (!existsSync(absolute)) throw new Error(`引擎 NovelMemory 入口不存在：${absolute}`)
    return absolute
  }
  return { coreEntry: resolveEntry('coreEntry'), toolsEntry: resolveEntry('toolsEntry') }
}
