import { useEffect, useState } from 'react'
import { readMemoryGraph } from './ipc'
import type { MemoryGraphSnapshot } from '@shared/types/memory-graph'

/**
 * 记忆星图取数。effect 体抽成可注入 setState 的独立函数，是为了不依赖真实 DOM 也能对
 * 整条链路做真行为单测（照 use-planned-state-counts.ts 先例）。返回值就是 useEffect 的
 * cleanup：调用后标记取消，之后才落定的拉取结果不再写回。
 */

export interface MemoryGraphState {
  graph: MemoryGraphSnapshot
  loading: boolean
}

const EMPTY_STATE: MemoryGraphState = { graph: { nodes: [], links: [] }, loading: false }

export function runMemoryGraphEffect(
  projectPath: string | undefined,
  setState: (next: MemoryGraphState | ((previous: MemoryGraphState) => MemoryGraphState)) => void,
): (() => void) | undefined {
  if (!projectPath) {
    setState(EMPTY_STATE)
    return undefined
  }
  // reloadKey 变化重拉时（如 agent run 结束），保留上一次的 graph 只把 loading 翻回 true——
  // 星图刷新是「正在刷新」不是「清空重来」，不该先闪空再填回。这行必须留在这个可被直接调用的
  // 函数里（而不是留在 useEffect 体内），才能被 use-memory-graph.test.ts 的真行为测试守住：
  // 见该文件「re-running ... flips loading back to true」用例——独立评审 fix round 1 抓出的
  // 缺口就是这行原来只写在 hook 里、没有任何测试执行到它。
  setState((previous) => ({ ...previous, loading: true }))
  let cancelled = false
  readMemoryGraph({ projectPath })
    .then((graph) => {
      if (!cancelled) setState({ graph, loading: false })
    })
    .catch(() => {
      if (!cancelled) setState(EMPTY_STATE)
    })
  return () => {
    cancelled = true
  }
}

/**
 * 拉取该项目的记忆星图快照；reloadKey 变化（如 agent run 结束）重拉。
 * 初始 loading 跟着「有没有项目路径」走——没有路径就没有在读的东西，恒为 false，
 * 否则静态渲染（effect 不执行）时空态会一直卡在「正在点亮星图」。
 */
export function useMemoryGraph(projectPath: string | undefined, reloadKey: unknown): MemoryGraphState {
  const [state, setState] = useState<MemoryGraphState>({
    graph: { nodes: [], links: [] },
    loading: Boolean(projectPath),
  })

  useEffect(() => runMemoryGraphEffect(projectPath, setState), [projectPath, reloadKey])

  return state
}
