import { createHash } from 'node:crypto'
import type { AppConfig } from '../../config.ts'
import { resolvePrimaryModel } from '@shared/lib/model-slots'
import type { AgentRunTarget } from '@shared/types/agent'
import type { AgentRuntimeAdapter, RuntimeRunConfig, RuntimeStartRunArgs } from '../runtime/types.ts'

export type AgentManuscriptRevisionSource = 'agent-write' | 'agent-rewrite'

export type SdkThreadSessionMode = 'direct' | 'project-command'

export interface SdkThreadSessionContext {
  mode: SdkThreadSessionMode
  projectPath?: string
  selectedChapter?: number
  loadNarraCatRuntime: boolean
  maxTurns?: number
  allowedTools?: string[]
  compatibilityFingerprint: string
  manuscriptRevisionSource?: AgentManuscriptRevisionSource
}

export interface SdkThreadSession extends SdkThreadSessionContext {
  sessionId: string
}

export type CreateSessionFingerprintFn = (input: {
  config: AppConfig
  mode: SdkThreadSessionMode
  projectPath?: string
  loadNarraCatRuntime: boolean
  maxTurns?: number
  allowedTools?: string[]
  /** 本次 run 的 runtime 标识（adapter id）：切 runtime 必须触发会话失效（设计规格会话行），
   * 杜绝把 claude-sdk 的 session id 喂给 pi（或反之）。 */
  runtimeId: AgentRuntimeAdapter['id']
}) => Promise<string>

/**
 * 会话兼容性指纹：同一 thread 复用 SDK session 前用它判断"环境没变"。优先用注入的
 * createSessionFingerprint（内容级指纹，含 agent-core 版本/用户 Skill 快照，由 IPC 层默认实现注入），
 * 缺省退化为对 provider+basis 的简单 hash（测试常用路径）。从 run-manager.ts 原样迁出，仅把
 * deps.createSessionFingerprint 闭包捕获改为显式参数。
 */
export async function sessionFingerprint(
  config: AppConfig,
  runtimeId: AgentRuntimeAdapter['id'],
  context: Omit<SdkThreadSessionContext, 'compatibilityFingerprint'>,
  createSessionFingerprint?: CreateSessionFingerprintFn,
): Promise<string> {
  const basis = {
    mode: context.mode,
    projectPath: context.projectPath,
    loadNarraCatRuntime: context.loadNarraCatRuntime,
    maxTurns: context.maxTurns,
    allowedTools: context.allowedTools,
    runtimeId,
  }
  if (createSessionFingerprint) return createSessionFingerprint({ config, ...basis })
  const provider = resolvePrimaryModel(config)?.provider ?? null
  return createHash('sha256').update(JSON.stringify({ provider, ...basis })).digest('hex')
}

export async function contextWithFingerprint(
  config: AppConfig,
  runtimeId: AgentRuntimeAdapter['id'],
  context: Omit<SdkThreadSessionContext, 'compatibilityFingerprint'>,
  createSessionFingerprint?: CreateSessionFingerprintFn,
): Promise<SdkThreadSessionContext> {
  return {
    ...context,
    compatibilityFingerprint: await sessionFingerprint(config, runtimeId, context, createSessionFingerprint),
  }
}

/**
 * 六条 run 路径里五条（write-next / recover-write / narracat-command / engineContext freeform /
 * direct-chat 兜底）都是"runtime.createRunOptions(...) 组装本次 run 的 runtime options，紧接着
 * contextWithFingerprint(...) 算出供下次 resume 比对的会话上下文"这一对操作，逐分支重复。第六条
 * （resume 既有 project-command 会话的 freeform 续聊）复用会话自身已有的指纹，不经过本函数——见
 * paths/resumed-command-path.ts。
 *
 * maxTurns/allowedTools/loadNarraCatRuntime 原样透传进两次调用，不做默认值解析：adapter 的
 * createRunOptions 内部对 maxTurns/allowedTools 缺省时另有默认值，但会话指纹 basis 要看"调用方本次
 * 显式传了什么"，两者不对齐是原 run-manager.ts 六处调用点分别调用两个函数时的既有行为，这里原样保留。
 *
 * resume（direct-chat 复用同 thread 既有会话时传）只进 runtime options，不进指纹 basis——指纹
 * 描述的是"环境是否还兼容"，与本次续接哪个 session 无关。
 */
export interface BuildRunOptionsArgs extends Omit<RuntimeRunConfig, 'loadNarraCatRuntime'> {
  runtime: AgentRuntimeAdapter
  loadNarraCatRuntime: boolean
  sessionMode: SdkThreadSessionMode
  selectedChapter?: number
  manuscriptRevisionSource?: AgentManuscriptRevisionSource
  createSessionFingerprint?: CreateSessionFingerprintFn
}

export interface RunOptionsWithSessionContext {
  options: RuntimeStartRunArgs['options']
  sessionContext: SdkThreadSessionContext
}

export async function buildRunOptionsWithSessionContext(
  args: BuildRunOptionsArgs,
): Promise<RunOptionsWithSessionContext> {
  const { runtime, sessionMode, selectedChapter, manuscriptRevisionSource, createSessionFingerprint, ...runConfig } =
    args
  const options = await runtime.createRunOptions(runConfig)
  const sessionContext = await contextWithFingerprint(
    args.config,
    runtime.id,
    {
      mode: sessionMode,
      projectPath: args.projectPath,
      selectedChapter,
      loadNarraCatRuntime: args.loadNarraCatRuntime,
      maxTurns: args.maxTurns,
      allowedTools: args.allowedTools,
      manuscriptRevisionSource,
    },
    createSessionFingerprint,
  )
  return { options, sessionContext }
}

/**
 * 一条 run 路径解析完成后，streamRun 需要的完整启动素材：prompt + runtime options（对上层不透明，
 * 原样传回 runtime.startRun）+ 供下次 resume 比对的会话上下文 + （如涉及项目改动）streamRun 的
 * projectUpdate 参数。六条 paths/*-path.ts 模块的产出统一收敛成这个形状，run-manager.ts 的
 * startRun 只管「选路径 → 取 RunPlan → 调 streamRun」，不再各自摆一套字段。
 */
export interface RunPlan {
  prompt: RuntimeStartRunArgs['prompt']
  options: RuntimeStartRunArgs['options']
  sessionContext: SdkThreadSessionContext
  projectUpdate?: {
    projectPath: string
    selectedChapter?: number
    target?: AgentRunTarget
    manuscriptRevisionSource?: AgentManuscriptRevisionSource
  }
}

/**
 * 路径解析结果：write-next/recover-write/narracat-command/engineContext freeform 四条分支在拿到
 * RunPlan 前有前置校验（缺 projectPath / 缺 agent-core manifest），失败时原 run-manager.ts 用
 * `preparationFailure` 变量记录错误文案，交给外层统一发布 run.failed——这里用判别联合体把「路径解析
 * 也可能失败」这件事显式建模，取代原来隐式共享的外层变量。
 */
export type RunPlanResult = { ok: true; plan: RunPlan } | { ok: false; preparationFailure: string }
