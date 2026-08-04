import { useState } from 'react'
import { cn } from '@/lib/cn'
import { AgentSkillMountPanel } from './AgentSkillMountPanel'

const outlineArchitectImageUrl = new URL('../../assets/illustrations/agents/outline-architect.webp', import.meta.url).href
const worldCuratorImageUrl = new URL('../../assets/illustrations/agents/world-curator.webp', import.meta.url).href
const chapterWriterImageUrl = new URL('../../assets/illustrations/agents/chapter-writer.webp', import.meta.url).href
const continuityEditorImageUrl = new URL('../../assets/illustrations/agents/continuity-editor.webp', import.meta.url).href
const memoryKeeperImageUrl = new URL('../../assets/illustrations/agents/memory-keeper.webp', import.meta.url).href

export type NarraCatAgentProfile = {
  id: string
  name: string
  imageUrl: string
  introduction: string
}

export const NARRACAT_AGENT_PROFILES: NarraCatAgentProfile[] = [
  {
    id: 'outline-architect',
    name: '大纲架构师',
    imageUrl: outlineArchitectImageUrl,
    introduction:
      '大纲架构师负责把故事想法整理成可持续推进的结构，规划全书主线、卷纲、章节事件、主题弧线、角色弧线、伏笔注册和节奏控制。它的边界是故事结构与大纲调整：不直接写章节正文，不管理设定档案，也不写入 NovelMemory。',  },
  {
    id: 'world-curator',
    name: '世界观策展人',
    imageUrl: worldCuratorImageUrl,
    introduction:
      '世界观策展人负责维护小说世界的完整性与一致性，把角色档案、世界规则、地理历史、关系图谱和设定修改影响整理成可用的 canon。它专注设定合成与冲突检查，不负责章节正文创作，也不直接决定大纲节奏。',  },
  {
    id: 'chapter-writer',
    name: '章节写手',
    imageUrl: chapterWriterImageUrl,
    introduction:
      '章节写手负责在大纲和上下文约束下生成章节正文，把结构骨架转化为可读、可追更的叙事场景。它处理章节起草、场景推进、人物行动、叙述声音、章节钩子和正文元数据收尾；边界是不改大纲、设定、审修报告或 NovelMemory。',  },
  {
    id: 'continuity-editor',
    name: '审校编辑',
    imageUrl: continuityEditorImageUrl,
    introduction:
      '审校编辑负责写后审修和级联影响分析，在保护阅读吸引力的同时检查锚点兑现、角色一致性、时间线、伏笔密度、风格画像和改写风险。它不代替章节写手重写正文，也不做写前预检，只输出审修判断、问题定位和修订建议。',  },
  {
    id: 'memory-keeper',
    name: '记忆管理员',
    imageUrl: memoryKeeperImageUrl,
    introduction:
      '记忆管理员负责从章节、大纲和设定中提取关键事实，写入或回滚 NovelMemory，让后续创作能复用可靠记忆。它处理章节摘要、角色状态、关系变化、伏笔动作、设定事实、情感弧线、记忆强化和章节回滚；边界是不创作内容，也不修改小说文件。',  },
]

const DEFAULT_AGENT_ID = 'chapter-writer'

export function AgentProfileInspector({
  initialAgentId = DEFAULT_AGENT_ID,
  skillsByAgentId,
  mountableSkillsByAgent,
  skillTokenEstimates,
  skillTriggers,
}: {
  initialAgentId?: string
  skillsByAgentId?: Record<string, string[]>
  /** 按 Agent 绑定的可挂载 Skill 集（diagnostics.mountableSkillsByAgent）；按选中 Agent 取该 Agent 的可挂池 */
  mountableSkillsByAgent?: Record<string, string[]>
  /** 各 Skill 的 token 体量估算（diagnostics.skillTokenEstimates），预加载预算护栏用 */
  skillTokenEstimates?: Record<string, number>
  /** 各 Skill 声明的触发点（diagnostics.skillTriggers），按需挂载选项与触发场景展示用 */
  skillTriggers?: Record<string, string[]>
} = {}) {
  const [selectedAgentId, setSelectedAgentId] = useState(initialAgentId)
  const selectedAgent =
    NARRACAT_AGENT_PROFILES.find((agent) => agent.id === selectedAgentId) ?? NARRACAT_AGENT_PROFILES[0]

  return (
    <section aria-label="Agent 档案" className="space-y-4" data-agent-profile-inspector="true">
      <div
        role="tablist"
        aria-label="选择 Agent"
        className="flex gap-2.5 overflow-x-auto pb-1"
        data-agent-profile-tabs="true"
      >
        {NARRACAT_AGENT_PROFILES.map((agent) => {
          const selected = agent.id === selectedAgent.id
          return (
            <button
              key={agent.id}
              id={`agent-profile-tab-${agent.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`agent-profile-panel-${agent.id}`}
              data-agent-profile-tab={agent.id}
              data-active={selected}
              className={cn(
                'grid min-h-16 min-w-36 flex-1 grid-cols-[2.875rem_minmax(0,1fr)] items-center gap-2.5 rounded-row border border-border bg-surface px-2.5 py-2 text-left text-muted-foreground transition-all duration-200 hover:border-border-strong hover:bg-hover hover:text-foreground active:scale-[0.98]',
                selected && 'border-border-strong bg-active text-foreground hover:bg-active'
              )}
              onClick={() => setSelectedAgentId(agent.id)}
            >
              <img
                src={agent.imageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                className="size-[2.875rem] rounded-row border border-border bg-active object-cover object-top"
              />
              <span className="min-w-0 truncate text-sm font-semibold leading-tight text-foreground">{agent.name}</span>
            </button>
          )
        })}
      </div>

      <div
        key={selectedAgent.id}
        id={`agent-profile-panel-${selectedAgent.id}`}
        role="tabpanel"
        aria-labelledby={`agent-profile-tab-${selectedAgent.id}`}
        className="space-y-8 animate-agent-profile-enter"
        data-agent-profile-panel={selectedAgent.id}
      >
        <div className="grid justify-items-center px-4 py-2 text-center">
          <div
            className="relative h-80 w-full max-w-md sm:h-96"
            data-agent-profile-stage="true"
          >
            <img
              src={selectedAgent.imageUrl}
              alt={selectedAgent.name}
              loading="eager"
              decoding="async"
              draggable={false}
              className="relative z-10 h-full w-full object-contain object-top"
              data-agent-profile-portrait="true"
            />
          </div>
          <h2 className="mt-4 text-2xl font-bold leading-tight text-foreground">{selectedAgent.name}</h2>
          <p
            className="mt-3 max-w-2xl text-center text-sm leading-7 text-body-foreground"
            data-agent-profile-introduction="true"
          >
            {selectedAgent.introduction}
          </p>
        </div>

        <AgentSkillMountPanel
          agentId={selectedAgent.id}
          defaultSkills={skillsByAgentId?.[selectedAgent.id] ?? []}
          mountableSkills={mountableSkillsByAgent?.[selectedAgent.id] ?? []}
          skillTokenEstimates={skillTokenEstimates}
          skillTriggers={skillTriggers}
        />
      </div>
    </section>
  )
}

