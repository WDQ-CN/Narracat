// resolveEffectiveMounts：把 Agent Core 默认 skills 与用户挂载叠加合并为某 Agent 的有效挂载。
//
// 纯函数（无 IO），main 进程组装 SDK Agent 与渲染端展示共用同一份语义。
//
// 合并规则：
// - 默认源（diagnostics.agentSkills）一律视为「预加载型」默认（对应 Agent Core frontmatter `skills:`）。
// - 用户叠加按 state 处理：mounted 加入、unmounted 卸载（覆盖默认，使该项不进有效集）。
// - 同一 (agentId, skillId) 的多条用户叠加以最后一条为准（IPC 写入按此语义去重）。
// - 用户挂载的 mode 覆盖默认 mode（用户把默认预加载项改挂为按需，按用户 mode 归类）。
// - 结果按 mode 分流为 preload / onDemand，各自去重、稳定顺序（默认在前，用户新增在后）。

import type {
  AgentSkillMount,
  EffectiveAgentMounts,
  ResolvedSkillMountView,
  SkillMountMode,
} from '@shared/types/skill-mount'

interface ResolveInput {
  agentId: string
  /** Agent Core 默认 skills（diagnostics.agentSkills[agentId]），均视为默认预加载 */
  defaultSkills: string[]
  /** 用户层挂载叠加（可含其它 agent 的记录，函数内自行按 agentId 过滤） */
  userMounts: AgentSkillMount[]
}

interface ResolvedEntry {
  skillId: string
  mode: SkillMountMode
  origin: 'default' | 'user'
}

/**
 * 解析某 Agent 的有效挂载明细（含来源标识），供 UI 展示与 assemble 复用。
 * 顺序：默认项（按 defaultSkills 顺序）在前，用户新增项（按 userMounts 顺序）在后。
 */
export function resolveEffectiveMountViews({ agentId, defaultSkills, userMounts }: ResolveInput): ResolvedSkillMountView[] {
  const relevant = userMounts.filter((mount) => mount.agentId === agentId)

  // 同一 skillId 的用户叠加以最后一条为准
  const userBySkill = new Map<string, AgentSkillMount>()
  for (const mount of relevant) {
    if (typeof mount.skillId === 'string' && mount.skillId.trim()) {
      userBySkill.set(mount.skillId, mount)
    }
  }

  const entries: ResolvedEntry[] = []
  const seen = new Set<string>()

  // 1. 官方默认项：锁定为 preload / default，忽略任何针对它们的用户叠加（不可卸、不可改 mode）。
  //    这保证 effective.preload 永远 ⊇ 默认集（只增不减）——agents option 仅做「默认 + 用户新增」
  //    叠加，覆盖/合并语义下都成立，不依赖未验证的 SDK 覆盖语义清空 plugin 默认（消解 #287 走查 F2）。
  for (const skillId of dedupe(defaultSkills)) {
    entries.push({ skillId, mode: 'preload', origin: 'default' })
    seen.add(skillId)
  }

  // 2. 用户新增项（不在默认集里、且为 mounted 状态）
  for (const mount of relevant) {
    if (!mount.skillId || seen.has(mount.skillId)) continue
    if (mount.state === 'unmounted') continue
    const latest = userBySkill.get(mount.skillId)
    if (latest?.state === 'unmounted') continue
    entries.push({ skillId: mount.skillId, mode: latest?.mode ?? mount.mode, origin: 'user' })
    seen.add(mount.skillId)
  }

  return entries.map(({ skillId, mode, origin }) => ({ skillId, mode, origin }))
}

/** 解析某 Agent 的有效挂载，按 mode 分流为 preload / onDemand（assemble 用） */
export function resolveEffectiveMounts(input: ResolveInput): EffectiveAgentMounts {
  const views = resolveEffectiveMountViews(input)
  return {
    agentId: input.agentId,
    preload: views.filter((view) => view.mode === 'preload').map((view) => view.skillId),
    onDemand: views.filter((view) => view.mode === 'on-demand').map((view) => view.skillId),
  }
}

function dedupe(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim() || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}
