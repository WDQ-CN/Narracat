import type { AgentRunRequest } from '../../agent-runner.ts'

const RUNTIME_STATUS_COMMANDS = new Set<AgentRunRequest['command']>([
  'continue',
  'adjust-style',
  'revise-character',
])

/**
 * 指令引导段（内部提示文字，无任何用户可见清单）：让 direct-chat 模型知道产品指令词的存在，
 * 识别到流程意图时输出 /narracat:xxx 原文——渲染端 AgentMarkdown 会把它渲染成可点击指令胶囊。
 * 指令中文名与说明照抄 src/lib/agent-commands.ts 的菜单文案语义，勿自创。
 */
const DIRECT_CHAT_COMMAND_GUIDANCE = [
  '指令引导：NarraCat App 提供以下正式创作指令，用户点击对应按钮即可进入流程（这些流程你自己没有执行能力）：',
  '/narracat:setup —— 设定：新书还没完成立项设定引导时用',
  '/narracat:reference —— 参考作品：添加或重新分析参考书，提炼写作指导',
  '/narracat:world —— 世界观与角色：创建或调整世界观、角色、场景等设定',
  '/narracat:plan —— 生成大纲：规划全书结构，生成卷与章节大纲',
  '/narracat:write —— 写下一章：按大纲续写下一章正文并自动审校',
  '/narracat:review —— 审修章节：深度审校指定章节，给出修改建议',
  '当用户的请求属于以上流程（例如「写下一章」「帮我建个角色」「弄个大纲」）：不要试图自己执行，也不要长篇解释流程；简短回应后在回复里写出对应指令原文（如 /narracat:write），NarraCat App 会把它渲染成可点击按钮，请用户点击进入正式流程。',
  '与以上流程无关的普通聊天照常回答。',
].join('\n')

export const DIRECT_CHAT_SYSTEM_PROMPT = [
  'You are NarraCat, a warm and practical AI writing partner for Chinese web novel authors.',
  'Reply directly to the user in Chinese unless the user explicitly asks for another language.',
  'Do not inspect project setup, Agent Core status, files, or runtime state unless the user explicitly asks you to do that.',
  'Do not write, edit, delete, or persist files.',
  DIRECT_CHAT_COMMAND_GUIDANCE,
].join('\n')

export function isRuntimeStatusCommand(request: AgentRunRequest): boolean {
  return RUNTIME_STATUS_COMMANDS.has(request.command)
}

export function createRuntimeStatusPrompt(request: AgentRunRequest): string {
  return [
    'NarraCat runtime status check.',
    'Do not write, edit, delete, or persist files.',
    'Do not start a chapter drafting loop.',
    'Check whether NarraCat Agent Core is loaded and briefly explain what runtime capabilities appear available.',
    `User command: ${request.command}`,
    `User prompt: ${request.prompt}`,
  ].join('\n')
}

export function createDirectChatPrompt(request: AgentRunRequest): string {
  const projectContext = request.projectPath
    ? [
        `Current novel project root: ${request.projectPath}`,
        'When the user refers to this book, this novel, the current chapter, or the current project, treat this as the active novel project.',
      ]
    : []

  return [
    'NarraCat direct conversation.',
    'Do not inspect the project setup or NarraCat Agent Core status unless the user explicitly asks for runtime diagnostics.',
    'Answer the user message directly.',
    ...projectContext,
    `User message:\n${request.prompt}`,
  ].join('\n')
}
