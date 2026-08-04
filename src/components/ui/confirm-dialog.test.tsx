import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialogPanel } from './confirm-dialog'

function renderPanel(props?: Partial<Parameters<typeof ConfirmDialogPanel>[0]>) {
  return renderToStaticMarkup(
    <Dialog open>
      <ConfirmDialogPanel
        title="重置参考作品"
        description="会删除全部参考来源和已生成的参考指导，删掉后找不回来。"
        onCancel={() => {}}
        onConfirm={() => {}}
        {...props}
      />
    </Dialog>,
  )
}

describe('ConfirmDialogPanel', () => {
  test('渲染标题、后果说明与默认按钮文案', () => {
    const html = renderPanel()

    expect(html).toContain('data-confirm-dialog-panel="true"')
    expect(html).toContain('重置参考作品')
    expect(html).toContain('会删除全部参考来源和已生成的参考指导，删掉后找不回来。')
    expect(html).toContain('data-confirm-dialog-cancel="true"')
    expect(html).toContain('data-confirm-dialog-confirm="true"')
    expect(html).toContain('取消')
    expect(html).toContain('继续')
  })

  test('danger 时确认钮走 destructive 红色，非 danger 走默认主按钮', () => {
    const dangerHtml = renderPanel({ danger: true, confirmLabel: '重置' })
    expect(dangerHtml).toContain('data-variant="destructive"')
    expect(dangerHtml).toContain('重置')

    const plainHtml = renderPanel()
    expect(plainHtml).not.toContain('data-variant="destructive"')
  })
})
