// resolveAgentSkillOverrides：run 启动时把「Agent Core 默认 skills + 官方挂载叠加 + 用户自定义 Skill」
// 组装成 SDK `agents` option 覆盖。串起 diagnostics（默认源）→ SkillMountStore（官方用户叠加）→
// UserSkillStore（用户 Skill 名单 + 正文）→ assembleAgentSkills（全量 AssembledAgentDefinition 组装：官方挂载
// 走 skills 字段 eager 注入，用户 Skill 正文走 prompt inline）。
//
// 阶段2切片④（2026-07-31）：用户 Skill 不再复制进 `<project>/.claude/skills/`（原文件搬运链已整链
// 删除）——SKILL.md 正文 inline 进 agent prompt 是唯一确定性生效通道（SDK definition.skills 的 eager
// 预加载实测不触发），故用户 skill 名也不再登记进 `definition.skills`（没有文件背书的名字不登记，
// 登记面 = user-skills.json 存量店）。见 ADR-0020 补记。
//
// 顺手扫一次崩溃残留（评审 task-6-review.md Important#2）：原搬运链自带「下次 run 清掉上次崩溃没清
// 干净的临时副本」自愈，删链后该自愈路径消失，而 SDK 侧仍会扫 `<project>/.claude/skills/`——老项目
// 里带标记的残留目录会继续被当项目级 skill 发现，与挂载/卸载状态脱钩。故每次「本次 run 走引擎待遇」
// （即拿到 projectPath）时，都顺手 best-effort 清一遍（sweepStaleUserSkillCopies，只删带标记的，
// 无标记的作者资产绝不碰），不复活整条同步/清理链。
//
// 返回 { agents }：喂 SDK agents option。
//
// 降级：任一步失败一律降级 agents=undefined，退回 plugin frontmatter 默认，绝不阻断 Agent 运行——
// 对齐既有「失败降级 undefined」纪律。

import type { AssembledAgentDefinition } from './assemble-agent-skills.ts'
import type { AgentSkillMount, UserSkill } from '@shared/types/skill-mount'
import { readNarraCatAgentCoreDiagnostics } from './agent-core-contract.ts'
import { listSkillMounts } from './skill-mount-store.ts'
import { listUserSkills, readUserSkillBody, userSkillStorePath } from './user-skill-store.ts'
import { assembleAgentSkills } from './assemble-agent-skills.ts'
import { sweepStaleUserSkillCopies } from './sweep-stale-user-skill-copies.ts'

export interface ResolveAgentSkillOverridesArgs {
  agentCorePath: string
  skillMountStorePath: string
  /**
   * 用户自定义 Skill 注入所需。两者齐备时才注入用户 Skill（引擎待遇的 run 才注入，门的语义从
   * 「有无处落盘」变为「本次 run 是否走 loadNarraCatRuntime」）；缺其一（如无项目的直聊、或非
   * NarraCat 运行时）则跳过用户 Skill，只组装官方挂载。
   */
  projectPath?: string
  userDataPath?: string
}

/** run 用的 skill 覆盖结果：agents 喂 SDK agents option。 */
export interface ResolvedRunAgentSkills {
  agents: Record<string, AssembledAgentDefinition> | undefined
}

/**
 * 依赖注入（默认即真实实现）：仅为隔离测试「diagnostics→store→assemble→失败降级」这条
 * 关键接缝而存在。生产路径不传 deps，走默认。
 */
export interface ResolveAgentSkillOverridesDeps {
  readDiagnostics?: (agentCorePath: string) => Promise<{ agentSkills: Record<string, string[]>; availableSkills: string[] }>
  listMounts?: (skillMountStorePath: string) => Promise<AgentSkillMount[]>
  listUserMounts?: (userSkillStorePath: string) => Promise<UserSkill[]>
  assemble?: typeof assembleAgentSkills
  readUserSkillBody?: typeof readUserSkillBody
  sweepStaleCopies?: typeof sweepStaleUserSkillCopies
}

/**
 * 按「本次 run 实际注入的名单」读各用户 Skill 的 SKILL.md 正文（退路 A，#295）：agent id → [{ name, body }]。
 * 正文供 assemble inline 进该 Agent 的 prompt。读失败 / 空正文跳过（降级，不阻断）。
 */
async function collectUserSkillBodies(
  userSkills: UserSkill[],
  namesByAgent: Record<string, string[]>,
  userDataPath: string,
  readBody: typeof readUserSkillBody,
): Promise<Record<string, { name: string; body: string }[]>> {
  const bodiesByAgent: Record<string, { name: string; body: string }[]> = {}
  for (const [agentId, names] of Object.entries(namesByAgent)) {
    for (const name of names) {
      const skill = userSkills.find((item) => item.agentId === agentId && item.name === name)
      if (!skill) continue
      let body = ''
      try {
        body = await readBody({ id: skill.id, userDataPath })
      } catch {
        continue // 读正文失败（含非法 id 守卫抛错）→ 跳过该条，绝不阻断 run（该条无正文可 inline，静默失效）
      }
      if (body.trim()) (bodiesByAgent[agentId] ??= []).push({ name, body })
    }
  }
  return bodiesByAgent
}

