import type { ConfirmDialogCopy } from '@/components/ui/confirm-dialog'

/**
 * 参考作品相关危险操作的确认弹窗文案（#400）。
 * 收敛为唯一来源：重置参考在 WorkbenchStage 与 ReferenceWorksView 各有入口，共用同一份文案。
 * 后果依据 electron/main/novel/reference-works.ts：均为直接删文件（rm/unlink），不进废纸篓。
 */

export const RESET_REFERENCE_WORKS_CONFIRM: ConfirmDialogCopy = {
  title: '重置参考作品',
  description: '会删除全部参考来源和已生成的参考指导，删掉后找不回来，只能重新添加参考、重新分析。',
  confirmLabel: '重置',
  danger: true,
}

export const REMOVE_REFERENCE_SOURCE_CONFIRM: ConfirmDialogCopy = {
  title: '删除这个参考来源',
  description: '删掉后这份内容找不回来，需要时得重新粘贴或导入；已生成的参考指导会标记为过期，可重新分析更新。',
  confirmLabel: '删除',
  danger: true,
}

export const REANALYZE_REFERENCE_GUIDANCE_CONFIRM: ConfirmDialogCopy = {
  title: '重新分析参考作品',
  description: '会先删除当前参考指导，再按现有参考来源重新生成一份；旧的参考指导找不回来。',
  confirmLabel: '重新分析',
  danger: true,
}
