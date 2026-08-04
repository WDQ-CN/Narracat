// Skill 挂载 UI 的 App 侧文案与官方 Skill 展示元数据（ADR-0020 四类模型，#291）。
//
// 这些是产品化展示层数据，按 agentId / skillId 在 App 侧维护，不进 Agent Core：
// - 官方 Skill 对作者黑盒——作者只见简介（description），不见正文；这里维护作者面向的中文简介。
// - 「适合挂什么 skill」引导文案随挂载弹窗呈现，帮作者判断该往这个 Agent 挂哪类能力。

/** 不开放挂载入口的 Agent：memory-keeper 纯机械入库，无挂载语义（ADR-0020 约束 3） */
const MOUNT_DISABLED_AGENT_IDS = new Set<string>(['memory-keeper'])

/** 该 Agent 是否开放挂载入口（决定是否显示「挂载技能」+ 按钮与弹窗） */
export function isMountEnabledAgent(agentId: string): boolean {
  return !MOUNT_DISABLED_AGENT_IDS.has(agentId)
}

/**
 * 各 Agent「适合挂什么 skill」引导文案（草案，App 侧维护）。
 * 在挂载弹窗顶部呈现，帮作者判断该 Agent 适合挂哪类能力包。
 * memory-keeper 不开放挂载，无文案。
 */
export const AGENT_MOUNT_GUIDANCE: Record<string, string> = {
  'outline-architect': '适合挂叙事结构、情节编排类的能力包，帮它规划主线、卷纲和节奏。',
  'chapter-writer': '适合挂具体写法类的能力包，比如文风语感、对话与场景技巧、范例库。',
  'continuity-editor': '适合挂一致性与硬伤检查类的能力包，强化锚点兑现、时间线和角色一致性审查。',
  'world-curator': '适合挂世界设定类的能力包，帮它维护设定 canon 与冲突检查。',
}

/** 官方 Skill 的作者面向展示元数据（黑盒：只暴露名字 + 简介，不暴露正文） */
export interface OfficialSkillDisplay {
  name: string
  description: string
}

/**
 * 官方 Skill 的作者面向展示信息（id → 名字 + 中文简介）。
 * 当前覆盖会出现在 Agent 配置页的官方默认（锁定）Skill；缺省时回退到 skillId。
 */
export const OFFICIAL_SKILL_DISPLAY: Record<string, OfficialSkillDisplay> = {
  'novel-structure': {
    name: '叙事结构',
    description: '长篇网文的叙事结构知识：情感赌注、张力节奏、高潮分层、伏笔兑现、价值转折与事件架构，规划大纲时启用。',
  },
}

/** 取官方 Skill 展示信息，缺省回退到以 skillId 当名字、无简介 */
export function getOfficialSkillDisplay(skillId: string): OfficialSkillDisplay {
  return OFFICIAL_SKILL_DISPLAY[skillId] ?? { name: skillId, description: '' }
}
