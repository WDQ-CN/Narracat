import { useState } from 'react'
import { BellOff, CalendarClock, CheckCheck, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import type { PlannedStateRowDto } from '@shared/types/planned-state'

/**
 * 未兑现行四处置动作（A4×D2 片3b Task 7，spec §3.2/§3.3）：
 * - 正文已写到（mark_delivered）：行内迷你表单，预填角色/维度/值只读展示，「发生章」number 输入可调；
 * - 移到后续章（defer）：目标章下拉，候选来自父级三级透传的 deferTargets；空列表整个入口置灰（不是隐藏）；
 * - 取消这项计划 / 暂时保留提醒（cancel / acknowledge）：图标按钮直调，无中间表单。
 *
 * 本组件只管 UI 与本地「哪个迷你表单展开」状态，IPC 调用与 toast/reload 全部归 StateChangesLedger 壳层
 * （经 onConfirmDelivered/onDefer/onCancel/onAcknowledge 回调下发），保持与 StateChangesLedgerView
 * 同样的「壳发请求、视图只收 props」纪律。
 */

type OpenForm = 'delivered' | 'defer' | null

export function StateChangesRowActions({
  row,
  rowLabel,
  deferTargets,
  disabled,
  pending,
  onConfirmDelivered,
  onDefer,
  onCancel,
  onAcknowledge,
}: {
  row: PlannedStateRowDto
  /** 迷你表单里的只读预填展示文案（角色 · 维度 值），由父级用既有 dimensionLabel/operationText 拼好传入 */
  rowLabel: string
  /** 「移到后续章」候选章号（本章之后、非已完成）；空数组时该动作按钮置灰 */
  deferTargets: number[]
  /** 互斥禁用：saveBlocked 或本账本区另一行动作正处理中 */
  disabled: boolean
  /** 本行动作正在处理中（区别于别行触发的 disabled，仅本行按钮显示 spinner） */
  pending: boolean
  onConfirmDelivered: (eventChapter: number) => void
  onDefer: (toChapter: number) => void
  onCancel: () => void
  onAcknowledge: () => void
}) {
  const [openForm, setOpenForm] = useState<OpenForm>(null)
  const [eventChapter, setEventChapter] = useState(row.chapter)
  const [deferTo, setDeferTo] = useState<number | undefined>(deferTargets[0])
  const actionsDisabled = disabled || pending
  const eventChapterValid = Number.isFinite(eventChapter) && eventChapter >= 1 && eventChapter <= row.chapter

  return (
    <div className="flex flex-col items-end gap-1.5" data-state-ledger-row-actions-bar={row.id}>
      <div className="flex items-center gap-1">
        <IconTooltip label="正文已写到">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="正文已写到"
            data-state-ledger-row-action="mark-delivered"
            disabled={actionsDisabled}
            onClick={() => {
              setEventChapter(row.chapter)
              setOpenForm((prev) => (prev === 'delivered' ? null : 'delivered'))
            }}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
          </Button>
        </IconTooltip>
        <IconTooltip label={deferTargets.length === 0 ? '移到后续章（暂无已排章纲的后续章）' : '移到后续章'}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="移到后续章"
            data-state-ledger-row-action="defer"
            disabled={actionsDisabled || deferTargets.length === 0}
            onClick={() => {
              setDeferTo(deferTargets[0])
              setOpenForm((prev) => (prev === 'defer' ? null : 'defer'))
            }}
          >
            <CalendarClock className="size-3.5" />
          </Button>
        </IconTooltip>
        <IconTooltip label="取消这项计划">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="取消这项计划"
            data-state-ledger-row-action="cancel"
            disabled={actionsDisabled}
            onClick={onCancel}
          >
            <XCircle className="size-3.5" />
          </Button>
        </IconTooltip>
        <IconTooltip label="暂时保留提醒">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="暂时保留提醒"
            data-state-ledger-row-action="acknowledge"
            disabled={actionsDisabled}
            onClick={onAcknowledge}
          >
            <BellOff className="size-3.5" />
          </Button>
        </IconTooltip>
      </div>

      {openForm === 'delivered' && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-row border border-border bg-surface px-3 py-2 text-xs"
          data-state-ledger-delivered-form={row.id}
        >
          <span className="text-muted-foreground">{rowLabel}</span>
          <span className="text-foreground">写到第</span>
          <Input
            type="number"
            min={1}
            max={row.chapter}
            value={eventChapter}
            onChange={(e) => setEventChapter(e.target.valueAsNumber)}
            className="h-7 w-16"
            aria-label="发生章"
            disabled={actionsDisabled}
          />
          <span className="text-foreground">章</span>
          <Button
            type="button"
            size="sm"
            disabled={actionsDisabled || !eventChapterValid}
            data-state-ledger-row-action="confirm-delivered"
            onClick={() => onConfirmDelivered(eventChapter)}
          >
            确认兑现
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={actionsDisabled}
            onClick={() => setOpenForm(null)}
          >
            取消
          </Button>
        </div>
      )}

      {openForm === 'defer' && (
        <div
          className="flex items-center gap-2 rounded-row border border-border bg-surface px-3 py-2 text-xs"
          data-state-ledger-defer-form={row.id}
        >
          <Select
            value={deferTo !== undefined ? String(deferTo) : undefined}
            onValueChange={(v) => setDeferTo(Number(v))}
            disabled={actionsDisabled}
          >
            <SelectTrigger size="sm" aria-label="目标章">
              <SelectValue placeholder="选择章节" />
            </SelectTrigger>
            <SelectContent>
              {deferTargets.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  第 {n} 章
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            disabled={actionsDisabled || deferTo === undefined}
            data-state-ledger-row-action="confirm-defer"
            onClick={() => deferTo !== undefined && onDefer(deferTo)}
          >
            确认顺延
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={actionsDisabled}
            onClick={() => setOpenForm(null)}
          >
            取消
          </Button>
        </div>
      )}
    </div>
  )
}
