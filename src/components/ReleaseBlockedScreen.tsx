import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { EMPTY_PRIMARY_BODY_CLASS, EMPTY_PRIMARY_TITLE_CLASS } from '@/design-system/typography'
import { installUpdate } from '@/lib/ipc'
import { describeUpdateStatus } from '@/lib/updater-view'
import { useUpdater } from '@/lib/use-updater'
import type { ReleaseGateReason } from '@shared/types/ipc'

// 内测软过期 / 急刹车命中后的全屏拦截页（#354）：硬挡在所有内容之上，引导关注公测。
const TITLE_BY_REASON: Record<ReleaseGateReason, string> = {
  kill: '内测已暂停',
  expired: '内测已结束',
  'hard-expired': '内测已结束',
  'min-version': '请更新到新版本',
}

export function ReleaseBlockedScreen({
  reason,
  notice,
}: {
  reason: ReleaseGateReason | null
  notice: string
}) {
  const title = reason ? TITLE_BY_REASON[reason] : '内测已结束'
  // 只有「版本过旧」这一种拦截能靠更新自救；kill / expired / hard-expired 是刻意停用，
  // 白订阅一次更新状态没有意义，故只在能自救时才启用 useUpdater 的 IPC 与订阅。
  const canSelfUpdate = reason === 'min-version'
  const updater = useUpdater(canSelfUpdate)
  const [busy, setBusy] = useState(false)
  const [clicked, setClicked] = useState(false)

  // 复用 describeUpdateStatus：渲染端展示判定的唯一落点，这里不再另写一份。
  const isBusyStatus = updater.status === 'checking' || updater.status === 'downloading' || updater.status === 'ready'
  const progressText = isBusyStatus ? describeUpdateStatus(updater).text : ''
  // 用户点过「立即更新」后，若状态回到 idle（最现实的场景：minVersion 抬到了一个还没上传的
  // 版本，查了一圈没查到）或 error（下载/校验失败），全屏拦截页上点了按钮却毫无反应——
  // 必须给出人工退路，不能把用户困在一个死循环的拦截页上。
  const showManualFallback = canSelfUpdate && clicked && (updater.status === 'idle' || updater.status === 'error')

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-canvas px-8 text-center"
      data-release-blocked-screen="true"
      role="alertdialog"
      aria-label={title}
    >
      <h1 className={EMPTY_PRIMARY_TITLE_CLASS}>{title}</h1>
      <p className={`max-w-md whitespace-pre-line ${EMPTY_PRIMARY_BODY_CLASS}`}>{notice}</p>
      {canSelfUpdate ? (
        <div className="flex flex-col items-center gap-2">
          <Button
            disabled={busy || updater.status === 'downloading' || updater.status === 'checking'}
            onClick={async () => {
              setBusy(true)
              setClicked(true)
              try {
                await installUpdate()
              } catch {
                // 失败经状态推送体现；下方兜底提示会指引手动下载
              } finally {
                setBusy(false)
              }
            }}
          >
            立即更新并重启
          </Button>
          {progressText ? <span className="text-sm text-muted-foreground">{progressText}</span> : null}
          {showManualFallback ? (
            <p className="max-w-xs text-sm text-muted-foreground">
              自动更新没有成功，可以点击下方链接前往官网手动下载最新安装包，双击安装即可。
            </p>
          ) : null}
        </div>
      ) : null}
      <a
        href="https://narracat.com/"
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium text-foreground hover:underline"
      >
        前往 narracat.com
      </a>
    </div>
  )
}
