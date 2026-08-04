import { useCallback, useState } from 'react'
import { PackageOpen, PenTool } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MarkdownRenderer } from '@/components/workbench/MarkdownRenderer'
import { PACK_GUIDE_MARKDOWN } from './pack-guide-content'

/** 能力包制作指南视图（设置页包库「制作能力包」入口进入）。返回入口在 titlebar 面包屑（导航规范 §9.8）。 */
export function PackGuideView({ onOpenCreations }: { onOpenCreations?: () => void }) {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleExportTemplate = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await window.electron.exportCapabilityPackTemplate()
      if (result.status === 'ok') setMessage(`模板包已导出：${result.filePath}`)
      else if (result.status !== 'canceled') setMessage(result.message ?? '导出失败，请重试。')
    } catch {
      setMessage('导出失败，请重试。')
    } finally {
      setBusy(false)
    }
  }, [busy])

  return (
    <section className="space-y-4" data-pack-guide-view="true">
      <MarkdownRenderer text={PACK_GUIDE_MARKDOWN} variant="document" />
      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void handleExportTemplate()}>
          <PackageOpen className="size-4" />
          导出模板包到本地…
        </Button>
        {onOpenCreations ? (
          <Button type="button" variant="secondary" size="sm" onClick={onOpenCreations}>
            <PenTool className="size-4" />
            打开我的创作
          </Button>
        ) : null}
        {message ? <p className="text-xs leading-5 text-muted-foreground">{message}</p> : null}
      </div>
    </section>
  )
}
