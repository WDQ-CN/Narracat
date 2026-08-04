/**
 * Provider 装配（模型池化切片①）：AppConfig → Pi 自定义 Model 描述，主力/轻量槽驱动
 * （shared/lib/model-slots 的 resolvePrimaryModel/resolveLightModel）。
 * 决策依据 spec §5.2「默认保留各家 Anthropic 兼容端点」：api 恒为 anthropic-messages +
 * 自定 baseUrl，保住 P1B 在 anthropic wire 上的全部调优与前缀缓存；换 pi-ai 原生 wire
 * 是 A/B 质量门之后的显式决策。不写 models.json 文件——Model 对象直接传 createAgentSession
 * （spike 报告实测形态）。
 */
import type { Model } from '@mariozechner/pi-ai'
import type { AppConfig } from '@shared/types/config'
import { resolveLightModel, resolvePrimaryModel } from '@shared/lib/model-slots'

/** 窗口值与 SDK 侧 CLAUDE_CODE_MAX_CONTEXT_TOKENS 对齐。 */
const ONE_M_CONTEXT_WINDOW = 1_000_000
const DEFAULT_CONTEXT_WINDOW = 200_000
/** 对齐 SDK 路径的实际输出上限（sdk-runner 未设输出 env，走 Claude CLI 默认 32000）——A/B 单变量
 * 纪律：8192 会截断章节写作长输出，是 SDK 路径没有的新变量；超限仍触发 stopReason='length'，
 * 由事件映射 fail-loud（生产接线门前项①）。 */
const DEFAULT_MAX_TOKENS = 32_000
const ANTHROPIC_OFFICIAL_BASE_URL = 'https://api.anthropic.com'

/**
 * 子 agent frontmatter 的 model 别名 → 槽位（模型池化）：opus/sonnet 继承 run 模型（主力槽），
 * haiku 映射轻量槽。子会话共用 run 的 provider/apiKey，故轻量槽跨 provider 时回落主力
 * （返回 undefined = 继承）；直调轻活路径无此约束。非法别名一律 undefined，不做透传旁路。
 */
export function resolvePiModelAlias(config: AppConfig, alias: string | undefined): string | undefined {
  if (alias !== 'haiku') return undefined
  const primary = resolvePrimaryModel(config)
  const light = resolveLightModel(config)
  if (!primary || !light) return undefined
  if (light.provider !== primary.provider) return undefined
  return light.modelId === primary.modelId ? undefined : light.modelId
}

export function createPiModel(config: AppConfig, explicitId?: string): Model<'anthropic-messages'> {
  const primary = resolvePrimaryModel(config)
  if (!primary) throw new Error('未配置任何模型，无法构造 Pi 模型描述')
  const id = explicitId || primary.modelId
  return {
    id,
    name: id,
    api: 'anthropic-messages',
    provider: primary.provider,
    baseUrl: primary.baseUrl || ANTHROPIC_OFFICIAL_BASE_URL,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // [1m] 按实际选中模型判（修掉旧「三档任一带即全局 1M」怪味）
    contextWindow: id.includes('[1m]') ? ONE_M_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  }
}
