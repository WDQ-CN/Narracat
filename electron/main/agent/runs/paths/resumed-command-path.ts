import type { AgentRunRequest } from '../../../agent-runner.ts'
import type { AppConfig } from '../../../config.ts'
import type { RunPlan, SdkThreadSession } from '../run-options.ts'
import type { AgentRuntimeAdapter, RuntimeRunConfig } from '../../runtime/types.ts'
import { createNarraCatCommandContinuationPrompt } from '../narracat-command.ts'

/** resumed-command 路径专属：narrow 到「确认可续聊」后 projectPath 恒为 string（原 `&&` 链隐含的不变量）。 */
export type ResumableSdkThreadSession = SdkThreadSession & { mode: 'project-command'; projectPath: string }

/**
 * 判定：本次 freeform 请求能否续聊到同 thread 已建立的 project-command 会话（write/rewrite/
 * revise-premise 等 NarraCat 命令跑完后留下的会话）。四个条件缺一不可：freeform 命令、会话形态是
 * project-command、会话已有 projectPath、请求方指定的 projectPath（或缺省沿用会话的）与会话
 * projectPath 一致。从 run-manager.ts startRun 原样迁出为具名判定 + 类型收窄。
 */
export function isResumableProjectCommandSession(
  request: AgentRunRequest,
  sdkSession: SdkThreadSession | undefined,
): sdkSession is ResumableSdkThreadSession {
  if (request.command !== 'freeform') return false
  if (!sdkSession || sdkSession.mode !== 'project-command' || !sdkSession.projectPath) return false
  const resumedProjectPath = request.projectPath ?? sdkSession.projectPath
  return resumedProjectPath === sdkSession.projectPath
}

export interface ResumedCommandPathInput {
  request: AgentRunRequest
  runtime: AgentRuntimeAdapter
  sdkSession: ResumableSdkThreadSession
  config: AppConfig
  apiKey: string
  abortController: AbortController
  appRoot: string
  resourcesPath?: string
  userDataPath?: string
  agentSkillOverrides: RuntimeRunConfig['agents']
  canUseTool: RuntimeRunConfig['canUseTool']
}

/**
 * 续聊已建立的 project-command 会话：resume 既有 runtime session，不重新计算兼容性指纹（沿用会话
 * 自身已有的 sessionContext），不套 direct-chat 系统提示。形态特殊——不经过
 * buildRunOptionsWithSessionContext（没有 fresh 指纹要算），直接调 runtime.createRunOptions 并传
 * resume。从 run-manager.ts startRun 原样迁出；async 化（切片⑥）只为 await
 * runtime.createRunOptions——pi adapter 现在可能返回 Promise，claude-sdk 实现仍同步返回，行为零变化。
 */
export async function buildResumedCommandRunPlan(input: ResumedCommandPathInput): Promise<RunPlan> {
  const { request, runtime, sdkSession, config, apiKey, abortController, appRoot, resourcesPath, userDataPath, agentSkillOverrides, canUseTool } =
    input

  const options = await runtime.createRunOptions({
    config,
    apiKey,
    abortController,
    appRoot,
    resourcesPath,
    userDataPath,
    loadNarraCatRuntime: sdkSession.loadNarraCatRuntime,
    projectPath: sdkSession.projectPath,
    maxTurns: sdkSession.maxTurns,
    allowedTools: sdkSession.allowedTools,
    canUseTool,
    agents: sdkSession.loadNarraCatRuntime ? agentSkillOverrides : undefined,
    resume: sdkSession.sessionId,
  })

  return {
    prompt: createNarraCatCommandContinuationPrompt(request.prompt),
    options,
    sessionContext: sdkSession,
    projectUpdate: {
      projectPath: sdkSession.projectPath,
      selectedChapter: sdkSession.selectedChapter,
      ...(sdkSession.manuscriptRevisionSource ? { manuscriptRevisionSource: sdkSession.manuscriptRevisionSource } : {}),
    },
  }
}
