/** 应用内自动更新的跨进程契约（路线图④）。主进程与渲染端共用，勿在任一侧另造副本。 */

export type UpdaterStatus =
  /** 空闲：没在查、也没有已就绪的更新（含「已是最新」） */
  | 'idle'
  /** 正在查询更新源 */
  | 'checking'
  /** 正在后台下载新版本 */
  | 'downloading'
  /** 已下载完，重启即生效 */
  | 'ready'
  /** 最近一次操作失败（是否让用户看见由渲染端 describeUpdateStatus 按 manual 决定） */
  | 'error'

export interface UpdaterState {
  status: UpdaterStatus
  /** 当前正在运行的版本 */
  currentVersion: string
  /** 检测到的新版本号；无新版本时为 null */
  availableVersion: string | null
  /** 下载进度 0-100，仅 downloading 期间有意义 */
  percent: number
  /** 最近一次检查是否由用户手动触发——决定失败要不要给用户看 */
  manual: boolean
}

export type UpdaterEvent =
  | { type: 'check-started'; manual: boolean }
  | { type: 'update-available'; version: string }
  | { type: 'update-not-available' }
  | { type: 'download-progress'; percent: number }
  | { type: 'update-downloaded'; version: string }
  | { type: 'error' }