export async function resolveAgentSkillOverrides(
  { agentCorePath, skillMountStorePath, projectPath, userDataPath }: ResolveAgentSkillOverridesArgs,
  deps: ResolveAgentSkillOverridesDeps = {},
): Promise<ResolvedRunAgentSkills> {
  const readDiagnostics = deps.readDiagnostics ?? readNarraCatAgentCoreDiagnostics
  const listMounts = deps.listMounts ?? listSkillMounts
  const listUserMounts = deps.listUserMounts ?? listUserSkills
  const assemble = deps.assemble ?? assembleAgentSkills
  const readBody = deps.readUserSkillBody ?? readUserSkillBody
  const sweepStaleCopies = deps.sweepStaleCopies ?? sweepStaleUserSkillCopies

  try {
    // 用户 Skill 仅在「有项目 + 有 userData」时注入（引擎待遇 run 才注入）；
    // 二者缺一则该次 run 只走官方挂载，userSkills 视作空。
    const includeUserSkills = Boolean(projectPath && userDataPath)
    // 崩溃残留清扫只依赖 projectPath（纯粹是该 project 下 .claude/skills/ 的文件操作，与 userDataPath
    // 无关）；与下面三步并发，best-effort、内部已吞错，这里再兜一层 .catch 防御式对齐「绝不阻断 run」。
    const sweepPromise = projectPath ? sweepStaleCopies(projectPath).catch(() => {}) : Promise.resolve()

    const [diagnostics, userMounts, userSkills] = await Promise.all([
      readDiagnostics(agentCorePath),
      listMounts(skillMountStorePath),
      includeUserSkills ? listUserMounts(userSkillStorePath(userDataPath!)) : Promise.resolve<UserSkill[]>([]),
      sweepPromise,
    ])

    // 无任何叠加（官方挂载 + 用户 Skill 都空）→ 纯默认，不必组装（plugin frontmatter 已是默认）
    if (userMounts.length === 0 && userSkills.length === 0) return { agents: undefined }

    let userSkillNamesByAgent: Record<string, string[]> = {}
    let userSkillBodiesByAgent: Record<string, { name: string; body: string }[]> = {}
    if (userSkills.length > 0 && includeUserSkills) {
      for (const skill of userSkills) (userSkillNamesByAgent[skill.agentId] ??= []).push(skill.name)
      // 退路 A（#295 修复，现为唯一通道）：读每个挂载用户 Skill 的 SKILL.md 正文，供 assemble inline
      // 进该 Agent 的 prompt，保证写作指令一定在上下文——不赌 SDK 对 definition.skills 的 eager 预加载
      // （实测不触发）。不再有「复制进 project」这一步，名单直接来自 user-skills.json 存量。
      userSkillBodiesByAgent = await collectUserSkillBodies(userSkills, userSkillNamesByAgent, userDataPath!, readBody)
    }

    const agents = await assemble({
      agentCorePath,
      defaultSkillsByAgent: diagnostics.agentSkills,
      availableSkills: diagnostics.availableSkills,
      userMounts,
      userSkillNamesByAgent,
      userSkillBodiesByAgent,
    })
    // dev 可观察性：inline 是唯一生效通道，这行日志是唯一观测点——必须报「效果」（实际 inline 了
    // 什么），不能报「意图」（挂载名单）。userSkillNamesByAgent 只是 store 存量分组，正文读失败/为空
    // 的条目不会被 collectUserSkillBodies 收进 userSkillBodiesByAgent，故日志改由后者派生：登记数
    // 与实际 inline 数分开报，两者不等时能直接看出有条目静默失效（评审 Important#1）。
    if (userSkills.length > 0) {
      const inlinedCount = Object.values(userSkillBodiesByAgent).reduce((sum, items) => sum + items.length, 0)
      const inlined = Object.entries(userSkillBodiesByAgent)
        .map(([agent, items]) => `${agent} ← [${items.map((item) => item.name).join(', ')}]`)
        .join(' · ')
      console.log(
        `[narracat] 用户 Skill 注入：登记 ${userSkills.length} 条 → 实际 inline ${inlinedCount} 条 ${
          inlined || '（无：正文为空或读取失败）'
        }`,
      )
    }
    return { agents: Object.keys(agents).length > 0 ? agents : undefined }
  } catch {
    // 任一步失败一律降级，退回 plugin frontmatter 默认，绝不阻断
    return { agents: undefined }
  }
}
