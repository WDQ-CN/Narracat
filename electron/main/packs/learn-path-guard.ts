/**
 * 学习会话路径沙盒（PR#477 外审 P1-1）：外部书正文是不可信输入，prompt injection 能诱导模型用
 * 绝对路径 Read/Write 工作区之外的任何文件（读别的小说/配置发给模型服务商、改写本机文件）。
 * additionalDirectories 只是「允许 SDK cwd 之外还能碰哪些目录」的白名单声明，不是运行时强制——
 * bypassPermissions 下没有任何一层真的拦路径。这里改用 SDK `canUseTool` 回调做运行时强制：
 * 每次 Read/Write/Edit/Glob 调用前算出目标路径，判定是否落在 workspaceDir 边界内。
 *
 * symlink 逃逸防御：模型工具面里没有能创建 symlink 的工具（Bash 不在学习会话工具面），但工作区里
 * 可能已存在 symlink（历史遗留/上一轮攻击残留），或目标路径的某个已存在父目录本身是 symlink——
 * 单纯字符串前缀判断挡不住「路径字面在界内、realpath 出界」。策略：目标存在则直接 realpath 目标；
 * 目标不存在（Write 新文件的常见场景）则沿路径向上找到最深的已存在祖先目录，realpath 它，再拼回
 * 剩余（未落盘、不可能是 symlink 的）路径段。
 */
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import type { RuntimeCanUseTool } from '../agent/runtime/types.ts'

const GUARDED_PATH_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'Glob'])

/** 工具输入里「目标路径」参数名不统一：SDK Read/Write/Edit 用 file_path，pi 内置工具路径字段一律 path。
 * Glob 用 path（缺省视为 cwd）。本 guard 经 RuntimeCanUseTool 中立契约同时服务 claude-sdk 与 pi 沙盒
 * 路径兼容（阶段2切片④）。 */
function extractRawPath(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName === 'Glob') {
    const path = input.path
    return typeof path === 'string' && path.trim() ? path : undefined
  }
  // SDK Read/Write/Edit 用 file_path；pi 内置工具路径字段一律 path（切片③ guard 委托时只映射
  // 工具名不改字段名）。两名并收，谁在取谁——两者都缺仍走 fail-closed deny。
  const filePath = input.file_path ?? input.path
  return typeof filePath === 'string' ? filePath : undefined
}

/**
 * 把已存在的最深祖先目录 realpath 归一化，再拼回其余（未落盘）路径段——防目标不存在但父目录是
 * symlink 的逃逸，也不会因为目标本身不存在就 throw（Write 新文件是合法场景）。
 */
function realpathResolvingMissing(absPath: string): string {
  if (existsSync(absPath)) return realpathSync(absPath)
  const parent = dirname(absPath)
  if (parent === absPath) return absPath // 到达根目录仍不存在，原样返回（后续边界判定会判它出界或界内空拼接）
  const tail = absPath.slice(parent.length)
  return realpathResolvingMissing(parent) + tail
}

/** 判定 candidate 是否落在 boundary 目录内（含 boundary 本身）。前缀判定须带分隔符，防止 `/ws-evil` 误判命中 `/ws`。 */
function isWithinBoundary(candidate: string, boundary: string): boolean {
  if (candidate === boundary) return true
  return candidate.startsWith(boundary.endsWith(sep) ? boundary : boundary + sep)
}

export interface LearnPathGuardOptions {
  /** 拒绝时是否打日志（真机 E2E 观测用；默认开）。 */
  onDeny?: (info: { toolName: string; rawPath: string | undefined; reason: string }) => void
  /** deny 文案里的会话称谓（#482）：文案会进模型上下文，措辞须随语境——学习会话传「学习」、
   * 向导会话传「向导」。缺省「学习」保持向后兼容。 */
  label?: string
}

/**
 * 创建学习/向导会话的 canUseTool 回调：Read/Write/Edit/Glob 类工具按路径边界判定，路径缺省
 * （Glob 无 path 参数，视为 cwd=workspace）直接放行；边界外一律 deny。未在收紧工具面里的
 * 工具名（理论上不会出现——`tools` 已收紧到 Read/Write/Glob，这里是防御纵深）同样 deny。
 */
export function createLearnPathGuard(workspaceDir: string, guardOptions: LearnPathGuardOptions = {}): RuntimeCanUseTool {
  // 工作区根本身也可能经过 symlink（如 macOS /tmp -> /private/tmp），realpath 一次得到真正边界，
  // 后续每次判定都拿同一个边界比较。
  const boundary = realpathSync(workspaceDir)
  const label = guardOptions.label ?? '学习'

  return async (toolName, input, options) => {
    const deny = (reason: string, rawPath?: string) => {
      guardOptions.onDeny?.({ toolName, rawPath, reason })
      return {
        behavior: 'deny' as const,
        message: reason,
        toolUseID: options.toolUseID,
      }
    }

    if (!GUARDED_PATH_TOOLS.has(toolName)) {
      return deny(`${label}会话不允许使用 ${toolName}，只能用 Read/Write/Edit/Glob 在工作区内操作。`)
    }

    const rawPath = extractRawPath(toolName, input)
    if (rawPath === undefined) {
      // Glob 缺省 path：SDK 语义等价于 cwd（即 workspaceDir 本身），界内，放行。
      if (toolName === 'Glob') {
        return { behavior: 'allow' as const, updatedInput: input, toolUseID: options.toolUseID }
      }
      // Read/Write/Edit 缺失 file_path 参数
      return deny('路径参数缺失')
    }

    const absPath = isAbsolute(rawPath) ? rawPath : resolve(workspaceDir, rawPath)
    const realPath = realpathResolvingMissing(absPath)
    if (!isWithinBoundary(realPath, boundary)) {
      return deny(`路径超出${label}工作区边界，已拒绝：${rawPath}`, rawPath)
    }
    return { behavior: 'allow' as const, updatedInput: input, toolUseID: options.toolUseID }
  }
}
