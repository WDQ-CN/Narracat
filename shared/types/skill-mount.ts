// Skill 挂载契约：用户为子 Agent 挂卸 Skill 的 App 层叠加模型（PRD #258 / 第三层）。
//
// Agent Core 的 agent frontmatter `skills:` 是「默认 SSOT」，挂载是 App 层在其上的叠加，
// 不改 Agent Core 文件。挂载映射持久化到 userData，下一次该 Agent run 时动态组装进 SDK。

/** 挂载类型：preload = 写入 SDK Agent skills 字段 eager 全量注入；on-demand = 保留 Skill 工具 + 注入轻量触发提示 */
export type SkillMountMode = 'preload' | 'on-demand'

/** 用户层的一条挂载叠加记录 */
export interface AgentSkillMount {
  agentId: string
  skillId: string
  mode: SkillMountMode
  /** unmounted = 用户卸载叠加（覆盖默认挂载，使默认项不进有效集）；mounted = 用户主动挂载 */
  state?: 'mounted' | 'unmounted'
}

/** 某个 Agent 的有效挂载（默认 + 用户叠加合并去重后，按 mode 分流） */
export interface EffectiveAgentMounts {
  agentId: string
  /** 有效预加载集（eager 注入 SDK Agent skills） */
  preload: string[]
  /** 有效按需集（保留 Skill 工具 + 触发点提示注入） */
  onDemand: string[]
}

/** 单条挂载在 UI 上的来源标识：default = Agent Core 默认；user = 用户叠加 */
export type SkillMountOrigin = 'default' | 'user'

/** UI 展示用的单条有效挂载项 */
export interface ResolvedSkillMountView {
  skillId: string
  mode: SkillMountMode
  origin: SkillMountOrigin
}

/**
 * 用户自定义 Skill 的一条挂载记录（ADR-0020 第四类，#292）。
 *
 * 与官方挂载（AgentSkillMount，agent-core 默认的薄叠加）是不同种类：用户 Skill 没有上游来源，
 * 自带一份 userData 快照目录（与原文件夹脱钩）+ 黑盒外的展示元数据。故独立持久化（user-skills.json），
 * 不混进 skill-mounts.json，保留 A 阶段官方挂载-卸载契约不变。
 *
 * 全局：一条记录绑定一个 Agent，跨所有 Novel project 生效。每次挂载独立（无全局库复用）。
 */
export interface UserSkill {
  /** 内部稳定 id（挂载时生成），同时是 userData/user-skills/<id>/ 快照目录名 */
  id: string
  /** 绑定的 Agent id（该 Skill 只对此 Agent 生效） */
  agentId: string
  /** SKILL.md frontmatter name（inline 注入段标题与登记名，#295 用） */
  name: string
  /** SKILL.md frontmatter description（作者面向简介；用户 Skill 正文可见，但行内只展示简介） */
  description: string
  /** 挂载来源文件夹的绝对路径（仅留痕，快照已与之脱钩） */
  sourcePath: string
  /** 快照是否含 scripts/ 目录（含可执行脚本，#294 的确认弹窗据此触发） */
  hasScripts: boolean
  /** 挂载时间（ISO） */
  mountedAt: string
  /**
   * 快照 SKILL.md 的 token 体量估算（预加载预算护栏用）。读取时按快照内容现算、不持久化
   * （与官方 skill 走 diagnostics 现算同源），快照不可读时为 undefined → 预算按未知占位降级。
   */
  estimatedTokens?: number
}

/**
 * 用户 Skill 导入预检结果（IPC 边界的判别联合，#294）：
 * 选目录 + 校验 + scripts 探测 + 撞名判定，**不复制快照**。渲染端据此分流：
 * - canceled：作者在目录选择器点了取消（无错误，UI 静默关闭）。
 * - invalid：选中的文件夹不是有效 Skill（提示 message「不是有效的 Skill 文件夹」）。
 * - conflict：与官方 / 该 Agent 已挂用户 Skill 撞名，直接拒绝（提示 message「已存在同名 Skill」）。
 * - ready：可挂载，folderPath 透传给 commit；hasScripts=true 时渲染端先弹一次确认再 commit。
 */
export type PreviewUserSkillResult =
  | { status: 'canceled' }
  | { status: 'invalid'; message: string }
  | { status: 'conflict'; message: string }
  | { status: 'ready'; folderPath: string; name: string; hasScripts: boolean }

/**
 * 用户 Skill 导入提交结果（IPC 边界的判别联合，#294）：
 * 接 ready 预检的 folderPath，复制快照 + 写记录。撞名/校验在主进程信任边界再查一遍（纵深防御）。
 * - invalid：复制前文件夹已失效（提示 message「不是有效的 Skill 文件夹」）。
 * - conflict：复制前再查撞名仍冲突（提示 message「已存在同名 Skill」）。
 * - ok：导入成功，skills 是写后全量用户 Skill 列表。
 */
export type CommitUserSkillResult =
  | { status: 'invalid'; message: string }
  | { status: 'conflict'; message: string }
  | { status: 'ok'; skills: UserSkill[] }
