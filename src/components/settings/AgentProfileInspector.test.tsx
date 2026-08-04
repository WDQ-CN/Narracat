import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Dialog } from '@/components/ui/dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AgentProfileInspector, NARRACAT_AGENT_PROFILES } from './AgentProfileInspector'
import { SkillMountDialogBody, SkillMountRow, UserSkillDetailBody } from './AgentSkillMountPanel'
import type { UserSkill } from '@shared/types/skill-mount'

const SAMPLE_USER_SKILL: UserSkill = {
  id: 'a1b2c3',
  agentId: 'chapter-writer',
  name: '范例对话库',
  description: '收录高密度对话场景范例，供章节写手参考。',
  sourcePath: '/Users/me/skills/dialogue-pack',
  hasScripts: false,
  mountedAt: '2026-06-17T00:00:00.000Z',
}

// Agent profile inspector 的「+」挂载入口走 IconTooltip，SSR 需 TooltipProvider 上下文
function renderInspector(node: ReactElement): string {
  return renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
}

describe('AgentProfileInspector', () => {
  test('keeps the five built-in NarraCat Agent profiles in workflow order', () => {
    expect(NARRACAT_AGENT_PROFILES.map((agent) => agent.id)).toEqual([
      'outline-architect',
      'world-curator',
      'chapter-writer',
      'continuity-editor',
      'memory-keeper',
    ])

    expect(NARRACAT_AGENT_PROFILES.map((agent) => agent.name)).toEqual([
      '大纲架构师',
      '世界观策展人',
      '章节写手',
      '审校编辑',
      '记忆管理员',
    ])

    for (const agent of NARRACAT_AGENT_PROFILES) {
      expect(agent.introduction.length).toBeGreaterThan(0)
      expect(agent.imageUrl).toContain(`${agent.id}.webp`)
    }
  })

  test('renders prototype D structure with an integrated Agent introduction and skill list', () => {
    const html = renderInspector(<AgentProfileInspector />)

    expect(html).toContain('data-agent-profile-inspector="true"')
    expect(html).toContain('data-agent-profile-tabs="true"')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('data-agent-profile-panel="chapter-writer"')
    expect(html).toContain('animate-agent-profile-enter')
    expect(html).toContain('data-agent-profile-stage="true"')
    expect(html).toContain('data-agent-profile-portrait="true"')
    expect(html).toContain('章节写手')
    expect(html).toContain('data-agent-profile-introduction="true"')
    expect(html).toContain('在大纲和上下文约束下生成章节正文')
    expect(html).toContain('边界是不改大纲、设定、审修报告或 NovelMemory')
    expect(html).toContain('挂载技能')
    expect(html).toContain('data-agent-profile-skill-list="true"')
    expect(html).toContain('data-agent-skill-mount-panel="chapter-writer"')
    expect(html).toContain('data-agent-skill-mount-empty="true"')
    expect(html).toContain('暂无挂载 Skill')
    expect(html).not.toContain('已挂载 · 只读')
    expect(html).not.toContain('data-agent-profile-inspector-notice="true"')
    expect(html).not.toContain('data-agent-profile-ground-shadow="true"')
    expect(html).not.toContain('bg-foreground/10 blur-2xl')
    expect(html).not.toContain('应用级只读视图')
    expect(html).not.toContain('当前版本不可查看、禁用或编辑')
    expect(html).not.toContain('data-agent-profile-info-list="true"')
    expect(html).not.toContain('能力边界')
    expect(html).not.toContain('内部职责')
    expect(html).not.toContain('sm:w-[520px] sm:max-w-[64%]')
    expect(html).not.toContain('sm:grid-cols-[8rem_minmax(0,1fr)]')
    expect(html).not.toContain('font-mono text-xs font-semibold leading-5')
    expect(html).not.toContain('原始 prompt')
    expect(html).not.toContain('创建 Skill')
    expect(html).not.toContain('role="switch"')
  })

  test('memory-keeper 不开放挂载：空挂载态，且无「+」挂载入口', () => {
    const html = renderInspector(<AgentProfileInspector initialAgentId="memory-keeper" />)

    expect(html).toContain('data-agent-profile-panel="memory-keeper"')
    expect(html).toContain('记忆管理员')
    expect(html).toContain('挂载技能')
    expect(html).toContain('data-agent-skill-mount-empty="true"')
    expect(html).toContain('该 Agent 暂无挂载 Skill，依靠工具与上下文完成工作。')
    // 纯机械入库不开放挂载入口：无「+」触发按钮、无挂载弹窗壳
    expect(html).not.toContain('data-agent-skill-mount-add-trigger="memory-keeper"')
    expect(html).not.toContain('data-agent-skill-mount-dialog="memory-keeper"')
    expect(html).not.toContain('已挂载 · 只读')
  })

  test('开放挂载的 Agent 在标题行显示「+」挂载入口', () => {
    const html = renderInspector(<AgentProfileInspector initialAgentId="chapter-writer" />)

    expect(html).toContain('data-agent-skill-mount-add-trigger="chapter-writer"')
    expect(html).toContain('aria-label="挂载技能"')
  })

  test('官方默认挂载锁定行：官方品牌图标 + 名字/简介 +「官方」「锁定」、无箭头无卸载', () => {
    const html = renderToStaticMarkup(
      <SkillMountRow view={{ skillId: 'novel-structure', mode: 'preload', origin: 'default' }} />,
    )

    expect(html).toContain('data-agent-skill-mount-origin="default"')
    // 官方黑盒：展示作者面向的中文名 + 简介（App 侧维护），不暴露 skillId 当主名
    expect(html).toContain('叙事结构')
    expect(html).toContain('长篇网文的叙事结构知识')
    expect(html).toContain('官方')
    expect(html).toContain('data-agent-skill-mount-locked="novel-structure"')
    expect(html).toContain('锁定')
    // 锁定行非可点：无 role=button、无右箭头、无卸载按钮（不可看正文、不可卸）
    expect(html).not.toContain('data-agent-skill-mount-unmount="novel-structure"')
    expect(html).not.toContain('lucide-chevron-right')
    expect(html).not.toContain('role="button"')
  })

  test('用户挂载行：默认图标 + 右箭头 + role=button 整行可点（#293）', () => {
    const html = renderToStaticMarkup(
      <SkillMountRow
        view={{ skillId: 'my-local-skill', mode: 'preload', origin: 'user' }}
        onOpen={() => {}}
      />,
    )

    expect(html).toContain('data-agent-skill-mount-origin="user"')
    expect(html).toContain('my-local-skill')
    // 用户行恢复右箭头 + 整行 role=button + tabindex（键盘可达），点击 → 详情弹窗
    expect(html).toContain('lucide-chevron-right')
    expect(html).toContain('role="button"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="查看 my-local-skill 详情"')
    // 卸载已移入详情弹窗：行上不再有内联卸载按钮，也不带「官方」「锁定」tag
    expect(html).not.toContain('data-agent-skill-mount-unmount')
    expect(html).not.toContain('data-agent-skill-mount-locked')
  })

  test('挂载弹窗壳：引导文案 + 官方可挂载空状态 +「选本地文件夹挂载」入口', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <SkillMountDialogBody agentId="outline-architect" addableSkills={[]} onSelectLocalFolder={() => {}} />
      </Dialog>,
    )

    // 该 Agent 的「适合挂什么 skill」引导文案
    expect(html).toContain('适合挂叙事结构、情节编排类的能力包')
    // 官方可挂载列表本期空 → 空状态壳
    expect(html).toContain('data-agent-skill-mount-official-empty="true"')
    expect(html).toContain('暂无可挂载的官方技能。')
    // 选本地文件夹挂载入口（占位，导入逻辑见 #292）
    expect(html).toContain('data-agent-skill-mount-pick-folder="true"')
    expect(html).toContain('选本地文件夹挂载')
  })

  test('挂载弹窗官方列表有数据时渲染官方技能项（内部 Skill 不在 addable，自然不出现）', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <SkillMountDialogBody
          agentId="outline-architect"
          addableSkills={['novel-structure']}
          onSelectLocalFolder={() => {}}
        />
      </Dialog>,
    )

    expect(html).not.toContain('data-agent-skill-mount-official-empty="true"')
    expect(html).toContain('data-agent-skill-mount-official-skill="novel-structure"')
    expect(html).toContain('叙事结构')
    expect(html).not.toContain('data-agent-skill-mount-official-skill="novel-memory-integration"')
  })

  test('用户 Skill 行：默认图标 + SKILL.md 名字/简介，行可访问名用 SKILL.md 名而非内部 id（#293）', () => {
    const html = renderToStaticMarkup(
      <SkillMountRow
        view={{ skillId: 'a1b2c3', mode: 'preload', origin: 'user' }}
        name="范例对话库"
        description="收录高密度对话场景范例，供章节写手参考。"
        onOpen={() => {}}
      />,
    )

    expect(html).toContain('data-agent-skill-mount-origin="user"')
    // 展示 SKILL.md name / description，而非内部 id
    expect(html).toContain('范例对话库')
    expect(html).toContain('收录高密度对话场景范例')
    // 行可访问名用 SKILL.md 名而非内部 UUID，屏幕阅读器念得出意义
    expect(html).toContain('aria-label="查看 范例对话库 详情"')
    expect(html).not.toContain('aria-label="查看 a1b2c3 详情"')
    expect(html).not.toContain('data-agent-skill-mount-locked')
  })

  test('用户行不传 onOpen 时降级为纯展示（无 role=button、无箭头）', () => {
    const html = renderToStaticMarkup(
      <SkillMountRow view={{ skillId: 'a1b2c3', mode: 'preload', origin: 'user' }} name="范例对话库" />,
    )

    expect(html).not.toContain('role="button"')
    expect(html).not.toContain('lucide-chevron-right')
  })

  test('用户 Skill 详情弹窗：简介 + 正文（Markdown）+ 卸载，只支持卸载（#293）', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <UserSkillDetailBody
          skill={SAMPLE_USER_SKILL}
          body={'# 用法\n挑选贴近场景的范例，仿写其张力推进。'}
          busy={false}
          onUninstall={() => {}}
        />
      </Dialog>,
    )

    // 标题 = SKILL.md 名，描述 = 简介
    expect(html).toContain('范例对话库')
    expect(html).toContain('收录高密度对话场景范例')
    // 正文经 MarkdownRenderer 渲染（标题成 <h1>，正文文本可见）
    expect(html).toContain('data-user-skill-detail-content="true"')
    expect(html).toContain('data-markdown-renderer="document"')
    expect(html).toContain('用法')
    expect(html).toContain('挑选贴近场景的范例')
    // 操作只支持卸载（不做「在对话中试用」）
    expect(html).toContain('data-user-skill-detail-uninstall="a1b2c3"')
    expect(html).toContain('卸载')
    expect(html).not.toContain('在对话中试用')
    // 二次确认：初始只显示「卸载」触发，确认按钮要点过才出现（不在初始静态渲染里）
    expect(html).not.toContain('data-user-skill-detail-uninstall-confirm')
    expect(html).not.toContain('确认卸载')
  })

  test('用户 Skill 详情弹窗：正文懒读中显示载入态，空正文显示空状态', () => {
    const loadingHtml = renderToStaticMarkup(
      <Dialog open>
        <UserSkillDetailBody skill={SAMPLE_USER_SKILL} body="" bodyLoading onUninstall={() => {}} />
      </Dialog>,
    )
    expect(loadingHtml).toContain('正在载入正文…')
    expect(loadingHtml).not.toContain('data-user-skill-detail-empty="true"')

    const emptyHtml = renderToStaticMarkup(
      <Dialog open>
        <UserSkillDetailBody skill={SAMPLE_USER_SKILL} body="" onUninstall={() => {}} />
      </Dialog>,
    )
    expect(emptyHtml).toContain('data-user-skill-detail-empty="true"')
    expect(emptyHtml).toContain('暂无正文内容。')
  })

  test('官方锁定 Skill 不可看正文：详情弹窗仅用户自定义路径触发（官方走黑盒）', () => {
    // 官方锁定行非可点（无 onOpen），不会进入 UserSkillDetailBody；详情弹窗只服务用户 Skill。
    const officialRow = renderToStaticMarkup(
      <SkillMountRow view={{ skillId: 'novel-structure', mode: 'preload', origin: 'default' }} />,
    )
    expect(officialRow).not.toContain('role="button"')
    expect(officialRow).not.toContain('data-user-skill-detail-dialog')
    // 官方简介可见但正文容器永不为官方渲染（黑盒）
    expect(officialRow).not.toContain('data-user-skill-detail-content')
  })

  test('挂载弹窗：导入失败展示「不是有效的 Skill 文件夹」，busy 时禁用入口（#292）', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <SkillMountDialogBody
          agentId="chapter-writer"
          addableSkills={[]}
          busy
          importError="不是有效的 Skill 文件夹。"
          onSelectLocalFolder={() => {}}
        />
      </Dialog>,
    )

    expect(html).toContain('data-agent-skill-mount-import-error="true"')
    expect(html).toContain('不是有效的 Skill 文件夹。')
    // busy 时「选本地文件夹挂载」按钮禁用（属性顺序无关，匹配同一 <button> 内同时含 disabled 与该标识）
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-agent-skill-mount-pick-folder="true"/)
  })
})
