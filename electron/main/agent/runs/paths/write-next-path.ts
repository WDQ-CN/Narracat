import type { AgentRunRequest } from '../../../agent-runner.ts'
import type { AppConfig } from '../../../config.ts'
import { buildRunOptionsWithSessionContext } from '../run-options.ts'
import type { CreateSessionFingerprintFn, RunPlanResult } from '../run-options.ts'
import { NARRACAT_COMMAND_ALLOWED_TOOLS } from '../../runtime/allowed-tools.ts'
import type { AgentRuntimeAdapter, RuntimeRunConfig } from '../../runtime/types.ts'
import { resolveWriteNextRun } from '../write-next.ts'
import type { ReadNarraCatCommandFile } from '../narracat-command.ts'

export interface WriteNextPathInput {
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
 * 写下一章（write-next）：全书写作链的主刀入口，从当前进度往下写一章新正文。打
 * manuscriptRevisionSource: 'agent-write' 正文版本索引标记。从 run-manager.ts startRun 原样迁出。
 */
export async function buildWriteNextRunPlan(input: WriteNextPathInput): Promise<RunPlanResult> {
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
    return { ok: false, preparationFailure: '写下一章需要先打开一个小说项目。' }
  }

  const resolved = await resolveWriteNextRun(
    {
      projectPath: request.projectPath,
      selectedChapter: request.selectedChapter,
      userPrompt: request.prompt,
    },
    {
      pluginPath: agentCorePath,
      readCommandFile: readNarraCatCommandFile,
    },
  )

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
    selectedChapter: resolved.chapterNumber,
    manuscriptRevisionSource: 'agent-write',
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
        selectedChapter: resolved.chapterNumber,
        target: request.target,
        manuscriptRevisionSource: 'agent-write',
      },
    },
  }
}
