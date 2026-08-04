import type { AgentTaskPlanItem } from '@shared/types/agent'

const TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate'])

function normalizeStatus(value: unknown): AgentTaskPlanItem['status'] | 'deleted' | undefined {
  switch (value) {
    case 'pending':
      return 'pending'
    case 'in_progress':
    case 'running':
      return 'running'
    case 'completed':
    case 'complete':
      return 'complete'
    case 'failed':
      return 'failed'
    case 'deleted':
      return 'deleted'
    default:
      return undefined
  }
}

function normalizeTaskId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value.trim().replace(/^#/, '')
  return undefined
}

/**
 * TaskCreate/TaskUpdate 的 tool.started 输入 → 任务列表增量聚合；与任务卡无关或输入不完整返回 null。
 * pi 侧自定义 TaskCreate/TaskUpdate 与 SDK 侧未来同名工具走同一条聚合路径；SDK 现行 TodoWrite 全量映射
 * （event-mapper.ts）不受影响，双轨兼容。
 */
export function applyTaskToolCall(
  items: AgentTaskPlanItem[],
  toolName: string,
  input: Record<string, unknown> | undefined,
): AgentTaskPlanItem[] | null {
  if (!TASK_TOOL_NAMES.has(toolName) || !input) return null

  if (toolName === 'TaskCreate') {
    const title = typeof input.subject === 'string' ? input.subject.trim() : ''
    if (!title) return null
    const detail =
      typeof input.description === 'string' && input.description.trim() ? input.description.trim() : undefined
    const nextId = String(Math.max(0, ...items.map((item) => Number(item.id) || 0)) + 1)
    return [...items, { id: nextId, title, status: 'pending', ...(detail ? { detail } : {}) }]
  }

  const taskId = normalizeTaskId(input.taskId)
  const status = normalizeStatus(input.status)
  const subject = typeof input.subject === 'string' && input.subject.trim() ? input.subject.trim() : undefined
  if (!taskId || (!status && !subject)) return null
  if (!items.some((item) => item.id === taskId)) return null
  if (status === 'deleted') return items.filter((item) => item.id !== taskId)
  return items.map((item) =>
    item.id === taskId ? { ...item, ...(status ? { status } : {}), ...(subject ? { title: subject } : {}) } : item,
  )
}
