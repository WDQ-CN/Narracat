import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { resolvePrimaryModel } from '@shared/lib/model-slots'
import { getApiKey } from '../secrets.ts'
import { currentAgentCorePath } from '../ipc/app.ts'
import { readCurrentConfig, userDataPath } from '../ipc/inputs.ts'
import { resolveAgentRuntime } from '../agent/runtime/resolve-runtime.ts'
import { readNarraCatCommandFile } from '../agent/runs/narracat-command.ts'
import { createLearnPathGuard } from './learn-path-guard.ts'
import { runSandboxSessionLoop } from './sandbox-session.ts'

/** 学习会话最大回合数（spike task-1-report.md 差异清单③）：多轮 Read 覆盖多章节比一般 command 更吃
 * 回合，且 deepseek 等非官方 Anthropic 端点比 GLM 慢，比一般 command 的默认回合宽松得多。 */
const LEARN_SESSION_MAX_TURNS = 200

/**
 * 学习会话生产依赖（拆旧刀2 起 runtime 中立）：resolveAgentRuntime(config) 跟随「创作引擎」配置，
 * 经 createSandboxedRunOptions 收窄 + runSandboxSessionLoop 消费归一化事件，不再碰任何 runtime
 * 原始消息形状。沙盒纪律不变（spike task-1-report.md 差异清单落地结论）：
 * ① 工具面收紧走 sandbox.tools=['Read','Write','Glob']，不叠加 allowedTools（其语义是免弹权限
 *   确认名单，与「限制工具集」无关）；
 * ② 不设 bypassPermissions（否则 canUseTool 不会被调用，路径沙盒失效）；
 * ③ maxTurns 调宽到 200，且必须处理非 success 收尾（回合上限等），不能假设永远成功；
 * ④ model 由 adapter 按主力槽（resolvePrimaryModel）解析，不硬编码具体模型 id。
 * loadNarraCatRuntime:false（不挂 NarraCat 引擎运行时）、projectPath 传 workspaceDir（即 cwd）。
 * abort 桥接：内部起一个新 AbortController 供 runtime 用，监听调用方传入的 signal 转发 abort。
 */
export async function runLearnSession(input: {
  prompt: string
  workspaceDir: string
  signal: AbortSignal
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = await readCurrentConfig()
  const primary = resolvePrimaryModel(config)
  const apiKey = primary ? await getApiKey(primary.provider) : null
  if (!apiKey) return { ok: false, error: '还没有配置 API Key，请先在设置里填写。' }
  const model = primary?.modelId
  if (!model) return { ok: false, error: '还没有配置可用模型，请先在设置里选择模型。' }

  const abortController = new AbortController()
  const onAbort = () => abortController.abort()
  if (input.signal.aborted) {
    abortController.abort()
  } else {
    input.signal.addEventListener('abort', onAbort, { once: true })
  }

  // 不设 permissionMode:'bypassPermissions' / allowDangerouslySkipPermissions（PR#477 外审
  // P1-1）：此前用 bypassPermissions 整体跳过权限层，canUseTool 即便配了也不会被调用，等于
  // 没有任何运行时路径强制——additionalDirectories 只是「允许碰哪些目录」的声明，不是拦截。
  // 也不设 allowedTools：SDK 文档明确 allowedTools 是「免弹权限确认名单」（T1 spike 已验证其语义
  // 与「限制工具集」无关），保守起见不叠加使用，避免它以未文档化的方式影响 canUseTool 是否被调用；
  // sandbox.tools 数组本身已把工具面收紧到 Read/Write/Glob 三个，不需要再靠 allowedTools 兜底。
  // 合规沙盒收窄（T11 评审 F1）：createSdkOptions 默认把 agentCorePath/novelRootDir 都塞进
  // additionalDirectories——外部书是不可信输入，prompt injection 有可能借这两个目录跨读其它
  // 小说的 bible 或往 novelRootDir 写文件。命令/方法论正文已经 inline 进 prompt、要学的章节已经
  // 拷贝进 workspaceDir，运行时不需要那两个目录——收窄到 workspaceDir 本身，对齐 spike
  // （task-1-report.md）验证过的干净单目录环境（真正的路径边界由上面的 canUseTool 强制）。
  const runtime = resolveAgentRuntime(config)
  const options = await runtime.createSandboxedRunOptions({
    config,
    apiKey,
    abortController,
    appRoot: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    userDataPath: userDataPath(),
    loadNarraCatRuntime: false,
    projectPath: input.workspaceDir,
    maxTurns: LEARN_SESSION_MAX_TURNS,
    // 路径沙盒（PR#477 外审 P1-1）：外部书正文不可信，canUseTool 在每次 Read/Write/Edit/Glob
    // 前判定目标路径是否落在 workspaceDir 边界内（含 symlink 逃逸防御），越界一律 deny——见
    // learn-path-guard.ts 头注。
    canUseTool: createLearnPathGuard(input.workspaceDir, { label: '学习' }),
    sandbox: { tools: ['Read', 'Write', 'Glob'], workspaceDir: input.workspaceDir },
  })

  try {
    const result = await runSandboxSessionLoop({ adapter: runtime, prompt: input.prompt, options })
    if (result.outcome === 'success') return { ok: true }
    if (result.outcome === 'max-turns') {
      return { ok: false, error: '这本书内容太多，学习没能在限定步数内读完。可以换「选读」档，或分几次学一本更短的书试试。' }
    }
    return { ok: false, error: result.error || '这次学习会话意外中断了，请重试。' }
  } catch (error) {
    if (input.signal.aborted) return { ok: false, error: '已取消。' }
    console.error('学习会话运行失败：', error)
    return { ok: false, error: '这次学习会话出了问题，请重试。' }
  } finally {
    input.signal.removeEventListener('abort', onAbort)
  }
}

export async function readLearnCommandSource(): Promise<string> {
  return readNarraCatCommandFile(currentAgentCorePath(), 'learn-craft')
}

export async function readLearnMethodologySource(): Promise<string> {
  return readFile(
    join(currentAgentCorePath(), 'skills/novel-reference-analysis-method/references/text-decomposition-methodology.md'),
    'utf8',
  )
}
