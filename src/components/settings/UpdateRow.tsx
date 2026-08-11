import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { checkForUpdates, installUpdate } from '@/lib/ipc'
import { describeUpdateStatus } from '@/lib/updater-view'
import { useUpdater } from '@/lib/use-updater'

export function UpdateRow() {
  const state = useUpdater()
  const [busy, setBusy] = useState(false)
  const view = describeUpdateStatus(state)

  const onClick = async () => {
    if (view.action === 'none' || busy) return
    setBusy(true)
    try {
      await (view.action === 'install' ? installUpdate() : checkForUpdates())
    } catch {
      // 失败经状态推送体现，这里不额外弹错
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-3">
      <span className="text-sm text-muted-foreground">{view.text}</span>
      <Button variant="outline" size="sm" disabled={view.action === 'none' || busy} onClick={onClick}>
        {view.actionLabel}
      </Button>
    </div>
  )
}
