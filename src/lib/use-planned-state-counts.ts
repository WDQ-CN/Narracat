import { useEffect, useState } from 'react'
import { readPlannedStateCounts } from './ipc'
import type { PlannedStateCounts } from '@shared/types/planned-state'

/**
 * usePlannedStateCounts 的完整 effect 体（projectPath 缺失回落 / 拉取写回 / 报错静默回落空映射 /
 * cleanup 取消防晚到写回），抽成可注入 setCounts 的独立函数是为了不依赖真实 DOM 也能对整条链路
 * 做真行为单测（本仓 happy-dom + @testing-library/react 的真实 DOM 测试目前只安全共存 2 个文件，
 * 见 use-planned-state-counts.test.ts 顶部注释）。返回值就是 useEffect 的 cleanup：调用后标记
 * 取消，之后才落定的拉取结果不再写回。
 */
export function runPlannedStateCountsEffect(
  projectPath: string | undefined,
  setCounts: (next: PlannedStateCounts) => void,
): (() => void) | undefined {
  if (!projectPath) {
    setCounts({})
    return undefined
  }
  let cancelled = false
  readPlannedStateCounts({ projectPath })
    .then((next) => {
      if (!cancelled) setCounts(next)
    })
    .catch(() => {
      if (!cancelled) setCounts({})
    })
  return () => {
    cancelled = true
  }
}

/** 拉取该项目「计划状态变更」按章计数映射；reloadKey 变化（如 agent run 结束、保存后）重拉。 */
export function usePlannedStateCounts(projectPath: string | undefined, reloadKey: unknown): PlannedStateCounts {
  const [counts, setCounts] = useState<PlannedStateCounts>({})

  useEffect(() => runPlannedStateCountsEffect(projectPath, setCounts), [projectPath, reloadKey])

  return counts
}
