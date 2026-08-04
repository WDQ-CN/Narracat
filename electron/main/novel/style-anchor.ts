// electron/main/novel/style-anchor.ts
import { callEngineToolRaw, type EngineToolPaths } from './character-state-edit.ts'

/**
 * 本书声音样章锚（P1B 刀2）：作者在正文里划选标记的定稿段落，写手写新章时照它的语感写。
 * 写权限归引擎工具独占（上限/长度/正文存在性校验都在引擎侧），App 经一次性 MCP client 直调、零 LLM。
 * 两个工具有意不在 agent 白名单里（见 sdk-runner.ts 回归断言）。
 */

const SUBMIT_TOOL = 'novel_submit_style_anchor'
const LIST_TOOL = 'novel_list_style_anchors'

export interface StyleAnchor {
  anchorId: string
  chapter: number
  excerpt: string
  createdAt: string
}

export interface SubmitStyleAnchorRequest {
  projectPath: string
  action: 'add' | 'remove'
  chapter?: number
  excerpt?: string
  anchorId?: string
}

function readTrimmed(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/** 纯函数：解析标记/删除入参，非法时抛 Error（人话文案，直接给 UI 用） */
export function parseSubmitStyleAnchorInput(input: unknown): SubmitStyleAnchorRequest {
  const raw = input as Record<string, unknown>
  const projectPath = readTrimmed(raw?.projectPath)
  if (!projectPath) throw new Error('缺少项目路径')

  const action = raw?.action
  if (action !== 'add' && action !== 'remove') throw new Error('操作类型不合法')

  if (action === 'remove') {
    const anchorId = readTrimmed(raw?.anchorId)
    if (!anchorId) throw new Error('缺少要删除的样章标识')
    return { projectPath, action, anchorId }
  }

  const chapter = raw?.chapter
  if (typeof chapter !== 'number' || !Number.isInteger(chapter) || chapter < 1) {
    throw new Error('缺少章号')
  }
  const excerpt = readTrimmed(raw?.excerpt)
  if (!excerpt) throw new Error('请先选中一段正文')
  return { projectPath, action, chapter, excerpt }
}

export async function submitStyleAnchor(
  request: SubmitStyleAnchorRequest,
  paths: EngineToolPaths,
): Promise<{ ok: boolean; message?: string; anchorId?: string; total?: number }> {
  const args: Record<string, unknown> =
    request.action === 'remove'
      ? { action: 'remove', anchor_id: request.anchorId }
      : { action: 'add', chapter: request.chapter, excerpt: request.excerpt }
  try {
    const raw = (await callEngineToolRaw(request.projectPath, SUBMIT_TOOL, args, paths)) as {
      anchor_id?: string
      total?: number
    }
    return { ok: true, anchorId: raw?.anchor_id, total: raw?.total }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '保存失败，请稍后重试。' }
  }
}

export async function listStyleAnchors(
  request: { projectPath: string },
  paths: EngineToolPaths,
): Promise<{ ok: boolean; anchors: StyleAnchor[]; max: number; message?: string }> {
  try {
    const raw = (await callEngineToolRaw(request.projectPath, LIST_TOOL, {}, paths)) as {
      anchors?: Array<{ anchor_id: string; chapter: number; excerpt: string; created_at: string }>
      max?: number
    }
    return {
      ok: true,
      max: typeof raw?.max === 'number' ? raw.max : 3,
      anchors: (raw?.anchors ?? []).map((item) => ({
        anchorId: item.anchor_id,
        chapter: item.chapter,
        excerpt: item.excerpt,
        createdAt: item.created_at,
      })),
    }
  } catch (error) {
    return {
      ok: false,
      anchors: [],
      max: 3,
      message: error instanceof Error ? error.message : '读取失败，请稍后重试。',
    }
  }
}
