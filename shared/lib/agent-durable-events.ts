import type {
  AgentDurableEventV1,
  AgentMessage,
  AgentMessagePart,
  AgentQuestion,
  AgentRun,
  AgentTaskPlanItem,
  AgentThread,
} from '@shared/types/agent'

const MAX_DURABLE_SUMMARY_LENGTH = 2_000
const SENSITIVE_ASSIGNMENT =
  /\b(api[_-]?key|authorization|bearer|token|secret|password)\b\s*[:=]\s*([^\s,;]+)/gi
const SENSITIVE_BEARER = /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi
const SENSITIVE_TOKEN = /\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g
const ABSOLUTE_PATH =
  /(?:\/Users|\/home|\/private|\/var|\/Volumes|\/tmp|\/Applications|\/opt|\/etc|[A-Za-z]:\\)[^\s"'<>]+/g

export function createEmptyDurableAgentThread(threadId: string): AgentThread {
  return {
    id: threadId,
    messages: [],
    activeRun: null,
    lastRun: null,
  }
}

export function sanitizeDurableText(
  value: string | undefined,
  fallback = '',
  maxLength?: number,
): string {
  const sanitized = (value ?? fallback)
    .replace(SENSITIVE_ASSIGNMENT, '$1=[已隐藏]')
    .replace(SENSITIVE_BEARER, 'Bearer [已隐藏]')
    .replace(SENSITIVE_TOKEN, '[敏感令牌已隐藏]')
    .replace(ABSOLUTE_PATH, '[本机路径]')
    .trim()
  if (maxLength === undefined || sanitized.length <= maxLength) return sanitized
  return `${sanitized.slice(0, maxLength)}…（内容过长已省略）`
}

export function sanitizeDurableSummary(value: string | undefined, fallback = ''): string {
  return sanitizeDurableText(value, fallback, MAX_DURABLE_SUMMARY_LENGTH)
}

export function sanitizeDurableQuestions(questions: AgentQuestion[]): AgentQuestion[] {
  return questions.map((question) => ({
    ...question,
    header: sanitizeDurableText(question.header),
    question: sanitizeDurableText(question.question),
    options: question.options.map((option) => ({
      ...option,
      label: sanitizeDurableText(option.label),
      description: sanitizeDurableText(option.description),
      ...(option.preview === undefined ? {} : { preview: sanitizeDurableText(option.preview) }),
    })),
  }))
}

export function sanitizeDurableAnswers(answers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(answers).map(([question, answer]) => [
      sanitizeDurableText(question),
      sanitizeDurableText(answer),
    ]),
  )
}

export function sanitizeDurablePlanItems(items: AgentTaskPlanItem[]): AgentTaskPlanItem[] {
  return items.map((item) => ({
    ...item,
    title: sanitizeDurableText(item.title),
    ...(item.detail === undefined ? {} : { detail: sanitizeDurableText(item.detail) }),
  }))
}

function updateAssistantMessage(
  thread: AgentThread,
  runId: string,
  update: (message: AgentMessage) => AgentMessage,
): AgentThread {
  const messageId = `assistant-${runId}`
  return {
    ...thread,
    messages: thread.messages.map((message) => (message.id === messageId ? update(message) : message)),
  }
}

function acceptedRun(thread: AgentThread, event: Extract<AgentDurableEventV1, { type: 'run.accepted' }>): AgentThread {
  const userMessage: AgentMessage = {
    id: `user-${event.runId}`,
    role: 'user',
    createdAt: event.createdAt,
    status: 'complete',
    parts: [
      {
        id: `part-user-${event.runId}-text`,
        type: 'text',
        text: event.visiblePrompt,
        status: 'complete',
      },
    ],
    ...(event.command !== 'freeform' ? { command: event.command } : {}),
    ...(event.origin ? { origin: event.origin } : {}),
  }
  const assistantMessage: AgentMessage = {
    id: `assistant-${event.runId}`,
    role: 'assistant',
    createdAt: event.createdAt,
    status: 'running',
    parts: [],
  }
  const run: AgentRun = {
    id: event.runId,
    threadId: thread.id,
    command: event.command,
    prompt: event.visiblePrompt,
    displayPrompt: event.visiblePrompt,
    status: 'accepted',
    startedAt: event.createdAt,
    lastEventAt: event.createdAt,
    selectedChapter: event.selectedChapter,
    target: event.target,
  }
  return {
    ...thread,
    messages: [...thread.messages, userMessage, assistantMessage],
    activeRun: run,
  }
}

