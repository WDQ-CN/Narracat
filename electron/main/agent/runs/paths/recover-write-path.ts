import type { AgentRunRequest } from '../../../agent-runner.ts'
import type { AppConfig } from '../../../config.ts'
import { buildRunOptionsWithSessionContext } from '../run-options.ts'
import type { CreateSessionFingerprintFn, RunPlanResult } from '../run-options.ts'
import { NARRACAT_COMMAND_ALLOWED_TOOLS } from '../../runtime/allowed-tools.ts'
import type { AgentRuntimeAdapter, RuntimeRunConfig } from '../../runtime/types.ts'
import { resolveRecoverWriteRun } from '../recover-write.ts'
import type { ReadNarraCatCommandFile } from '../narracat-command.ts'

export interface RecoverWritePathInput {
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
 * 继续完成本章（recover-write）：接续一次意外中断的写作，从断点续跑而非重写全章。打
 * manuscriptRevisionSource: 'agent-write' 正文版本索引标记（与 write-next 同一档，都是产出正文的
 * 写手动作）。从 run-manager.ts startRun 原样迁出。
 */
export async function buildRecoverWriteRunPlan(input: RecoverWritePathInput): Promise<RunPlanResult> {
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
    return { ok: false, preparationFailure: '继续完成本章需要先打开一个小说项目。' }
  }

  const resolved = await resolveRecoverWriteRun(
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
