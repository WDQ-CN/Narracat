/** 受支持的 Provider 单一事实源；新增 Provider 只改这里，归一化/遍历自动覆盖。 */
export const PROVIDER_IDS = ['deepseek', 'anthropic', 'minimax', 'glm', 'custom'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

export interface ProviderApiKeyMetadata {
  updatedAt: string
}

export interface ProviderSettings {
  baseUrl: string
}

/** 池条目验证快照：绑定验证时刻的 Key 代际与端点；任一变化即失效（normalize 自愈清空）。 */
export interface ModelEntryVerification {
  verifiedAt: string
  apiKeyUpdatedAt: string
  baseUrl: string
}

export interface ModelPoolEntry {
  provider: ProviderId
  modelId: string
  verification: ModelEntryVerification | null
}

export interface AppConfig {
  providers: Record<ProviderId, ProviderSettings>
  modelPool: ModelPoolEntry[]
  /** "provider/modelId"；null = 池空未选 */
  primaryModelKey: string | null
  /** null = 跟随主力 */
  lightModelKey: string | null
  apiKeyMetadata: Partial<Record<ProviderId, ProviderApiKeyMetadata>>
  novelRootDir: string
  recentNovelPaths: string[]
  systemNotificationsEnabled: boolean
  /** 用户已看过的首次介绍版本；0=从未看过，介绍大改时递增以触发老用户重看一次 */
  introVersion: number
}

// F4（终审修复）：这三个默认值被大量测试 fixture 直接展开（`...POOL_DEFAULT_FIELDS` 等）；
// 冻结防止某处 fixture 原地 push/mutate 污染到其他用例共用的同一个对象引用（数组本身与
// 条目对象都冻结）。normalizeAppConfig 的拷贝路径全走 map/spread 产出新对象，不受影响。
export const DEFAULT_PROVIDER_SETTINGS: Record<ProviderId, ProviderSettings> = Object.freeze({
  deepseek: Object.freeze({ baseUrl: 'https://api.deepseek.com/anthropic' }),
  anthropic: Object.freeze({ baseUrl: '' }),
  minimax: Object.freeze({ baseUrl: 'https://api.minimaxi.com/anthropic' }),
  glm: Object.freeze({ baseUrl: 'https://open.bigmodel.cn/api/anthropic' }),
  custom: Object.freeze({ baseUrl: '' }),
})

export const DEFAULT_MODEL_POOL: ModelPoolEntry[] = Object.freeze([
  Object.freeze({ provider: 'deepseek', modelId: 'deepseek-v4-pro', verification: null }),
]) as ModelPoolEntry[]

export const DEFAULT_PRIMARY_MODEL_KEY = 'deepseek/deepseek-v4-pro'

/** AppConfig 字面量构造点位的过渡期补齐包（测试 fixture / 渲染端占位配置用）。 */
export const POOL_DEFAULT_FIELDS = Object.freeze({
  providers: DEFAULT_PROVIDER_SETTINGS,
  modelPool: DEFAULT_MODEL_POOL,
  primaryModelKey: DEFAULT_PRIMARY_MODEL_KEY,
  lightModelKey: null,
}) satisfies Pick<AppConfig, 'providers' | 'modelPool' | 'primaryModelKey' | 'lightModelKey'>