function summarizedTool(
  thread: AgentThread,
  event: Extract<AgentDurableEventV1, { type: 'run.tool-summarized' }>,
): AgentThread {
  return updateAssistantMessage(thread, event.runId, (message) => {
    const part: AgentMessagePart = {
      id: `part-${event.toolCallId}`,
      type: 'tool-call',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      title: event.title,
      status: event.status,
      ...(event.summary ? { summary: event.summary } : {}),
      ...(event.error ? { error: event.error } : {}),
    }
    const existingIndex = message.parts.findIndex(
      (candidate) => candidate.type === 'tool-call' && candidate.toolCallId === event.toolCallId,
    )
    if (existingIndex < 0) return { ...message, parts: [...message.parts, part] }
    return {
      ...message,
      parts: message.parts.map((candidate, index) => (index === existingIndex ? part : candidate)),
    }
  })
}

function requestedQuestion(
  thread: AgentThread,
  event: Extract<AgentDurableEventV1, { type: 'run.question-requested' }>,
): AgentThread {
  const next = updateAssistantMessage(thread, event.runId, (message) => {
    const part: AgentMessagePart = {
      id: `part-${event.toolCallId}`,
      type: 'question',
      questionRequestId: event.questionRequestId,
      toolCallId: event.toolCallId,
      questions: event.questions,
      status: 'running',
    }
    const existingIndex = message.parts.findIndex(
      (candidate) =>
        candidate.type === 'question' && candidate.questionRequestId === event.questionRequestId,
    )
    if (existingIndex < 0) return { ...message, parts: [...message.parts, part] }
    return {
      ...message,
      parts: message.parts.map((candidate, index) => (index === existingIndex ? part : candidate)),
    }
  })
  if (next.activeRun?.id !== event.runId) return next
  return {
    ...next,
    activeRun: { ...next.activeRun, status: 'waiting-user', lastEventAt: event.createdAt },
  }
}

function answeredQuestion(
  thread: AgentThread,
  event: Extract<AgentDurableEventV1, { type: 'run.question-answered' }>,
): AgentThread {
  const next = updateAssistantMessage(thread, event.runId, (message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === 'question' && part.questionRequestId === event.questionRequestId
        ? { ...part, answers: event.answers, status: 'complete' }
        : part,
    ),
  }))
  if (next.activeRun?.id !== event.runId) return next
  return {
    ...next,
    activeRun: { ...next.activeRun, status: 'running', lastEventAt: event.createdAt },
  }
}

function finalizedPlan(
  thread: AgentThread,
  event: Extract<AgentDurableEventV1, { type: 'run.plan-finalized' }>,
): AgentThread {
  if (!thread.activeRun || thread.activeRun.id !== event.runId) return thread
  return {
    ...thread,
    activeRun: {
      ...thread.activeRun,
      lastEventAt: event.createdAt,
      taskPlan: {
        runId: event.runId,
        items: event.items,
        updatedAt: event.createdAt,
      },
    },
  }
}

