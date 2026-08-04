// 跨进程契约类型的唯一来源在 shared/types/agent.ts（ADR-0036 Phase 1）；这里 re-export 是为了让
// 既有调用方（50+ 处，常与本文件下方的纯渲染端 UI 类型混合 import）零改动继续可用。
// 新代码优先直接 `import type { ... } from '@shared/types/agent'`；本文件下方声明的 7 个类型
// （AgentQuickActionOption/AgentQuestionAnswer/AgentComposerReferenceContext/
// AgentComposerAdjustSpec/AgentComposerHandoff/AgentProcessEvent/AgentRunStatus）是纯渲染端
// UI 类型，从未被主进程消费，不属于跨进程契约，故本地定义（评审 2026-07-30 收窄）。
import type { AgentQuickAction, AgentRunActiveStatus, AgentRunTarget, AgentRunTerminalStatus } from '@shared/types/agent'

export type {
  AgentDurableEventV1,
  AgentEvent,
  AgentEventEnvelopeV1,
  AgentEventsAfterResultV1,
  AgentHistorySegmentSummaryV1,
  AgentMessage,
  AgentMessagePart,
  AgentMessageRole,
  AgentMessageStatus,
  AgentPartStatus,
  AgentQuestion,
  AgentQuestionOption,
  AgentQuickAction,
  AgentRun,
  AgentRunActiveStatus,
  AgentRunOrigin,
  AgentRunTarget,
  AgentRunTerminalStatus,
  AgentStartNewConversationInput,
  AgentTaskPlan,
  AgentTaskPlanItem,
  AgentTaskPlanItemStatus,
  AgentThread,
  AgentThreadSnapshotV1,
  AgentTokenUsage,
} from '@shared/types/agent'
export { getAgentThreadIdForProjectIdentity } from '@shared/types/agent'

export interface AgentQuickActionOption {
  value: AgentQuickAction
  label: string
}

export interface AgentQuestionAnswer {
  requestId: string
  answers: Record<string, string>
}

export interface AgentComposerReferenceContext {
  sourceTitle: string
  text: string
}

export interface AgentComposerAdjustSpec {
  targetLabel: string
  verb: string
}

export interface AgentComposerHandoff {
  id: string
  sourceActionId: string
  command: AgentQuickAction
  prompt: string
  target?: AgentRunTarget
  selectedChapter?: number
  referenceContext?: AgentComposerReferenceContext
  preserveDraft?: boolean
  // 「调整内容」类 handoff：编辑器留空聚焦、占位提示引导；边界约束在发送时由系统包装，不进编辑器。
  adjust?: AgentComposerAdjustSpec
}

export interface AgentProcessEvent {
  id: string
  kind: 'thinking' | 'tool' | 'draft' | 'review' | 'error'
  title: string
  detail?: string
  createdAt: string
}

export type AgentRunStatus = 'idle' | AgentRunActiveStatus | AgentRunTerminalStatus
