import type { RuntimeCanUseTool, RuntimePermissionResult } from '../runtime/types.ts'
import type { AgentQuestionAnswerInput } from '../../agent-runner.ts'
import type { AgentEvent, AgentQuestion } from '@shared/types/agent'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeAgentQuestions(input: Record<string, unknown>): AgentQuestion[] {
  const questions = input.questions
  if (!Array.isArray(questions)) return []

  return questions.flatMap((question): AgentQuestion[] => {
    if (!isRecord(question)) return []
    const questionText = typeof question.question === 'string' ? question.question : ''
    const header = typeof question.header === 'string' ? question.header : ''
    const options = Array.isArray(question.options) ? question.options : []
    if (!questionText.trim() || !header.trim() || options.length < 2) return []

    const normalizedOptions = options.flatMap((option) => {
      if (!isRecord(option)) return []
      const label = typeof option.label === 'string' ? option.label : ''
      const description = typeof option.description === 'string' ? option.description : ''
      const preview = typeof option.preview === 'string' ? option.preview : undefined
      if (!label.trim()) return []
      return [{ label, description, ...(preview !== undefined ? { preview } : {}) }]
    })
    if (normalizedOptions.length < 2) return []

    return [
      {
        question: questionText,
        header,
        options: normalizedOptions,
        ...(question.multiSelect === true ? { multiSelect: true } : {}),
      },
    ]
  })
}

function readToolInputText(input: unknown): string {
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

function isDirectNovelMemoryAccess(toolName: string, input: unknown): boolean {
  if (toolName !== 'Bash' && toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit') return false

  const inputText = readToolInputText(input)
  return [
    /\.narracat[\\/]+memory\.db/i,
    /init-memory\.mjs/i,
    /better-sqlite3/i,
    /sqlite-vec/i,
    /new\s+Database\s*\(/i,
    /INSERT\s+INTO\s+(settings|facts|chapter_summaries|memory_fts|emotions)/i,
  ].some((pattern) => pattern.test(inputText))
}

export interface CreateCanUseToolDeps {
  runId: string
  abortController: AbortController
  now: () => string
  sendEventSafe: (event: AgentEvent) => Promise<boolean>
  /** run 已进入不可恢复的持久化失败态（历史无法安全保存）时调用，标记 run 状态并让调用方 abort。 */
  markDurabilityFailed: () => void
  waitForQuestionAnswer: (
    runId: string,
    requestId: string,
    abortController: AbortController,
    signal: AbortSignal,
  ) => Promise<AgentQuestionAnswerInput>
}

/**
 * 组装本次 run 的 canUseTool 权限桥：拦截直连 NovelMemory sqlite 的工具调用，把 AskUserQuestion
 * 转成 question.requested 事件并挂起等待渲染进程作答，其它工具直接放行。从 run-manager.ts:436-504
 * 原样迁出，签名与行为保持一致——原先靠外层闭包读取的 activeRuns/sendEventSafe/now/
 * waitForQuestionAnswer 改为显式依赖注入。类型用运行时中立契约（RuntimeCanUseTool），claude-sdk
 * 与 pi adapter 共用（阶段2切片③）。
 */
export function createCanUseTool(deps: CreateCanUseToolDeps): RuntimeCanUseTool {
  const { runId, abortController, now, sendEventSafe, markDurabilityFailed, waitForQuestionAnswer } = deps
  return async (toolName, input, options): Promise<RuntimePermissionResult> => {
    if (isDirectNovelMemoryAccess(toolName, input)) {
      return {
        behavior: 'deny',
        message:
          'NovelMemory 必须通过 NarraCat MCP 工具和 memory-keeper 写入，不能直接操作 .narracat/memory.db 或生成本地 SQLite 脚本。',
        toolUseID: options.toolUseID,
        decisionClassification: 'user_reject',
      }
    }

    if (toolName !== 'AskUserQuestion') {
      return { behavior: 'allow', updatedInput: input, toolUseID: options.toolUseID }
    }

    const requestId = options.toolUseID
    const questions = normalizeAgentQuestions(input)
    if (questions.length === 0) {
      return {
        behavior: 'deny',
        message: 'AskUserQuestion 参数非法。',
        toolUseID: requestId,
        decisionClassification: 'user_reject',
      }
    }

    const questionPublished = await sendEventSafe({
      type: 'question.requested',
      runId,
      messageId: `assistant-${runId}`,
      questionRequestId: requestId,
      toolCallId: requestId,
      questions,
      createdAt: now(),
    })
    if (!questionPublished) {
      markDurabilityFailed()
      abortController.abort()
      return {
        behavior: 'deny',
        message: 'Agent 历史无法安全保存，任务已停止。',
        toolUseID: requestId,
        decisionClassification: 'user_reject',
      }
    }

    try {
      const answer = await waitForQuestionAnswer(runId, requestId, abortController, options.signal)
      return {
        behavior: 'allow',
        updatedInput: {
          ...input,
          answers: answer.answers,
        },
        toolUseID: requestId,
        decisionClassification: 'user_temporary',
      }
    } catch (error) {
      return {
        behavior: 'deny',
        message: error instanceof Error ? error.message : '用户问题已取消。',
        toolUseID: requestId,
        decisionClassification: 'user_reject',
      }
    }
  }
}
