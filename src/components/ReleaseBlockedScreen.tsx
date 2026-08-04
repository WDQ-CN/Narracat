import { EMPTY_PRIMARY_BODY_CLASS, EMPTY_PRIMARY_TITLE_CLASS } from '@/design-system/typography'
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

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-canvas px-8 text-center"
      data-release-blocked-screen="true"
      role="alertdialog"
      aria-label={title}
    >
      <h1 className={EMPTY_PRIMARY_TITLE_CLASS}>{title}</h1>
      <p className={`max-w-md whitespace-pre-line ${EMPTY_PRIMARY_BODY_CLASS}`}>{notice}</p>
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
