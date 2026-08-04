import type { AgentRun, AgentTaskPlanItem, AgentThread } from '@shared/types/agent'

// 运行中超过该时长没有任何新事件 → UI 提示「可能卡住、可停止」。早于主进程 30 分钟空闲看门狗，
// 让用户在自动收尾前就能主动中止；判据是「距最后事件的间隔」而非「总运行时长」，不误伤活跃长任务。
// 20 分钟：热写/冷改（一热一冷链）都是单次长补全，分钟级无事件是正常现象，不是每次长任务都要触发；
// 20 分钟无事件才算异常，同时仍留出到 30 分钟看门狗前 10 分钟的人工中止窗口。
export const AGENT_RUN_STALL_HINT_MS = 20 * 60_000

/** 运行中且距最后一次事件超过 AGENT_RUN_STALL_HINT_MS 即判定可能卡住（纯函数，由调用方传入当前时间）。 */
export function isAgentRunStalled(run: AgentRun | null | undefined, nowMs: number): boolean {
  if (!run || run.status !== 'running') return false
  if (run.stalledAt) return true
  const lastMs = Date.parse(run.lastEventAt ?? run.startedAt)
  if (Number.isNaN(lastMs)) return false
  return nowMs - lastMs >= AGENT_RUN_STALL_HINT_MS
}

/** 运行已用时长展示：mm:ss，超一小时 h:mm:ss；异常输入归零。 */
export function formatAgentRunElapsed(elapsedMs: number): string {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? elapsedMs : 0
  const totalSeconds = Math.max(0, Math.floor(safeElapsedMs / 1000))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${mmss}` : mmss
}

export interface AgentPanelStatus {
  stepCount: number
  currentStepIndex?: number
  label: string
  tone: 'idle' | 'running' | 'complete' | 'queued'
}

export interface AgentStep {
  id: string
  title: string
  detail: string
  status: 'pending' | 'running' | 'complete' | 'failed'
}

export function getAgentPanelStatus(thread: AgentThread | undefined): AgentPanelStatus {
  const steps = getAgentSteps(thread)
  const currentStep =
    steps.find((step) => step.status === 'running') ??
    steps.find((step) => step.status === 'failed') ??
    steps.find((step) => step.status === 'pending') ??
    steps.at(-1)

  if (currentStep) {
    const currentStepIndex = steps.findIndex((step) => step.id === currentStep.id) + 1
    return {
      stepCount: steps.length,
      currentStepIndex,
      label: currentStep.title,
      tone:
        currentStep.status === 'failed'
          ? 'queued'
          : currentStep.status === 'complete'
            ? 'complete'
            : 'running',
    }
  }

  if (thread?.activeRun) {
    const label =
      thread.activeRun.status === 'waiting-user'
        ? '等待你的确认'
        : thread.activeRun.status === 'cancelling'
          ? 'Agent 正在停止'
          : thread.activeRun.status === 'durability-failed'
            ? '历史保存失败，任务已锁定'
            : thread.activeRun.status === 'accepted'
              ? 'Agent 启动中'
              : 'Agent 启动中'
    return {
      stepCount: 0,
      label,
      tone: thread.activeRun.status === 'durability-failed' ? 'queued' : 'running',
    }
  }

  if ((thread?.messages.length ?? 0) > 0) {
    return {
      stepCount: steps.length,
      label: 'Agent 就绪',
      tone: 'complete',
    }
  }

  return {
    stepCount: 0,
    label: '初始状态',
    tone: 'idle',
  }
}

export function getAgentSteps(thread: AgentThread | undefined): AgentStep[] {
  return thread?.activeRun?.taskPlan?.items.map(createStepFromTaskPlanItem) ?? []
}

// taskPlan item 的 title 常带 NarraCat 引擎 pipeline 内部编号（如「步骤 0.5：」「步骤 1.7.3：」），
// 0.5/1.5 是插入步骤、1.7.3 是子步骤，对作者是黑话，且与左侧 App 连续序号并列会矛盾。
// 展示层剥离开头的「步骤 X：」前缀；剥离后为空则保留原文。左侧连续序号由 AgentStepsView 的 index+1 负责。
const STEP_NUMBER_PREFIX = /^步骤\s*[\d.]+\s*[:：—-]?\s*/

export function stripStepNumberPrefix(title: string): string {
  const stripped = title.replace(STEP_NUMBER_PREFIX, '').trim()
  return stripped.length > 0 ? stripped : title.trim()
}

function createStepFromTaskPlanItem(item: AgentTaskPlanItem): AgentStep {
  return {
    id: item.id,
    title: stripStepNumberPrefix(item.title),
    detail: item.detail ?? getTaskPlanStatusLabel(item.status),
    status: item.status,
  }
}

function getTaskPlanStatusLabel(status: AgentTaskPlanItem['status']): string {
  switch (status) {
    case 'pending':
      return '等待'
    case 'running':
      return '进行中'
    case 'complete':
      return '完成'
    case 'failed':
      return '失败'
  }
}
