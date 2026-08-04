/**
 * 对话框快捷模型切换器（切片②T2）：composer chip 触发 + 下拉菜单切主力模型。
 * 自包含——挂载时与菜单打开时自取 config（读到设置页最新改动），切换走 setPrimaryModel IPC，
 * 失败态原地 toast，不动本地状态。
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Cpu, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { getConfig, setPrimaryModel } from '@/lib/ipc'
import { MODEL_PROVIDERS } from '@/components/settings/model-providers'
import {
  isEntryVerified,
  modelEntryKey,
  parseModelKey,
  resolvePrimaryModel,
  type ModelSlotView,
} from '@shared/lib/model-slots'
import type { AppConfig, ProviderId } from '@shared/types/config'

export interface ModelSwitcherGroup {
  provider: ProviderId
  label: string
  entries: Array<{ key: string; modelId: string; verified: boolean }>
}

/**
 * 请求代际守卫：`refresh`（菜单打开时刷新）与 `onSelect`（用户切换）都会异步写回 config，
 * 谁的回包先落地不是「谁先发起」决定的（可能后发起的 setPrimaryModel 先于早先的 getConfig 回来）。
 * 打法：每发起一次请求就推进一格代际、记住自己那格；回包落地时若当前代际已不是自己那格
 * （说明中途有更新的请求介入，通常是用户点选切换），判定为陈旧回包，不应用——防止旧 refresh
 * 覆盖用户刚做的模型切换（回归 F1：chip 显示回退旧模型，用户以为切换失败，实际后端已切换）。
 */
export function isStaleConfigResponse(currentEpoch: number, requestEpoch: number): boolean {
  return currentEpoch !== requestEpoch
}

/** 按 MODEL_PROVIDERS 声明顺序分组池内条目；空渠道不出现在结果中。 */
export function groupPoolByProvider(view: ModelSlotView): ModelSwitcherGroup[] {
  return MODEL_PROVIDERS.map(({ id, label }) => ({
    provider: id,
    label,
    entries: view.modelPool
      .filter((entry) => entry.provider === id)
      .map((entry) => ({
        key: modelEntryKey(entry),
        modelId: entry.modelId,
        verified: isEntryVerified(view, entry),
      })),
  })).filter((group) => group.entries.length > 0)
}

export function AgentModelSwitcher({ disabled }: { disabled?: boolean }) {
  const navigate = useNavigate()
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [switching, setSwitching] = useState(false)
  const configEpochRef = useRef(0)

  const refresh = useCallback(() => {
    const requestEpoch = ++configEpochRef.current
    void getConfig()
      .then((payload) => {
        if (isStaleConfigResponse(configEpochRef.current, requestEpoch)) return
        setConfig(payload.config)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const primary = config ? resolvePrimaryModel(config) : null
  const primaryProviderLabel = primary
    ? (MODEL_PROVIDERS.find((provider) => provider.id === primary.provider)?.label ?? primary.provider)
    : null
  const groups = config ? groupPoolByProvider(config) : []

  async function onSelect(key: string) {
    if (!config || key === primary?.key || switching) return
    setSwitching(true)
    try {
      const payload = await setPrimaryModel(key)
      // 切换是用户的明确意图，永远优先于任何在途的旧 refresh：推进代际作废它们，再落地。
      ++configEpochRef.current
      setConfig(payload.config)
      toast.success(`已切换主力模型：${parseModelKey(key)?.modelId ?? key}`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSwitching(false)
    }
  }

  function goToSettings(provider?: ProviderId) {
    const query = provider ? `section=model&provider=${provider}` : 'section=model'
    navigate(`/settings?${query}`, { state: { from: '/workbench' } })
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) refresh()
      }}
    >
      <IconTooltip label={primary ? `${primaryProviderLabel} · ${primary.modelId}` : '选择主力模型'}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 max-w-[11rem] gap-1 rounded-full px-2 text-xs"
            disabled={disabled || switching}
            data-agent-model-switcher-trigger="true"
          >
            <Cpu className="size-3.5" />
            <span className="min-w-0 truncate">{primary?.modelId ?? '未配置模型'}</span>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
      </IconTooltip>
      <DropdownMenuContent side="top" align="end" className="w-56">
        <DropdownMenuRadioGroup value={primary?.key ?? ''}>
          {groups.length === 0 ? (
            <DropdownMenuItem onSelect={() => goToSettings()}>还没有可用模型，去设置页添加</DropdownMenuItem>
          ) : (
            groups.map((group) => (
              <Fragment key={group.provider}>
                <DropdownMenuLabel className="text-xs text-muted-foreground">{group.label}</DropdownMenuLabel>
                {group.entries.map((entry) =>
                  entry.verified ? (
                    <DropdownMenuRadioItem key={entry.key} value={entry.key} onSelect={() => void onSelect(entry.key)}>
                      <span className="font-mono text-xs">{entry.modelId}</span>
                    </DropdownMenuRadioItem>
                  ) : (
                    <DropdownMenuItem
                      key={entry.key}
                      className="text-muted-foreground"
                      onSelect={() => goToSettings(group.provider)}
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.modelId}</span>
                      <span className="text-[11px]">未测试</span>
                    </DropdownMenuItem>
                  ),
                )}
              </Fragment>
            ))
          )}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => goToSettings()}>
          <Settings2 className="size-4" />
          管理模型…
        </DropdownMenuItem>
        <div className="px-2 py-1.5 text-[11px] text-hint-foreground">切换后当前对话将重新开始</div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