type DurableTerminalEvent = Extract<
  AgentDurableEventV1,
  { type: 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.interrupted' }
>

function finishRun(thread: AgentThread, event: DurableTerminalEvent): AgentThread {
  const status =
    event.type === 'run.completed'
      ? 'complete'
      : event.type === 'run.interrupted'
        ? 'interrupted'
        : event.type === 'run.failed'
          ? 'failed'
          : 'cancelled'
  let next = updateAssistantMessage(thread, event.runId, (message) => {
    const terminalPartStatus = status === 'complete' ? 'complete' : 'failed'
    const stableParts: AgentMessagePart[] = message.parts.map((part) =>
      part.status === 'running' ? { ...part, status: terminalPartStatus } : part,
    )
    const text = event.assistantText.trim()
    const parts: AgentMessagePart[] = text
      ? [
          ...stableParts.filter((part) => part.type !== 'text'),
          {
            id: `part-assistant-${event.runId}-text`,
            type: 'text',
            text,
            status: status === 'complete' ? 'complete' : 'failed',
          },
        ]
      : stableParts
    if (event.type === 'run.failed' || event.type === 'run.interrupted') {
      parts.push(
        event.type === 'run.failed' && event.reason === 'model-service-required'
          ? {
              id: `part-assistant-${event.runId}-model-service`,
              type: 'model-service-required',
              provider: event.provider ?? 'unknown',
              title: '需要配置模型服务',
              detail: event.error,
              status: 'failed',
            }
          : {
              id: `part-assistant-${event.runId}-error`,
              type: 'error',
              tone: event.type === 'run.interrupted' ? 'interrupted' : 'failed',
              title: event.type === 'run.interrupted' ? '任务已中断' : '运行失败',
              detail: event.error,
              status: 'failed',
            },
      )
    }
    return {
      ...message,
      status,
      parts,
      ...(event.type === 'run.completed' && event.usage ? { usage: event.usage } : {}),
    }
  })

  const activeRun = next.activeRun?.id === event.runId ? next.activeRun : null
  if (!activeRun) return next
  next = {
    ...next,
    activeRun: null,
    lastRun: {
      ...activeRun,
      status,
      lastEventAt: event.createdAt,
      finishedAt: event.createdAt,
    },
  }
  return next
}

export function reduceAgentDurableEvent(thread: AgentThread, event: AgentDurableEventV1): AgentThread {
  switch (event.type) {
    case 'conversation.segment-opened':
    case 'conversation.segment-sealed':
    case 'session.context-established':
      return thread
    case 'session.invalidated':
      // “开始新对话”的唯一边界由新 segment 的 conversation.divider-added 表达；
      // 旧 segment 不再追加第二个 divider。
      if (event.reason === 'new-conversation') return thread
      if (thread.messages.at(-1)?.role === 'divider') return thread
      {
        const divider: AgentMessage = {
          id: `divider-session-${event.createdAt}-${thread.messages.length}`,
          role: 'divider',
          createdAt: event.createdAt,
          status: 'complete',
          parts: [],
        }
        const activeUserIndex = thread.activeRun
          ? thread.messages.findIndex((message) => message.id === `user-${thread.activeRun!.id}`)
          : -1
        if (activeUserIndex > 0 && thread.messages[activeUserIndex - 1]?.role !== 'divider') {
          return {
            ...thread,
            messages: [
              ...thread.messages.slice(0, activeUserIndex),
              divider,
              ...thread.messages.slice(activeUserIndex),
            ],
          }
        }
        return { ...thread, messages: [...thread.messages, divider] }
      }
    case 'conversation.divider-added':
      if (thread.messages.at(-1)?.role === 'divider') return thread
      return {
        ...thread,
        messages: [
          ...thread.messages,
          {
            id: event.dividerId,
            role: 'divider',
            createdAt: event.createdAt,
            status: 'complete',
            parts: [],
          },
        ],
      }
    case 'run.accepted':
      return acceptedRun(thread, event)
    case 'run.tool-summarized':
      return summarizedTool(thread, event)
    case 'run.question-requested':
      return requestedQuestion(thread, event)
    case 'run.question-answered':
      return answeredQuestion(thread, event)
    case 'run.plan-finalized':
      return finalizedPlan(thread, event)
    case 'run.completed':
    case 'run.failed':
    case 'run.cancelled':
    case 'run.interrupted':
      return finishRun(thread, event)
  }
}
