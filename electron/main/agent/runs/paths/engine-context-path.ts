import type { AgentRunRequest } from '../../../agent-runner.ts'
import type { AppConfig } from '../../../config.ts'
import { buildRunOptionsWithSessionContext } from '../run-options.ts'
import type { CreateSessionFingerprintFn, RunPlanResult } from '../run-options.ts'
import { NARRACAT_COMMAND_ALLOWED_TOOLS } from '../../runtime/allowed-tools.ts'
import type { AgentRuntimeAdapter, RuntimeRunConfig } from '../../runtime/types.ts'
import { createEngineContextFreeformPrompt } from '../narracat-command.ts'

// engineContext freeform（工作台评估流等）fresh 起 session 的回合预算：与同类评估型 command
// （revise-premise / sync-chapter-memory，见 narracat-command.ts COMMAND_DEFAULTS）对齐。
export const ENGINE_CONTEXT_FREEFORM_MAX_TURNS = 48

export function isEngineContextFreeformRequest(request: AgentRunRequest): boolean {
  return request.command === 'freeform' && request.engineContext === true
}

export interface EngineContextPathInput {
  request: AgentRunRequest
  runtime: AgentRuntimeAdapter
  config: AppConfig
  apiKey: string
  abortController: AbortController
  appRoot: string
  resourcesPath?: string
  userDataPath?: string
  agentCorePath: string
  agentCoreManifestExists: (agentCorePath: string) => boolean
  agentSkillOverrides: RuntimeRunConfig['agents']
  canUseTool: RuntimeRunConfig['canUseTool']
  createSessionFingerprint?: CreateSessionFingerprintFn
}

/**
 * engineContext freeform：工作台评估流（stakes 第二档等）显式声明需要引擎上下文与工具。fresh 起
 * session 按 project-command 待遇——挂运行适配器 + NovelMemory MCP + 引擎工具白名单，不套
 * direct-chat 系统提示；已有可续聊的 project-command 会话时由 resumed-command-path 接手（同样
 * 具备引擎工具）。缺 projectPath 时 fail-loud（同 project-command 待遇），不静默降级成没有引擎
 * 工具的 direct chat。从 run-manager.ts startRun 原样迁出。
 */
export async function buildEngineContextRunPlan(input: EngineContextPathInput): Promise<RunPlanResult> {
  const {
    request,
    runtime,
    config,
    apiKey,
    abortController,
    appRoot,
    resourcesPath,
    userDataPath,
    agentCorePath,
    agentCoreManifestExists,
    agentSkillOverrides,
    canUseTool,
    createSessionFingerprint,
  } = input

  if (!request.projectPath) {
    return { ok: false, preparationFailure: '本次任务需要 NarraCat 引擎上下文，请先打开一个小说项目。' }
  }

  if (!agentCoreManifestExists(agentCorePath)) {
    return {
      ok: false,
      preparationFailure: `未找到 NarraCat Agent Core 运行适配器清单文件。路径：${agentCorePath}。请运行 bun --no-cache run prepare:narracat-agent-core 准备 agent-core/narracat。`,
    }
  }

  const { options, sessionContext } = await buildRunOptionsWithSessionContext({
    runtime,
    config,
    apiKey,
    abortController,
    appRoot,
    resourcesPath,
    userDataPath,
    loadNarraCatRuntime: true,
    projectPath: request.projectPath,
    maxTurns: ENGINE_CONTEXT_FREEFORM_MAX_TURNS,
    allowedTools: NARRACAT_COMMAND_ALLOWED_TOOLS,
    canUseTool,
    agents: agentSkillOverrides,
    sessionMode: 'project-command',
    selectedChapter: request.selectedChapter,
    createSessionFingerprint,
  })

  return {
    ok: true,
    plan: {
      prompt: createEngineContextFreeformPrompt(request.prompt, request.projectPath),
      options,
      sessionContext,
      projectUpdate: {
        projectPath: request.projectPath,
        selectedChapter: request.selectedChapter,
        target: request.target,
      },
    },
  }
}
