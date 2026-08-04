import { useMemo, useState } from 'react'
import { Pencil, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/cn'
import { PENDING_PILL_CLASS } from '@/design-system'
import { buildChapterAxis } from '@/lib/character-timeline-chapter-axis'
import type { ChapterAxisEntry, ChapterAxisNode } from '@/lib/character-timeline-chapter-axis'
import type {
  CharacterStateDimensionInfo,
  CharacterTimelineEvent,
  CharacterTimelineGroup,
} from '@shared/types/character-state'
import { ClampedValueText } from './ClampedValueText'
import {
  buildSecretTogglePayload,
  ChapterField,
  DimensionValueControl,
  EditIconButton,
  EditorShell,
  parseChapterDraft,
  SecretKnownBadge,
  TimelineCorrectEditor,
  TimelineRetractConfirm,
  TIMELINE_EDIT_DISCIPLINE,
} from './CharacterStatePanel'
import type { StateEditController } from './CharacterStatePanel'

/**
 * 角色变更记录章节轴（spec 2026-08-03 §4.3/§4.4）：每章一个节点、最新章在上、
 * 「初始设定」垫底；默认渲染最近 10 个节点，「显示更早记录」每次追加 20 个。
 * 编辑入口沿用状态面板 id 空间（tl-correct:/tl-retract:），补录统一入口 axis-backfill。
 */
export const INITIAL_CHAPTER_NODES = 10
export const CHAPTER_NODES_BATCH = 20

/** 修正/作废编辑器吃 CharacterTimelineEvent；从章节轴条目还原其所需字段 */
function toTimelineEvent(entry: ChapterAxisEntry): CharacterTimelineEvent {
  return {
    factId: entry.factId,
    value: entry.value,
    chapter: entry.eventChapter,
    source: entry.source,
    invalidated: false,
    invalidatedAtChapter: null,
    revoked: entry.revoked,
    secretKnown: entry.secretKnown,
  }
}

/** 补录编辑器（章节轴统一入口版）：先选维度，再走引擎 backfill（恒 add 语义） */
function ChapterAxisBackfillEditor({ controller }: { controller: StateEditController }) {
  const [dimKey, setDimKey] = useState(controller.dimensions[0]?.key ?? '')
  const [value, setValue] = useState('')
  const [chapter, setChapter] = useState(String(controller.defaultChapter))
  const dim = controller.dimensions.find((d) => d.key === dimKey) ?? null
  const parsedChapter = parseChapterDraft(chapter)
  return (
    <div className="mb-2" data-chapter-axis-backfill="true">
      <EditorShell
        onSave={() => {
          if (!dim) return
          void controller.submitState({
            action: 'backfill',
            dimension: dim.key,
            value: value.trim(),
            effective_chapter: parsedChapter ?? 0,
          })
        }}
        onCancel={controller.close}
        saveDisabled={!dim || !value.trim() || parsedChapter === null}
        pending={controller.pending}
        saveLabel="补录"
        hint={`补录抽取漏掉的既有事实。${TIMELINE_EDIT_DISCIPLINE}`}
      >
        <Select
          value={dimKey || undefined}
          onValueChange={(next) => {
            setDimKey(next)
            setValue('')
          }}
        >
          <SelectTrigger size="sm" aria-label="补录维度">
            <SelectValue placeholder="选维度" />
          </SelectTrigger>
          <SelectContent>
            {controller.dimensions.map((d) => (
              <SelectItem key={d.key} value={d.key}>
                {d.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {dim && <DimensionValueControl dim={dim} value={value} onChange={setValue} />}
        <ChapterField label="发生于第" value={chapter} onChange={setChapter} />
      </EditorShell>
    </div>
  )
}

function ChapterAxisEntryRow({
  entry,
  dim,
  controller,
}: {
  entry: ChapterAxisEntry
  dim: CharacterStateDimensionInfo | null
  controller?: StateEditController
}) {
  const revoked = entry.revoked !== null
  const canOperate = Boolean(controller?.enabled) && !revoked && !entry.derived
  // secret 开关脱词表门（PR#458 P2）：只认 controller 存在 + 未撤回 + 非派生条目
  const canToggleSecret = Boolean(controller) && !revoked && !entry.derived
  const correctEditorId = `tl-correct:${entry.factId}`
  const retractEditorId = `tl-retract:${entry.factId}`
  return (
    <div className="group/axisentry" data-chapter-axis-entry={`${entry.factId}:${entry.kind}`}>
      {/* 值区吃满剩余行宽、顶到边缘才截断：整行禁 wrap，值容器 min-w-0，标签/徽标/图标 shrink-0 */}
      <div className="flex min-w-0 items-center gap-x-1.5 text-sm text-foreground">
        <span className="shrink-0 text-muted-foreground">{entry.displayName}：</span>
        <span className={cn('flex min-w-0 items-center gap-1', revoked && 'text-muted-foreground line-through')}>
          {entry.kind === 'add' && <span aria-hidden="true" className="shrink-0 font-medium text-success">+</span>}
          {entry.kind === 'remove' && <span aria-hidden="true" className="shrink-0 font-medium text-destructive">−</span>}
          {entry.kind === 'set' && entry.prevValue !== null && (
            <>
              <ClampedValueText text={entry.prevValue} />
              <span aria-hidden="true" className="shrink-0 text-muted-foreground">→</span>
            </>
          )}
          <ClampedValueText text={entry.value} />
        </span>
        {entry.source === 'authored' && <span className={PENDING_PILL_CLASS}>作者钦定</span>}
        {entry.revoked === 'corrected' && <span className={PENDING_PILL_CLASS}>已修正</span>}
        {entry.revoked === 'retracted' && <span className={PENDING_PILL_CLASS}>已作废</span>}
        {entry.secretKnown !== null && (
          <SecretKnownBadge
            known={entry.secretKnown}
            pending={controller?.pending ?? false}
            onToggle={
              canToggleSecret && controller
                ? () => void controller.submitState(buildSecretTogglePayload(entry.factId, entry.secretKnown as boolean))
                : undefined
            }
          />
        )}
        {canOperate && controller && (
          <span className="inline-flex shrink-0 items-center opacity-0 transition-opacity group-hover/axisentry:opacity-100 has-[:focus-visible]:opacity-100">
            <EditIconButton
              label={`修正${entry.value}`}
              icon={<Pencil className="size-3" />}
              onClick={() => controller.open(correctEditorId)}
            />
            <EditIconButton
              label={`作废${entry.value}`}
              icon={<X className="size-3" />}
              onClick={() => controller.open(retractEditorId)}
            />
          </span>
        )}
      </div>
      {controller && !entry.derived && controller.activeEditor === correctEditorId && (
        <TimelineCorrectEditor event={toTimelineEvent(entry)} dim={dim} controller={controller} />
      )}
      {controller && !entry.derived && controller.activeEditor === retractEditorId && (
        <TimelineRetractConfirm event={toTimelineEvent(entry)} controller={controller} />
      )}
    </div>
  )
}

function ChapterAxisNodeItem({
  node,
  controller,
}: {
  node: ChapterAxisNode
  controller?: StateEditController
}) {
  const initial = node.chapter === 0
  return (
    <div className="relative" data-chapter-axis-node={node.chapter}>
      <span
        aria-hidden="true"
        data-chapter-axis-dot="true"
        className={cn(
          'absolute -left-[25px] top-[5px] size-2.5 rounded-full border-2 bg-canvas',
          initial ? 'border-border' : 'border-border-strong',
        )}
      />
      <div className={cn('text-sm font-semibold', initial ? 'text-muted-foreground' : 'text-foreground')}>
        {initial ? '初始设定' : `第 ${node.chapter} 章`}
      </div>
      <div className="mt-1 flex flex-col gap-1">
        {node.entries.map((entry, index) => (
          <ChapterAxisEntryRow
            key={`${entry.factId}-${entry.kind}-${index}`}
            entry={entry}
            dim={controller?.enabled ? (controller.dimensions.find((d) => d.key === entry.dimensionKey) ?? null) : null}
            controller={controller}
          />
        ))}
      </div>
    </div>
  )
}

export function ChapterAxisTimeline({
  groups,
  dimensions,
  controller,
}: {
  groups: CharacterTimelineGroup[]
  dimensions: CharacterStateDimensionInfo[]
  controller?: StateEditController
}) {
  const nodes = useMemo(() => buildChapterAxis(groups, dimensions), [groups, dimensions])
  const [visibleCount, setVisibleCount] = useState(INITIAL_CHAPTER_NODES)
  const visible = nodes.slice(0, visibleCount)
  const remainingNodes = nodes.slice(visible.length)
  // 「初始设定」（chapter 0）节点不计入剩余章数（spec §4.4）：还有节点待展开但都是 chapter 0 时，
  // remainingChapters 为 0，按钮文案退化为不带计数版本。
  const remainingChapters = remainingNodes.filter((node) => node.chapter !== 0).length
  const backfillOpen = controller?.activeEditor === 'axis-backfill'
  return (
    <div data-character-chapter-axis="true">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="px-1 text-sm font-semibold text-foreground">变更记录</h3>
        {controller?.enabled && controller.dimensions.length > 0 && !backfillOpen && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="补录记录"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            onClick={() => controller.open('axis-backfill')}
          >
            <Plus className="size-3.5" />
            补录
          </Button>
        )}
      </div>
      {backfillOpen && controller && <ChapterAxisBackfillEditor controller={controller} />}
      {nodes.length === 0 ? (
        <p className="text-xs text-muted-foreground">还没有变更记录，写作与记忆抽取会逐步填充。</p>
      ) : (
        <div className="relative ml-1.5 flex flex-col gap-4 border-l border-border pl-5 pt-1" data-chapter-axis-rail="true">
          {visible.map((node) => (
            <ChapterAxisNodeItem key={node.chapter} node={node} controller={controller} />
          ))}
        </div>
      )}
      {remainingNodes.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 text-muted-foreground"
          data-chapter-axis-more="true"
          onClick={() => setVisibleCount((count) => count + CHAPTER_NODES_BATCH)}
        >
          {remainingChapters > 0 ? `显示更早记录（还有 ${remainingChapters} 章）` : '显示更早记录'}
        </Button>
      )}
    </div>
  )
}
