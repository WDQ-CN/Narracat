import type { AgentQuickAction, AgentRunTarget } from './agent'

export type ResultNotificationStatus =
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'success'
  | 'failed'
  | 'interrupted'

export interface ResultNotification {
  id: string
  runId: string
  threadId: string
  segmentId?: string
  status: ResultNotificationStatus
  title: string
  summary: string
  projectName: string
  projectPath?: string
  command?: AgentQuickAction | 'freeform'
  target?: AgentRunTarget
  /**
   * 直达跳转地址（如 `/settings?section=packs&sub=draft:xxx`），供不挂在小说工作台的结果通知使用
   * （如刀4「从书学写法」——学习产物是造包草稿，不是某个小说项目的 workbench 对象，走不了
   * `projectPath` + `target` 的工作台路由）。设置时 `resolveResultNotificationHref` 优先用它，
   * 跳过按 projectPath 查项目那一套。
   */
  href?: string
  questionRequestId?: string
  createdAt: string
  updatedAt: string
  readAt?: string
}

export interface ResultNotificationList {
  notifications: ResultNotification[]
  totalCount: number
  unreadCount: number
}
