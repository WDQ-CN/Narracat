import { useEffect, useState } from 'react'
import { listManuscriptDrafts } from './ipc'
import type { ManuscriptDraftSummary } from '@shared/types/manuscript-draft'

/** 拉取项目内恢复草稿清单；正文 debounce / 保存 / 放弃后由 draftVersion 触发重拉。 */
export function useManuscriptDrafts(
  projectPath: string | undefined,
  refreshKey: unknown,
): ManuscriptDraftSummary[] {
  const [drafts, setDrafts] = useState<ManuscriptDraftSummary[]>([])

  useEffect(() => {
    if (!projectPath) {
      setDrafts([])
      return
    }
    let cancelled = false
    listManuscriptDrafts(projectPath)
      .then((next) => {
        if (!cancelled) setDrafts(next)
      })
      // 扫描失败不是“没有草稿”。保留 last-good 徽标；真正启动 Agent 时还会重新查询并 fail closed。
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [projectPath, refreshKey])

  return drafts
}
