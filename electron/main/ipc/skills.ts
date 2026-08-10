import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readOfficialSkillBody } from '../engine/official-skill-body.ts'
import { NARRACAT_ENGINE_AGENT_IDS } from '../engine/agent-core-contract.ts'
import {
  proseOverrideStorePath,
  readProseOverrides,
  removeProseOverride,
  removeProseOverrides,
  setProseOverride,
} from '../engine/prose-override-store.ts'
import { buildProseBlockViews, currentBlockIds, isKnownProseAgentId } from './prose-blocks.ts'
import { parseProseBlocks } from '@shared/lib/prose-blocks'
import type { ProseBlockView } from '@shared/types/prose-block'
import { invalidateAgentSessions } from './agent.ts'
import { currentAgentCorePath } from './app.ts'
import { readInputRecord, readRequiredString, userDataPath } from './inputs.ts'
import {
  addAuthorRequest,
  authorRequestStorePath,
  listAuthorRequests,
  removeAuthorRequest,
  updateAuthorRequest,
} from '../engine/author-request-store.ts'
import { filterRequestsByAgent } from './author-requests.ts'
import type { AuthorRequest } from '@shared/types/author-request'

export function registerSkillsIpcHandlers(): void {
  // 读官方 Skill 正文（只读可见，Task 7：ADR-0020 约束 1 的「不可查看」半条已推翻，见
  // docs/superpowers/specs/2026-08-06-agent-prose-user-editing-design.md §2.3）。「不可编辑」继续成立，
  // 本通道只读、不提供任何写路径。skillId 越界守卫与读失败降级在 official-skill-body.ts 内处理。
  ipcMain.handle('official-skill:read-body', async (_event, input: unknown): Promise<string> => {
    const value = readInputRecord(input, '读取官方技能正文参数非法。')
    const skillId = readRequiredString(value, 'skillId', '缺少技能 id。')
    return readOfficialSkillBody({ agentCorePath: currentAgentCorePath(), skillId })
  })

  /**
   * 读某 agent 的 .md 原文；读不到返回空串（降级为「该 agent 没有可调整的写作指令」）。
   * agentId 先过白名单：这里会拼进文件路径，渲染端理论上可传任意字符串（含 `../` 越界形式），
   * 不校验就直接读文件是路径穿越风险，故先挡在拼路径之前。
   */
  async function readAgentText(agentId: string): Promise<string> {
    if (!isKnownProseAgentId(agentId)) throw new Error('找不到这个 Agent，请刷新后重试。')
    try {
      return await readFile(join(currentAgentCorePath(), 'agents', `${agentId}.md`), 'utf-8')
    } catch {
      return ''
    }
  }

  /** 仅供展示与排障，不参与任何判定（「官方是否改过」只看 baseText），读失败降级空串无害。 */
  async function currentEngineVersion(): Promise<string> {
    try {
      const raw = await readFile(join(currentAgentCorePath(), 'narracat.manifest.json'), 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      return typeof parsed === 'object' && parsed !== null && typeof (parsed as { version?: unknown }).version === 'string'
        ? (parsed as { version: string }).version
        : ''
    } catch {
      return ''
    }
  }

  /**
   * 全部内置 Agent 当前定义的块 id 全集，供孤儿判定用（见 buildProseBlockViews 顶部注释：
   * 孤儿必须是「哪个 Agent 都不认领」，不能只看当前这一个 Agent，否则会把别的 Agent 的覆盖
   * 误当成孤儿）。每个 Agent 文件独立读、独立降级——某一份缺失或读取失败只是那个 Agent
   * 贡献 0 个 id，不拖垮其余几个（沿用 readAgentText 既有的 fail-soft 纪律）。
   * 5 个小 markdown 文件，代价可忽略。
   */
  async function readAllKnownBlockIds(): Promise<Set<string>> {
    const texts = await Promise.all(NARRACAT_ENGINE_AGENT_IDS.map((id) => readAgentText(id)))
    const known = new Set<string>()
    for (const text of texts) {
      for (const id of currentBlockIds(text)) known.add(id)
    }
    return known
  }

  async function listProseBlockViews(agentId: string): Promise<ProseBlockView[]> {
    const [agentText, overrides, knownIdsAcrossAgents] = await Promise.all([
      readAgentText(agentId),
      readProseOverrides(proseOverrideStorePath(userDataPath())),
      readAllKnownBlockIds(),
    ])
    return buildProseBlockViews({ agentText, overrides, knownIdsAcrossAgents })
  }

  ipcMain.handle('prose-blocks:list', async (_event, input: unknown): Promise<ProseBlockView[]> => {
    const value = readInputRecord(input, '读取写作指令调整参数非法。')
    const agentId = readRequiredString(value, 'agentId', '缺少 Agent id。')
    return listProseBlockViews(agentId)
  })

  ipcMain.handle('prose-blocks:set', async (_event, input: unknown): Promise<ProseBlockView[]> => {
    const value = readInputRecord(input, '保存写作指令调整参数非法。')
    const agentId = readRequiredString(value, 'agentId', '缺少 Agent id。')
    const id = readRequiredString(value, 'id', '缺少调整项 id。')
    const text = typeof value.text === 'string' ? value.text : ''

    // baseText 一律从当前引擎原文现取，不信任渲染端传值——渲染端可能拿着陈旧快照，
    // 存错了会让「官方是否改过」的判定永久失真。
    const block = parseProseBlocks(await readAgentText(agentId)).find((item) => item.id === id)
    if (!block) throw new Error('这一段官方内容已不存在，请刷新后重试。')

    await setProseOverride({
      storePath: proseOverrideStorePath(userDataPath()),
      id,
      text,
      baseText: block.body,
      baseEngineVersion: await currentEngineVersion(),
      now: new Date().toISOString(),
    })

    await invalidateAgentSessions('prose-blocks-changed')
    return listProseBlockViews(agentId)
  })

  ipcMain.handle('prose-blocks:reset', async (_event, input: unknown): Promise<ProseBlockView[]> => {
    const value = readInputRecord(input, '恢复写作指令调整参数非法。')
    const agentId = readRequiredString(value, 'agentId', '缺少 Agent id。')
    const id = readRequiredString(value, 'id', '缺少调整项 id。')
    await removeProseOverride({ storePath: proseOverrideStorePath(userDataPath()), id })
    await invalidateAgentSessions('prose-blocks-changed')
    return listProseBlockViews(agentId)
  })

  // 恢复「当前 Agent」的官方默认，不是全局清空（原设计缺陷：按钮长在某个 Agent 的面板里，
  // 作者的合理预期就是只影响这个 Agent）。只清该 Agent 当前文件里定义的那批块 id；
  // 孤儿存量（id 已不在任何引擎文件里）无法归属到某个 Agent，保持不动——UI 已有逐条删除的入口。
  ipcMain.handle('prose-blocks:reset-all', async (_event, input: unknown): Promise<ProseBlockView[]> => {
    const value = readInputRecord(input, '恢复写作指令参数非法。')
    const agentId = readRequiredString(value, 'agentId', '缺少 Agent id。')

    const ids = currentBlockIds(await readAgentText(agentId))
    await removeProseOverrides({ storePath: proseOverrideStorePath(userDataPath()), ids })

    await invalidateAgentSessions('prose-blocks-changed')
    return listProseBlockViews(agentId)
  })

  /**
   * 「我对它的要求」四频道。agentId 一律先过引擎 agent 白名单（与 prose-blocks 同一道防线：
   * 渲染端理论上可传任意字符串，本组虽不拼文件路径，但存量里混进未知 agentId 会让那条要求
   * 永远无处显示、也永远注入不了，等于静默丢失）。
   * 写操作后都要 invalidateAgentSessions——常驻会话不刷新就还拿着旧 prompt。
   */
  function assertKnownAgent(agentId: string): void {
    if (!isKnownProseAgentId(agentId)) throw new Error('找不到这个 Agent，请刷新后重试。')
  }

  async function listRequestsFor(agentId: string): Promise<AuthorRequest[]> {
    const all = await listAuthorRequests(authorRequestStorePath(userDataPath()))
    return filterRequestsByAgent(all, agentId)
  }

  ipcMain.handle('author-requests:list', async (_event, input: unknown): Promise<AuthorRequest[]> => {
    const value = readInputRecord(input, '读取要求参数非法。')
    const agentId = readRequiredString(value, 'agentId', '缺少 Agent id。')
    assertKnownAgent(agentId)
    return listRequestsFor(agentId)
  })

  ipcMain.handle('author-requests:add', async (_event, input: unknown): Promise<AuthorRequest[]> => {
    const value = readInputRecord(input, '新增要求参数非法。')
    const agentId = readRequiredString(value, 'agentId', '缺少 Agent id。')
    const text = readRequiredString(value, 'text', '要求的内容不能为空。')
    assertKnownAgent(agentId)

    await addAuthorRequest({
      storePath: authorRequestStorePath(userDataPath()),
      agentId,
      text,
      now: new Date().toISOString(),
    })
    await invalidateAgentSessions('author-requests-changed')
    return listRequestsFor(agentId)
  })

  ipcMain.handle('author-requests:update', async (_event, input: unknown): Promise<AuthorRequest[]> => {
    const value = readInputRecord(input, '保存要求参数非法。')
    const agentId = readRequiredString(value, 'agentId', '缺少 Agent id。')
    const id = readRequiredString(value, 'id', '缺少要求 id。')
    const text = readRequiredString(value, 'text', '要求的内容不能为空。')
    assertKnownAgent(agentId)

    await updateAuthorRequest({ storePath: authorRequestStorePath(userDataPath()), id, text })
    await invalidateAgentSessions('author-requests-changed')
    return listRequestsFor(agentId)
  })

  ipcMain.handle('author-requests:remove', async (_event, input: unknown): Promise<AuthorRequest[]> => {
    const value = readInputRecord(input, '删除要求参数非法。')
    const agentId = readRequiredString(value, 'agentId', '缺少 Agent id。')
    const id = readRequiredString(value, 'id', '缺少要求 id。')
    assertKnownAgent(agentId)

    await removeAuthorRequest({ storePath: authorRequestStorePath(userDataPath()), id })
    await invalidateAgentSessions('author-requests-changed')
    return listRequestsFor(agentId)
  })
}
