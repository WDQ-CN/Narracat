// AgentRunRequest 及相关请求/响应契约：主进程 agent-runner.ts 与渲染端 ipc.d.ts 曾各自维护一份
// 逐字相同的定义（双定义漂移风险），合一为唯一来源（ADR-0036 Phase 1）。normalize* 校验函数仍留
// 在 electron/main/agent-runner.ts（跨进程校验逻辑不属于纯类型契约）。

import type { AgentQuickAction, AgentRunTarget } from './agent'

export interface AgentRunRequest {
  /** renderer 为每次可变 IPC 生成；主进程用来折叠同一调用的重复投递。 */
  requestId?: string
  threadId: string
  command: AgentQuickAction | 'freeform'
  prompt: string
  // 气泡显示用的干净文案；prompt 仍带定位元信息发给 Agent。回传至 run.started 供渲染层使用。
  displayPrompt?: string
  // 'action'：由工作台按钮发起（非用户在输入框里打字）。回传至 run.started 供渲染层渲染为系统任务卡。
  origin?: 'action'
  // 仅对 command 'freeform' 有意义：本次 run 需要 NarraCat 引擎上下文与工具（运行适配器 + NovelMemory MCP），
  // fresh 起 session 时按 project-command 待遇而非 direct chat（如 stakes 第二档评估流）。需配合有效 projectPath。
  engineContext?: boolean
  projectPath?: string
  selectedChapter?: number
  target?: AgentRunTarget
}

export interface AgentRunStarted {
  runId: string
}

export interface AgentQuestionAnswerInput {
  requestId: string
  answers: Record<string, string>
}

export interface AgentQuestionAnswerMutationInput {
  requestId: string
  questionRequestId: string
  answers: Record<string, string>
}

export interface AgentCancelRunInput {
  requestId: string
  runId: string
}
