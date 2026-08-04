import type { AgentQuickAction } from '@shared/types/agent'

const DIRECT_WRITE_PATTERNS = [
  /^(继续写|写|开始写|开始生成|生成|产出).*(下一章|当前章节|第\s*\d+\s*章|正文)/,
  /^(帮我)?(直接)?(写|生成).*(章节|正文)/,
]

const DIRECT_SETUP_PATTERNS = [
  /^(开始|启动|进行)?(设定引导|创作根基|setup)/i,
  /^(帮我)?(完成|整理|建立).*(核心前提|创作根基)/,
]

const DIRECT_WORLD_PATTERNS = [
  /^(创建|新增|补充|修改|调整|完善|设计).*(角色|主角|反派|配角|人设|世界观|世界规则|宗门|势力|地点|关系)/,
]

const DIRECT_PLAN_PATTERNS = [
  /^(规划|生成|创建|修改|调整|细化).*(大纲|全书结构|卷级|章节规划|章节大纲)/,
]

export function detectSideEffectIntent(prompt: string): AgentQuickAction | null {
  const normalized = prompt.trim()
  if (!normalized) return null

  if (DIRECT_SETUP_PATTERNS.some((pattern) => pattern.test(normalized))) return 'setup'
  if (DIRECT_WORLD_PATTERNS.some((pattern) => pattern.test(normalized))) return 'world'
  if (DIRECT_PLAN_PATTERNS.some((pattern) => pattern.test(normalized))) return 'plan'

  return DIRECT_WRITE_PATTERNS.some((pattern) => pattern.test(normalized)) && !/(大纲|规划)/.test(normalized)
    ? 'write-next'
    : null
}
