import { CircleArrowUp } from 'lucide-react'
import { useState } from 'react'
import { SIDEBAR_ROW_CLASS } from '@/design-system'
import { useAgentStore } from '@/lib/agent-store'
import { cn } from '@/lib/cn'
import { installUpdate } from '@/lib/ipc'
import { shouldShowUpdateBadge } from '@/lib/updater-view'
import { useUpdater } from '@/lib/use-updater'

const UPDATE_READY_TEXT = '新版本已就绪，点击重启'

export type UpdateReadyBannerVariant = 'overlay' | 'titlebar'

/**
 * 纯展示，拆出来是为了测试不必 mock useUpdater/useAgentStore。
 *
 * 两种形态共用一份代码（同一件事两个长相拆两个组件只会一改漏一边），靠 `variant` 分叉，
 * 背景都是实心底 + 白字（具体颜色 token 见实现，这里不绑定色值——已经换过几轮，写死在
 * 注释里只会再漂移），差异只在形状：
 *
 * - `overlay`（默认，工作台 sidebar 底部）：**浮在小说目录之上**，下面压着真实的章节文字，
 *   靠浮层阴影与挂载点定位的紧凑宽度（复用 `SIDEBAR_ROW_CLASS` 的 `gap-2 rounded-row px-2`
 *   圆角/间距与过渡，宽度覆盖成不撑满 sidebar、高度/字号覆盖成比菜单行更矮小一号）与下方
 *   内容拉开层次。
 * - `titlebar`（书架页顶部 titlebar 一行）：**不是浮层**，下面是纯色 titlebar，做成宽度随
 *   文字的紧凑 tag，右侧不留白；高度 `h-7` 与旁边「新建」按钮（`size="sm"`）对齐。
 */
export function UpdateReadyBannerView({
  visible,
  onClick,
  className,
  variant = 'overlay',
}: {
  visible: boolean
  onClick: () => void
  className?: string
  variant?: UpdateReadyBannerVariant
}) {
  if (!visible) return null
  return (
    <button
      type="button"
      data-update-ready-banner="true"
      data-update-ready-banner-variant={variant}
      aria-label={UPDATE_READY_TEXT}
      onClick={onClick}
      className={cn(
        variant === 'overlay'
          ? cn(
              SIDEBAR_ROW_CLASS,
              `
                h-7 w-auto border border-system-blue bg-system-blue text-xs text-white shadow-[var(--shadow-floating)]
                hover:brightness-95
                focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50
              `,
              // ↑ tailwind-merge 按类名后写者生效，三项覆盖 SIDEBAR_ROW_CLASS 的默认值：
              // w-auto 覆盖自带的 w-full——挂载点用 inset-x-2 定位已经决定了宽度，w-full 会把
              // 宽度强改成 sidebar 满宽，导致 inset-x-2 让出的右侧 8px 被撑出去、内容被裁切；
              // h-7/text-xs 覆盖自带的 h-8/text-sm——产品要求这条 banner 比菜单行更矮小一号。
            )
          : `
              inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border
              border-system-blue bg-system-blue px-3 text-xs font-medium text-white
              transition-all duration-200
              hover:brightness-95
              focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50
            `,
        className,
      )}
    >
      <CircleArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
      {variant === 'overlay' ? <span className="min-w-0 truncate">{UPDATE_READY_TEXT}</span> : UPDATE_READY_TEXT}
    </button>
  )
}

/**
 * 「更新已就绪」全局提示（spec §6.1，取代原设置入口小圆点角标）：点击整条即重启更新，
 * 提示与操作合一。工作台 sidebar 底部（`overlay`）与书架页顶部 titlebar（`titlebar`）
 * 共用同一份组件，形态差异见 `UpdateReadyBannerView` 顶部注释。
 *
 * 显示条件复用 `shouldShowUpdateBadge`（已就绪且没在跑 Agent），不新写一套判定——
 * 跑 Agent 时不显示，banner 比小圆点显眼得多，更该守住「不打扰写作」。
 *
 * `onBeforeInstall` 供工作台接正文编辑器未保存检查（`confirmLeaveManuscriptEditor`）；
 * 书架页没有正文编辑器，不传即直接安装。
 */
export function UpdateReadyBanner({
  className,
  onBeforeInstall,
  variant,
}: {
  className?: string
  onBeforeInstall?: () => Promise<boolean>
  variant?: UpdateReadyBannerVariant
}) {
  const state = useUpdater()
  const hasActiveRuns = useAgentStore((store) =>
    Object.values(store.threadsById).some((thread) => Boolean(thread.activeRun)),
  )
  const [busy, setBusy] = useState(false)
  const visible = shouldShowUpdateBadge({ state, hasActiveRuns })

  async function handleClick() {
    if (busy) return
    setBusy(true)
    try {
      const proceed = onBeforeInstall ? await onBeforeInstall() : true
      if (proceed) await installUpdate()
    } catch {
      // 失败经状态推送体现，这里不额外弹错（同 UpdateRow.tsx）
    } finally {
      setBusy(false)
    }
  }

  return (
    <UpdateReadyBannerView
      visible={visible}
      onClick={() => void handleClick()}
      className={className}
      variant={variant}
    />
  )
}
