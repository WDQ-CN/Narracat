// resolveAgentSkillOverrides：run 启动时把「作者的散文块覆盖 + 作者写的要求」组装成运行时
// `agents` option 覆盖。
//
// 历史：本文件原先还串 SkillMountStore（官方挂载叠加）与 UserSkillStore（文件夹快照），两者
// 已整体退役（spec 2026-08-07 §6.1）——文件夹通道承诺的 references/scripts 从不生效，而官方
// Skill 在 UI 上已改为纯只读，没有任何挂/卸入口。
//
// 降级：任一步失败一律降级 agents=undefined，退回引擎默认，绝不阻断 Agent 运行。

import type { AssembledAgentDefinition } from './assemble-agent-skills.ts'
import type { AuthorRequest } from '@shared/types/author-request'
import { NARRACAT_ENGINE_AGENT_IDS } from './agent-core-contract.ts'
import { assembleAgentSkills } from './assemble-agent-skills.ts'
import { authorRequestStorePath, listAuthorRequests } from './author-request-store.ts'
import { proseOverrideStorePath, readProseOverrides } from './prose-override-store.ts'

export interface ResolveAgentSkillOverridesArgs {
  agentCorePath: string
  /** 作者侧存量（散文覆盖 + 要求）的落盘根目录。缺省则本次 run 不带任何作者调整。 */
  userDataPath?: string
}

/** run 用的覆盖结果：agents 喂运行时 agents option。 */
export interface ResolvedRunAgentSkills {
  agents: Record<string, AssembledAgentDefinition> | undefined
}

/**
 * 依赖注入（默认即真实实现）：仅为隔离测试「读存量 → assemble → 失败降级」这条关键接缝而存在。
 * 生产路径不传 deps，走默认。
 */
export interface ResolveAgentSkillOverridesDeps {
  listRequests?: typeof listAuthorRequests
  readProseOverrides?: typeof readProseOverrides
  assemble?: typeof assembleAgentSkills
}

/** 按 agentId 分组要求正文，保持存量顺序（store 已按写入先后追加）。 */
function groupRequestTexts(requests: AuthorRequest[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}
  for (const request of requests) {
    if (!request.text.trim()) continue
    ;(grouped[request.agentId] ??= []).push(request.text)
  }
  return grouped
}

export async function resolveAgentSkillOverrides(
  { agentCorePath, userDataPath }: ResolveAgentSkillOverridesArgs,
  deps: ResolveAgentSkillOverridesDeps = {},
): Promise<ResolvedRunAgentSkills> {
  const listRequests = deps.listRequests ?? listAuthorRequests
  const readProse = deps.readProseOverrides ?? readProseOverrides
  const assemble = deps.assemble ?? assembleAgentSkills

  try {
    if (!userDataPath) return { agents: undefined }

    const [requests, proseOverrides] = await Promise.all([
      listRequests(authorRequestStorePath(userDataPath)),
      readProse(proseOverrideStorePath(userDataPath)),
    ])

    // 无任何作者调整 → 纯默认，不必组装
    if (requests.length === 0 && Object.keys(proseOverrides).length === 0) {
      return { agents: undefined }
    }

    const authorRequestsByAgent = groupRequestTexts(requests)
    const agents = await assemble({
      agentCorePath,
      agentIds: [...NARRACAT_ENGINE_AGENT_IDS],
      authorRequestsByAgent,
      proseOverrides,
    })

    // dev 可观察性：inline 是唯一生效通道，这行日志是唯一观测点——报「效果」（实际注入了什么），
    // 不报「意图」。存量条数与实际分组分开报，两者对不上时能直接看出有条目静默失效。
    if (requests.length > 0) {
      const summary = Object.entries(authorRequestsByAgent)
        .map(([agentId, texts]) => `${agentId} ← ${texts.length} 条`)
        .join(' · ')
      console.log(`[narracat] 作者要求注入：存量 ${requests.length} 条 → ${summary || '（无：全部为空）'}`)
    }

    return { agents: Object.keys(agents).length > 0 ? agents : undefined }
  } catch {
    // 任一步失败一律降级，退回引擎默认，绝不阻断
    return { agents: undefined }
  }
}
