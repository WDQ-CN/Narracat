// electron/main/packs/pack-preview.ts
//
// 造包中心「预览编排」（B2 刀3 Task 8）：卡片干跑预览——structure 卡本地映射装载文案（零出网），
// craft/persona 卡把草稿字段组 payload 交引擎 novel_pack_authoring_preview 跑真实候选池竞争，
// 报是否会被选中与理由。引擎只读工具握手仍需项目上下文（NOVEL_CONFIG_PATH），造包中心不挂靠任何
// 真实小说项目，故经 ensureAuthoringStubProject 在 userData 下建一次性最小 stub 项目应付握手。

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { callEngineToolRaw } from '../novel/character-state-edit.ts'
import { getPackDraft } from './pack-drafts'
import type { DraftCard } from '@shared/types/capability-pack'

export type AuthoringToolName = 'novel_pack_authoring_vocab' | 'novel_pack_authoring_preview'

/** stub 项目握手所需最小 config.yaml：仅 novel_id 是 loadConfig 的硬性必填字段（见 mcp-server/src/config.ts）。 */
function stubProjectDir(userDataPath: string): string {
  return join(userDataPath, 'pack-authoring-stub')
}

/**
 * 幂等：已存在 config.yaml 直接复用，不重写（造包中心专用一次性项目，非真实小说，不持有任何小说数据）。
 * 返回 stub 项目根目录（供 MCP 握手 NOVEL_CONFIG_PATH = <root>/.narracat/config.yaml）。
 */
export async function ensureAuthoringStubProject(userDataPath: string): Promise<string> {
  const projectPath = stubProjectDir(userDataPath)
  const configPath = join(projectPath, '.narracat', 'config.yaml')
  if (!existsSync(configPath)) {
    await mkdir(join(projectPath, '.narracat'), { recursive: true })
    await writeFile(configPath, 'novel_id: pack-authoring-stub\n', 'utf8')
  }
  return projectPath
}

/**
 * 造包中心专用引擎只读工具直调：先确保 stub 项目就位，再经一次性 MCP client 调用。
 * payload 直接作为工具 arguments 顶层字段（novel_pack_authoring_preview 的 handler 读 args.card，
 * 不是 args.payload.card——与 novel_submit_authored_state 一类写工具的 {payload} 包裹约定不同）。
 * 子进程集成，不入本文件单测覆盖（brief：由 Task 14 真机验证覆盖），故此函数体本身零单测断言。
 */
export async function callAuthoringTool(
  toolName: AuthoringToolName,
  payload: Record<string, unknown>,
  paths: { appRoot: string; resourcesPath?: string; userDataPath: string },
): Promise<unknown> {
  const projectPath = await ensureAuthoringStubProject(paths.userDataPath)
  return callEngineToolRaw(projectPath, toolName, payload, paths)
}

export type PreviewCardResult =
  | { status: 'ok'; kind: 'craft' | 'persona'; results: Array<{ id: string; name: string; selected: boolean; reason: string }> }
  | { status: 'ok'; kind: 'structure'; stage: string }
  | { status: 'error'; message: string }

interface PreviewDraftCardInput {
  userDataPath: string
  draftId: string
  cardId: string
  paths: { appRoot: string; resourcesPath?: string; userDataPath: string }
}

interface PreviewDraftCardDeps {
  callAuthoringTool: typeof callAuthoringTool
}

function findCard(cards: DraftCard[], cardId: string): DraftCard | undefined {
  return cards.find((c) => c.cardId === cardId)
}

/** 引擎预演结果形状防御性解析：结构不符即当作失败抛错，交调用方统一包成人话 message。 */
function parsePreviewResults(raw: unknown): Array<{ id: string; name: string; selected: boolean; reason: string }> {
  const results = (raw as { results?: unknown })?.results
  if (!Array.isArray(results)) throw new Error('预演结果格式异常，请稍后重试。')
  return results as Array<{ id: string; name: string; selected: boolean; reason: string }>
}

/**
 * 卡片干跑预览编排：
 * - 卡未完成意图理解（compiled 为空）→ 直接报错，不出网。
 * - structure 卡：装载阶段是 App 本地既有静态映射（STRUCTURE_STAGE_LABELS 同源数据），零出网。
 * - craft/persona 卡：从 compiled.fields 组 payload（缺省数组字段补 []，见 T2 遗留适配），
 *   交引擎工具把草稿卡当 user 来源候选注入真实候选池跑一遍机械选卡。
 * - 引擎调用抛错（含未编译校验拒绝/子进程异常）一律 status:'error'。
 */
export async function previewDraftCard(
  input: PreviewDraftCardInput,
  deps: PreviewDraftCardDeps = { callAuthoringTool },
): Promise<PreviewCardResult> {
  const draft = await getPackDraft({ userDataPath: input.userDataPath, draftId: input.draftId })
  const card = draft ? findCard(draft.cards, input.cardId) : undefined
  if (!card) return { status: 'error', message: '卡片不存在。' }
  if (!card.compiled) return { status: 'error', message: '先完成意图理解' }

  const fields = card.compiled.fields

  if (card.type === 'structure') {
    const stage = typeof fields.stage === 'string' ? fields.stage : ''
    return { status: 'ok', kind: 'structure', stage }
  }

  try {
    if (card.type === 'craft') {
      const payload = {
        card: {
          type: 'craft',
          id: card.cardId,
          triggers: Array.isArray(fields.triggers) ? fields.triggers : [],
          emotion_tags: Array.isArray(fields.emotion_tags) ? fields.emotion_tags : [],
          exclusions: Array.isArray(fields.exclusions) ? fields.exclusions : [],
          priority: typeof fields.priority === 'number' ? fields.priority : 50,
        },
      }
      const raw = await deps.callAuthoringTool('novel_pack_authoring_preview', payload, input.paths)
      return { status: 'ok', kind: 'craft', results: parsePreviewResults(raw) }
    }

    const payload = {
      card: {
        type: 'persona',
        id: card.cardId,
        name: card.name,
        keywords: Array.isArray(fields.keywords) ? fields.keywords : [],
      },
    }
    const raw = await deps.callAuthoringTool('novel_pack_authoring_preview', payload, input.paths)
    return { status: 'ok', kind: 'persona', results: parsePreviewResults(raw) }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : '预演失败，请稍后重试。' }
  }
}
