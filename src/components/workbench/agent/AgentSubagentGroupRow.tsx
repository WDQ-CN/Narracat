import { AgentProcessRow } from './AgentProcessRow'
import { AgentToolCallRow } from './AgentToolCallRow'
import { getToolPhrase, NARRACAT_AGENT_LABELS, normalizeAgentType } from './tool-phrase'
import type { AgentMessagePart, AgentPartStatus, AgentSubToolCall } from '@shared/types/agent'

type SubagentTaskPart = Extract<AgentMessagePart, { type: 'tool-call' }>

/**
 * 子 agent 分组卡：pi/SDK 两 runtime 派发子 agent（toolName ∈ {Task, Agent}）时，把带
 * parentToolCallId 归属的工具事件折进这张卡，折叠只显示「agent 名 + 当前动作」，展开看逐条明细。
 * 折叠/展开沿用 AgentProcessRow 的既有交互与视觉 tokens，不发明新视觉语言。
 */
export function AgentSubagentGroupRow({ part }: { part: SubagentTaskPart }) {
  const agentName = getSubagentDisplayName(part.input)
  const children = part.children ?? []
  const title = getGroupTitle(agentName, children, part.status)
  const detail = children.length > 0 ? <AgentSubagentGroupChildren children={children} /> : undefined

  return (
    <AgentProcessRow
      status={part.status}
      title={title}
      detail={detail}
      tone={part.status === 'failed' ? 'warning' : 'muted'}
    />
  )
}

/** 展开态明细行，独立导出供直接按 props 渲染断言（折叠/展开是 AgentProcessRow 内部 useState，SSR 测不到点击）。 */
export function AgentSubagentGroupChildren({ children }: { children: AgentSubToolCall[] }) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1">
      {children.map((child) => (
        <AgentToolCallRow key={child.toolCallId} part={toChildToolCallPart(child)} />
      ))}
    </div>
  )
}

function toChildToolCallPart(child: AgentSubToolCall): SubagentTaskPart {
  return {
    id: `sub-${child.toolCallId}`,
    type: 'tool-call',
    toolCallId: child.toolCallId,
    toolName: child.toolName,
    title: child.title,
    status: child.status,
    input: child.input,
    error: child.error,
  }
}

function getSubagentDisplayName(input: Record<string, unknown> | undefined): string {
  const raw = input?.subagent_type
  if (typeof raw !== 'string' || !raw.trim()) return 'Agent'
  const normalized = normalizeAgentType(raw)
  return NARRACAT_AGENT_LABELS[normalized] ?? normalized
}

function getGroupTitle(agentName: string, children: AgentSubToolCall[], status: AgentPartStatus): string {
  if (status === 'failed') return `${agentName} · 已中断`
  if (status === 'complete') return `${agentName} · 已完成`

  const activeChild = findActiveChild(children)
  if (!activeChild) return `${agentName}正在准备...`

  const phrase = getToolPhrase(activeChild.toolName, activeChild.input)
  return `${agentName} · ${activeChild.status === 'running' ? phrase.loadingLabel : phrase.label}`
}

function findActiveChild(children: AgentSubToolCall[]): AgentSubToolCall | undefined {
  for (let index = children.length - 1; index >= 0; index -= 1) {
    if (children[index]?.status === 'running') return children[index]
  }
  return children.at(-1)
}
