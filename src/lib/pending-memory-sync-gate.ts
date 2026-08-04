import type { ConfirmDialogCopy } from '@/components/ui/confirm-dialog'

/**
 * 写作流开跑前的「记忆待同步」拦截（ADR-0031 follow-up，A2）：
 * 存在待同步章时提醒作者——直接开写，Agent 会带着旧记忆规划新章。
 * 纯函数产出确认文案，交 ConfirmDialog（#400；先例：WorkbenchStage 重新分析确认）。
 */
export function buildPendingSyncWriteWarning(
  command: string | undefined,
  map: Record<string, unknown>,
): string | null {
  if (command !== 'write-next') return null
  const chapters = Object.keys(map)
    .map(Number)
    .filter((chapter) => Number.isInteger(chapter) && chapter > 0)
    .sort((left, right) => left - right)
  if (chapters.length === 0) return null
  return `第 ${chapters.join('、')} 章的正文修改尚未同步记忆，直接开写新章，Agent 可能用旧记忆规划剧情。可以先到对应章节同步记忆，再来写下一章。`
}

/** 「记忆待同步」的确认弹窗文案（WorkbenchStage / AgentComposer 共用，#400）：不丢数据，可取消后先同步。 */
export function buildPendingSyncWriteConfirm(message: string): ConfirmDialogCopy {
  return {
    title: '正文修改还没同步记忆',
    description: message,
    confirmLabel: '仍要开写',
  }
}
