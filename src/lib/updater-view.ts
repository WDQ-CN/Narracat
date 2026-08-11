import type { UpdaterState } from '@shared/types/ipc'

export type UpdateAction = 'check' | 'install' | 'none'

export interface UpdateStatusView {
  text: string
  action: UpdateAction
  actionLabel: string
}

/**
 * 状态 → 文案与按钮。渲染端展示判定的唯一落点，组件不得另写一份。
 * 失败只在用户手动点过按钮时才显示（后台自动检查失败一律静默，见 spec §5.2）。
 */
export function describeUpdateStatus(state: UpdaterState): UpdateStatusView {
  switch (state.status) {
    case 'checking':
      return { text: '正在检查…', action: 'none', actionLabel: '检查更新' }
    case 'downloading':
      return { text: `正在下载 ${state.percent}%`, action: 'none', actionLabel: '检查更新' }
    case 'ready':
      return {
        text: `${state.availableVersion ?? ''} 已就绪，重启生效`.trim(),
        action: 'install',
        actionLabel: '立即重启',
      }
    case 'error':
      return state.manual
        ? { text: '检查失败，请稍后再试', action: 'check', actionLabel: '检查更新' }
        : { text: '已是最新', action: 'check', actionLabel: '检查更新' }
    case 'idle':
      return { text: '已是最新', action: 'check', actionLabel: '检查更新' }
  }
}

/** 全局提示（单行浮层 banner，spec §6.1）：只在「已就绪」且没在跑 Agent 时显示。 */
export function shouldShowUpdateBadge(input: { state: UpdaterState; hasActiveRuns: boolean }): boolean {
  return input.state.status === 'ready' && !input.hasActiveRuns
}
