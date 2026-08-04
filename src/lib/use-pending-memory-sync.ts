import { useEffect, useState } from 'react'
import { getPendingMemorySync } from './ipc'
import type { PendingMemorySyncEntry } from '@shared/types/ipc'

/** 拉取该项目「记忆待同步」章号映射；refreshKey 变化（如 agent run 结束、保存后）重拉。 */
export function usePendingMemorySyncMap(
  projectPath: string | undefined,
  refreshKey: unknown,
): Record<string, PendingMemorySyncEntry> {
  const [map, setMap] = useState<Record<string, PendingMemorySyncEntry>>({})

  useEffect(() => {
    if (!projectPath) {
      setMap({})
      return
    }
    let cancelled = false
    getPendingMemorySync(projectPath)
      .then((next) => {
        if (!cancelled) setMap(next)
      })
      // 加载失败不是“没有待同步章”。保留 last-good，避免瞬时 I/O 故障清空可见提醒。
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [projectPath, refreshKey])

  return map
}
