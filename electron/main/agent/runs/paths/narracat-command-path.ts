import type { AgentRunRequest } from '../../../agent-runner.ts'
import type { AppConfig } from '../../../config.ts'
import { buildRunOptionsWithSessionContext } from '../run-options.ts'
import type { CreateSessionFingerprintFn, RunPlanResult } from '../run-options.ts'
import { NARRACAT_COMMAND_ALLOWED_TOOLS } from '../../runtime/allowed-tools.ts'
import type { AgentRuntimeAdapter, RuntimeRunConfig } from '../../runtime/types.ts'
import { resolveNarraCatCommandRun } from '../narracat-command.ts'
import type { ReadNarraCatCommandFile } from '../narracat-command.ts'

export interface NarraCatCommandPathInput {
  request: AgentRunRequest
  runtime: AgentRuntimeAdapter
  config: AppConfig
  apiKey: string
  abortController: AbortController
  appRoot: string
  resourcesPath?: string
  userDataPath?: string
  agentCorePath: string
  readNarraCatCommandFile?: ReadNarraCatCommandFile
  agentSkillOverrides: RuntimeRunConfig['agents']
  canUseTool: RuntimeRunConfig['canUseTool']
  createSessionFingerprint?: CreateSessionFingerprintFn
}

/**
 * NarraCat 命令路径（write/rewrite/revise-premise/sync-chapter-memory 等，见
 * narracat-command.ts COMMAND_DEFAULTS，需先打开项目）。rewrite 命令会打正文版本索引标记
 * （manuscriptRevisionSource: 'agent-rewrite'），其它命令不打。从 run-manager.ts startRun
 * 原样迁出。resolveNarraCatCommandRun 本身同步，无需在其前后额外插入 canContinueRun 检查点
 * （检查仍由调用方在拿到本函数结果后统一做）。
 */
export async function buildNarraCatCommandRunPlan(input: NarraCatCommandPathInput): Promise<RunPlanResult> {
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
    readNarraCatCommandFile,
    agentSkillOverrides,
    canUseTool,
    createSessionFingerprint,
  } = input

  if (!request.projectPath) {
    return { ok: false, preparationFailure: `${request.command} 需要先打开一个小说项目。` }
  }

  const resolved = resolveNarraCatCommandRun(request, {
    pluginPath: agentCorePath,
    readCommandFile: readNarraCatCommandFile,
  })

  const manuscriptRevisionSource = request.command === 'rewrite' ? ('agent-rewrite' as const) : undefined
  const { options, sessionContext } = await buildRunOptionsWithSessionContext({
    runtime,
    config,
    apiKey,
    abortController,
    appRoot,
    resourcesPath,
    userDataPath,
    loadNarraCatRuntime: true,
    projectPath: resolved.projectPath,
    maxTurns: resolved.maxTurns,
    allowedTools: NARRACAT_COMMAND_ALLOWED_TOOLS,
    canUseTool,
    agents: agentSkillOverrides,
    sessionMode: 'project-command',
    selectedChapter: resolved.selectedChapter,
    manuscriptRevisionSource,
    createSessionFingerprint,
  })

  return {
    ok: true,
    plan: {
      prompt: resolved.prompt,
      options,
      sessionContext,
      projectUpdate: {
        projectPath: resolved.projectPath,
        selectedChapter: resolved.selectedChapter,
        target: request.target,
        ...(manuscriptRevisionSource ? { manuscriptRevisionSource } : {}),
      },
    },
  }
}
