import type { AgentRunRequest } from '../../../agent-runner.ts'
import type { AppConfig } from '../../../config.ts'
import { buildRunOptionsWithSessionContext } from '../run-options.ts'
import type { CreateSessionFingerprintFn, RunPlan, SdkThreadSession } from '../run-options.ts'
import type { AgentRuntimeAdapter, RuntimeRunConfig } from '../../runtime/types.ts'
import { createDirectChatPrompt, createRuntimeStatusPrompt, DIRECT_CHAT_SYSTEM_PROMPT } from '../runtime-status.ts'

function canResumeSdkSession(
  session: SdkThreadSession | undefined,
  projectPath: string | undefined,
): session is SdkThreadSession {
  if (!session) return false
  return !projectPath || session.projectPath === projectPath
}

export interface DirectChatPathInput {
  request: AgentRunRequest
  runtime: AgentRuntimeAdapter
  config: AppConfig
  apiKey: string
  abortController: AbortController
  appRoot: string
  resourcesPath?: string
  userDataPath?: string
  needsNarraCatRuntime: boolean
  agentSkillOverrides: RuntimeRunConfig['agents']
  sdkSession: SdkThreadSession | undefined
  canUseTool: RuntimeRunConfig['canUseTool']
  createSessionFingerprint?: CreateSessionFingerprintFn
}

/**
 * 兜底路径：不是 write-next / recover-write / narracat-command，也没命中「resume 已有
 * project-command 会话续聊」或「engineContext freeform」，落到这里——纯「唠个嗑」
 * （needsNarraCatRuntime=false）或运行时状态查询命令（needsNarraCatRuntime=true，如 /setup 状态
 * 轮询）。若同 thread 有可复用的 SDK session 且 projectPath 兼容，resume 它。从 run-manager.ts
 * startRun 尾段原样迁出，无前置失败校验（本路径不产出 preparationFailure）。
 */
export async function buildDirectChatRunPlan(input: DirectChatPathInput): Promise<RunPlan> {
  const {
    request,
    runtime,
    config,
    apiKey,
    abortController,
    appRoot,
    resourcesPath,
    userDataPath,
    needsNarraCatRuntime,
    agentSkillOverrides,
    sdkSession,
    canUseTool,
    createSessionFingerprint,
  } = input

  const prompt = needsNarraCatRuntime ? createRuntimeStatusPrompt(request) : createDirectChatPrompt(request)
  const projectPath = request.projectPath ?? sdkSession?.projectPath
  const canResumeSession = canResumeSdkSession(sdkSession, projectPath)

  const { options, sessionContext } = await buildRunOptionsWithSessionContext({
    runtime,
    config,
    apiKey,
    abortController,
    appRoot,
    resourcesPath,
    userDataPath,
    loadNarraCatRuntime: needsNarraCatRuntime,
    projectPath,
    systemPrompt: needsNarraCatRuntime ? undefined : DIRECT_CHAT_SYSTEM_PROMPT,
    canUseTool,
    agents: needsNarraCatRuntime ? agentSkillOverrides : undefined,
    resume: canResumeSession ? sdkSession.sessionId : undefined,
    sessionMode: 'direct',
    selectedChapter: request.selectedChapter ?? (canResumeSession ? sdkSession.selectedChapter : undefined),
    createSessionFingerprint,
  })

  return { prompt, options, sessionContext }
}
