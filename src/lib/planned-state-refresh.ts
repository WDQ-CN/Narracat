import { create } from 'zustand'

/**
 * 计划状态变更（planned_state_changes）跨组件刷新信号（A4×D2 片3b 终审 Fix 1）：
 * StateChangesLedger 保存 / 四处置动作（含「正文已写到」两步表单）成功后 bump()，
 * WorkbenchPrimarySidebar 的「未兑现计划」橙点徽标把 version 并进 reloadKey 重拉计数——
 * 账本区与侧栏是两棵互不相邻的组件树，onChanged prop 链只够刷同一分支内的章纲 artifacts，
 * 够不到侧栏，须走 module 级 store（同 manuscript-editor-guard.ts 的 saveVersion 先例）。
 */
interface PlannedStateRefreshState {
  version: number
  bump: () => void
}

export const usePlannedStateRefresh = create<PlannedStateRefreshState>((set) => ({
  version: 0,
  bump: () => set((state) => ({ version: state.version + 1 })),
}))
