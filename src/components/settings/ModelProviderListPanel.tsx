import { ChevronRight } from 'lucide-react'
import { GROUP_CLASS, MUTED_PILL_CLASS } from '@/design-system'
import { cn } from '@/lib/cn'
import { findPoolEntry, resolvePrimaryModel } from '@shared/lib/model-slots'
import type { AppConfig, ProviderId } from '@shared/types/ipc'
import { MODEL_PROVIDERS, providerStatus, providerStatusLabel } from './model-providers'

/**
 * 设置页「模型服务」一级页（渠道两级 UI v2 T3）：槽位摘要 + 五渠道行，点击渠道行进二级详情
 * （settings.tsx 负责 URL 路由，T4 换真详情组件）。
 */
export function ModelProviderListPanel({
  config,
  onOpenProvider,
}: {
  config: AppConfig
  onOpenProvider: (provider: ProviderId) => void
}) {
  const primary = resolvePrimaryModel(config)
  // lightModelKey=null 是「跟随主力」的显式语义（非缺失态），不能用 resolveLightModel 的 fail-soft
  // 回落——那是运行时解析用的，这里要如实反映用户的槽位选择。
  const lightEntry = config.lightModelKey ? findPoolEntry(config, config.lightModelKey) : null
  const lightLabel = config.lightModelKey === null ? '跟随主力' : (lightEntry?.modelId ?? '未设置')

  return (
    <section aria-label="模型服务" className="space-y-4" data-model-service-layout="providers">
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground" data-model-slots-summary="true">
        <span className={MUTED_PILL_CLASS}>主力：{primary?.modelId ?? '未设置'}</span>
        <span className={MUTED_PILL_CLASS}>轻量：{lightLabel}</span>
      </div>

      <section className={GROUP_CLASS}>
        {MODEL_PROVIDERS.map((item) => {
          const status = providerStatus(config, item.id)
          const connected = status.kind === 'enabled' && status.verified
          return (
            <button
              type="button"
              key={item.id}
              data-model-provider-row={item.id}
              className="flex min-h-[64px] w-full items-center justify-between gap-4 px-3 py-3 text-left transition-colors hover:bg-hover"
              onClick={() => onOpenProvider(item.id)}
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight text-foreground">{item.label}</div>
                <div
                  className={cn('mt-1 truncate text-xs leading-snug', connected ? 'text-success' : 'text-muted-foreground')}
                  data-model-provider-status={status.kind}
                >
                  {providerStatusLabel(status)}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          )
        })}
      </section>
    </section>
  )
}
