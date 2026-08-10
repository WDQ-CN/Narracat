// 官方 Skill 的 App 侧展示元数据（ADR-0020 补记，2026-08-07：挂载体系整体退役）。
//
// 官方 Skill 在 App 内是纯只读展示，无挂/卸入口：
// - 官方 Skill 简介（description）在这里维护中文展示文案；正文经独立只读通道
//   electron/main/engine/official-skill-body.ts 可查看（Task 7：ADR-0020 约束 1 的「不可查看」
//   半条已推翻，见 docs/superpowers/specs/2026-08-06-agent-prose-user-editing-design.md §2.3）。
//   「不可编辑」半条继续成立——§2.4：技术上做不到，官方 Skill 靠直接读磁盘文件到达写作运行，
//   非产品护栏，故只读、无写路径。

/** 官方 Skill 的作者面向展示元数据：名字 + 简介。正文另走独立只读通道（见文件顶部注释），不算在此结构里。 */
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
  'novel-web-craft': {
    name: '网文写作手艺',
    description: '网络小说的成稿手艺：场景推进、对话与动作的写法、叙述声音与节奏控制，写正文时启用。',
  },
}

/** 取官方 Skill 展示信息，缺省回退到以 skillId 当名字、无简介 */
export function getOfficialSkillDisplay(skillId: string): OfficialSkillDisplay {
  return OFFICIAL_SKILL_DISPLAY[skillId] ?? { name: skillId, description: '' }
}

/**
 * 「确定到达模型」的官方 Skill 白名单（agentId → skillId[]）。
 *
 * 为什么要白名单而不是列全部：pi 底座下 `definition.skills` 无消费者（pi-session.ts 的 getSkills
 * 恒返空），官方 Skill 只有被 command 用 Read 显式读进来才真正到达模型。五个官方 skill 里目前只有
 * `novel-web-craft` 有确凿证据——`agent-core/narracat/commands/write.md` 显式
 * `Read ${CLAUDE_PLUGIN_ROOT}/skills/novel-web-craft/SKILL.md`。列出实际没生效的条目就是在骗作者。
 *
 * issue #510 真机实证其余四个之后，再往这里加。**不要凭 agent frontmatter 的 `skills:` 声明往里加。**
 */
export const VERIFIED_OFFICIAL_SKILLS: Record<string, string[]> = {
  'chapter-writer': ['novel-web-craft'],
}
