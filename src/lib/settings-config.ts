// src/lib/settings-config.ts
// settings.tsx 的 commitConfig 核心落盘逻辑（纯函数，抽出以便直测——组件层是 SSR-only，测不了交互）。
import { modelEntryKey } from '@shared/lib/model-slots'
import type { AppConfig, ProviderId } from '@shared/types/ipc'

/**
 * 池 / 槽位落盘（F1 终审修复）：mutate 基线用最近已持久化态（persisted，来自 getConfig()），
 * 不用本地 draft（configRef.current）——draft.providers 可能含用户正在编辑但没提交的半成品端点
 * （如删到剩 "https://ap"）。用 persisted 兜底后，「设为主力」「添加模型」这类池操作落盘的
 * providers 字段恒等于服务端已确认状态，不会把半成品端点带下去。
 *
 * toDisplay：落盘成功后，UI 显示态把 providers 换回 draft 的本地草稿——否则用户正在编辑的
 * 输入框会被这次落盘结果（不含草稿）回滚，体验上像“打字被吃掉”。
 */
export function applyConfigCommit(
  persisted: AppConfig,
  draft: AppConfig,
  mutate: (current: AppConfig) => AppConfig,
): { toPersist: AppConfig; toDisplay: (saved: AppConfig) => AppConfig } {
  return {
    toPersist: mutate(persisted),
    toDisplay: (saved) => ({ ...saved, providers: draft.providers }),
  }
}

/**
 * 「测试连接」落盘前的草稿合并（终审修复 F1②）：只把当前渠道的端点草稿并入 persisted，其余
 * 渠道一律用 persisted 的值——避免用户在渠道 A 留下的半成品端点（如编辑到剩 "https://ap"）被
 * 渠道 B 的「测试连接」当成整份 config 一起落盘，触发 normalizeAppConfig 自愈清空 A 渠道全部
 * 验证态却让用户无感。persisted 须来自调用方紧邻这次落盘前的 getConfig()，不用本地旧缓存。
 */
export function mergeProviderDraft(
  persisted: AppConfig,
  draft: AppConfig,
  provider: ProviderId,
): AppConfig {
  return {
    ...persisted,
    providers: { ...persisted.providers, [provider]: draft.providers[provider] },
  }
}

/**
 * 停用模型时"是否该提示主力已自动切换"的纯判定（渠道两级 UI v2 T4 复审 F1）：`onToggleModel` 在
 * 调用 `commitConfig`（异步、有落盘副作用）之前用它同步做一次快照判定，落盘成功（拿到非 null
 * 结果）后才据此决定要不要 toast——不能在 mutate 回调里提前发通知：mutate 同步跑在 saveConfig
 * 之前，落盘失败时会出现"先看到「已自动切换」提示、UI 实际没变"的时序错配。
 */
export function shouldWarnPrimaryModelDisabled(
  config: Pick<AppConfig, 'primaryModelKey'>,
  provider: ProviderId,
  modelId: string,
  enabled: boolean,
): boolean {
  return !enabled && config.primaryModelKey === modelEntryKey({ provider, modelId })
}
