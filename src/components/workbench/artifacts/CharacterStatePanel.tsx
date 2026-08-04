import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Loader2, Pencil, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

import { ChapterAxisTimeline } from './ChapterAxisTimeline'
import { ClampedValueText } from './ClampedValueText'
import { GROUP_CLASS, PENDING_PILL_CLASS, WARNING_OUTLINE_PILL_CLASS } from '@/design-system'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/cn'
import { readCharacterState, readPlannedState, submitAuthoredState, submitCharacterIdentity } from '@/lib/ipc'
import type { AuthoredStateEditInput } from '@shared/types/ipc'
import type {
  CharacterIdentitySummary,
  CharacterStateDimensionInfo,
  CharacterStateSnapshot,
  CharacterStateValue,
  CharacterTimelineEvent,
} from '@shared/types/character-state'
import type { PlannedStateRowDto } from '@shared/types/planned-state'
import { characterPredicateLabel } from '@shared/lib/character-predicate-labels'

/**
 * 角色页「状态卡 + 演变时间线」（A4×D2 片1只读 + 片2b 作者编辑，spec §6.2/§6.3）。
 *
 * 编辑档位纪律（spec §6.3）：状态编辑走第一档直存（改状态即作者意图直接表达，波及面天然是未来），
 * 不上 ImpactEvaluationDock；轻提示代替重评估（编辑处展示当前值来源+章号，CAS 由引擎
 * expected_current_value 兜底）。写权限归引擎工具独占，App 经 IPC 一次性 MCP client 直调。
 *
 * 编辑范围门：
 * - 维度锚定（直改/补录/增删项）：仅词表维度（hasVocabulary + dimensions 在列）；
 * - fact 锚定（改/删/确认背书）：凡带 factId 的行；已 revoked 行不再开操作；
 * - 无词表降级档（存量书）整体只读；关系区只读（引擎工具拒关系事实，follow-up）；
 * - 出生证（性别/年龄/别名）以 identity 非空（实体 json 存在且 uid 匹配）为门，改名本片不开；
 * - secret「本人已知晓」开关为 fact 锚定，不受词表门限制（PR#458 P2，产品拍板 2026-07-15）：
 *   mark_secret_known 引擎工具不需词表，无词表存量书也应能打标，只认 controller 存在 + factId
 *   非空（时间线另加 revoked 为空）；维度/时间线的直改/补录/修正/作废仍继续走 enabled 门。
 */

/**
 * 角色详情页文档 tab：'profile'=设定（自由 markdown 档案，本面板不渲染，恒 null）；
 * 'state'=状态（状态卡+章节轴，本面板的渲染内容）。
 */
export type CharacterDocTab = 'profile' | 'state'

type AuthoredStatePayload = AuthoredStateEditInput['payload']

export interface StateEditController {
  /**
   * 状态编辑总开关（hasVocabulary）；出生证编辑不受此门管；secret「本人已知晓」开关同样
   * 不受此门限制（fact 锚定，PR#458 P2 产品拍板 2026-07-15）——只对维度锚定编辑生效。
   */
  enabled: boolean
  dimensions: CharacterStateDimensionInfo[]
  /** 生效章默认值：角色卡 as_of_chapter（无卡=0） */
  defaultChapter: number
  activeEditor: string | null
  open: (id: string) => void
  close: () => void
  pending: boolean
  submitState: (payload: Omit<AuthoredStatePayload, 'character_uid'>) => Promise<void>
  submitIdentity: (fields: { gender: string; age: string; aliases: string[] }) => Promise<void>
}

const SECTION_TITLE_CLASS = 'px-1 text-sm font-semibold text-foreground'
const EDIT_HINT_CLASS = 'text-xs text-muted-foreground'
/** 时间线编辑区固定语义提示（spec §6.2 钉死：这里修正的是记忆，不是剧情本身） */
export const TIMELINE_EDIT_DISCIPLINE = '想改变剧情本身，请编辑正文或章纲'

/** 轻提示②（spec §6.3）：作者编辑状态时自查该角色未来计划，操作词固定映射 */
const OP_LABEL: Record<PlannedStateRowDto['operation'], string> = { set: '变为', add: '获得', remove: '失去' }

/** 计划行 dimension key → 词表显示名；缺映射（如无词表/维度已改名）回退受控谓词中文映射 */
function dimensionLabel(dimensions: CharacterStateDimensionInfo[], key: string): string {
  return dimensions.find((d) => d.key === key)?.displayName ?? characterPredicateLabel(key)
}

/**
 * 轻提示②的渲染节点，由 View 层算好、经 context 递给 EditorShell 在编辑器容器底部渲染
 * （spec §6.3「编辑器底部一行淡提示」）。走 context 而非 prop 是因为 EditorShell 被 7 个
 * 编辑器组件分别实例化，prop 要穿透全部 7 处；activeEditor 单值保证任一时刻至多挂载一个
 * EditorShell，提示不会重复出现。
 */
const FuturePlansHintContext = createContext<ReactNode>(null)

function formatChapter(chapter: number | null): string {
  if (chapter === null) return ''
  return chapter === 0 ? '初始' : `第${chapter}章`
}

function sourceLabel(source: 'extracted' | 'authored'): string {
  return source === 'authored' ? '作者钦定' : '正文抽取'
}

export function parseChapterDraft(draft: string): number | null {
  if (!/^\d+$/.test(draft.trim())) return null
  return Number.parseInt(draft.trim(), 10)
}

// ---------------------------------------------------------------------------
// 编辑基础件
// ---------------------------------------------------------------------------

function PendingBadge({ onEndorse, pending }: { onEndorse?: () => void; pending?: boolean }) {
  if (!onEndorse) {
    return (
      <span className={WARNING_OUTLINE_PILL_CLASS} data-character-state-pending="true" title="来自正文抽取，尚未经作者确认">
        待确认
      </span>
    )
  }
  return (
    <button
      type="button"
      className={cn(WARNING_OUTLINE_PILL_CLASS, 'gap-0.5 transition-colors hover:border-warning hover:text-warning')}
      data-character-state-pending="true"
      data-character-state-endorse="true"
      title="来自正文抽取，点击确认为作者钦定"
      disabled={pending}
      onClick={onEndorse}
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
      待确认
    </button>
  )
}

/** secret 事实的「本人已知晓」开关；known=false 时角色聊天不会提及该秘密（片4 处境包纪律）。 */
export function SecretKnownBadge({
  known,
  pending,
  onToggle,
}: {
  known: boolean
  pending: boolean
  onToggle?: () => void
}) {
  if (!onToggle) {
    return (
      <span className={PENDING_PILL_CLASS} data-character-state-secret-known="true">
        {known ? '本人已知晓' : '本人未知晓'}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={cn(PENDING_PILL_CLASS, 'gap-0.5 transition-colors hover:border-border-strong hover:text-foreground')}
      data-character-state-secret-toggle="true"
      disabled={pending}
      title={known ? '角色本人已知晓此秘密（点按撤销，聊天中将不再提及）' : '标记为本人已知晓（角色聊天中才会记得此秘密）'}
      onClick={onToggle}
    >
      {pending && <Loader2 className="size-3 animate-spin" />}
      {known ? '本人已知晓' : '本人未知晓'}
    </button>
  )
}

/** secret 知晓开关点按发出的 payload（known 取反）；抽成纯函数供 StateValueChip/时间线事件行共用与单测 */
export function buildSecretTogglePayload(
  factId: string,
  currentKnown: boolean,
): { action: 'mark_secret_known'; target_fact_id: string; known: boolean } {
  return { action: 'mark_secret_known', target_fact_id: factId, known: !currentKnown }
}

export function EditIconButton({
  label,
  icon,
  onClick,
  revealOnHover,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  revealOnHover?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      className={cn(
        'size-6 text-muted-foreground',
        revealOnHover && 'opacity-0 transition-opacity group-hover/staterow:opacity-100 focus-visible:opacity-100',
      )}
      onClick={onClick}
    >
      {icon}
    </Button>
  )
}

export function ChapterField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-20"
      />
      章
    </label>
  )
}

/** 维度值控件：enum 维度下拉值域梯子，free 维度文本输入 */
export function DimensionValueControl({
  dim,
  value,
  onChange,
}: {
  dim: CharacterStateDimensionInfo
  value: string
  onChange: (next: string) => void
}) {
  if (dim.valueType === 'enum') {
    return (
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger size="sm" aria-label={`${dim.displayName}的值`}>
          <SelectValue placeholder="选择" />
        </SelectTrigger>
        <SelectContent>
          {dim.values.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 w-40"
      maxLength={60}
      autoFocus
      aria-label={`${dim.displayName}的值`}
    />
  )
}

export function EditorShell({
  onSave,
  onCancel,
  saveDisabled,
  pending,
  saveLabel = '保存',
  hint,
  children,
}: {
  onSave: () => void
  onCancel: () => void
  saveDisabled: boolean
  pending: boolean
  saveLabel?: string
  hint?: ReactNode
  children: ReactNode
}) {
  const futurePlansHint = useContext(FuturePlansHintContext)
  return (
    <div className="mt-1 flex flex-col gap-2" data-character-state-editor="true">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {hint && <div className={EDIT_HINT_CLASS}>{hint}</div>}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={saveDisabled || pending} onClick={onSave}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {saveLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
          取消
        </Button>
      </div>
      {/* 轻提示②（spec §6.3）：编辑器容器底部，不阻断提交 */}
      {futurePlansHint}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 状态卡编辑器
// ---------------------------------------------------------------------------

/** one 维度换值（钦定当前状态）：显式生效章 + CAS（expected_current_value=卡面当前值） */
function OneDimEditor({
  dim,
  current,
  controller,
}: {
  dim: CharacterStateDimensionInfo
  current: CharacterStateValue | null
  controller: StateEditController
}) {
  const [value, setValue] = useState(current?.value ?? '')
  const [chapter, setChapter] = useState(String(controller.defaultChapter))
  const parsedChapter = parseChapterDraft(chapter)
  const unchanged = current !== null && value === current.value
  return (
    <EditorShell
      onSave={() =>
        void controller.submitState({
          action: 'set_current',
          dimension: dim.key,
          value: value.trim(),
          effective_chapter: parsedChapter ?? 0,
          ...(current ? { expected_current_value: current.value } : {}),
        })
      }
      onCancel={controller.close}
      saveDisabled={!value.trim() || parsedChapter === null || unchanged}
      pending={controller.pending}
      hint={
        current
          ? `当前值：${current.value}（${formatChapter(current.chapter) || '章号不详'}·${sourceLabel(current.source)}），保存后自生效章起覆盖`
          : '该维度尚无记录，保存即作者钦定'
      }
    >
      <DimensionValueControl dim={dim} value={value} onChange={setValue} />
      <ChapterField label="自第" value={chapter} onChange={setChapter} />
      起生效
    </EditorShell>
  )
}

/** many 维度加项（获得） */
function ManyAddEditor({ dim, controller }: { dim: CharacterStateDimensionInfo; controller: StateEditController }) {
  const [value, setValue] = useState('')
  const [chapter, setChapter] = useState(String(controller.defaultChapter))
  const parsedChapter = parseChapterDraft(chapter)
  return (
    <EditorShell
      onSave={() =>
        void controller.submitState({
          action: 'set_current',
          dimension: dim.key,
          operation: 'add',
          value: value.trim(),
          effective_chapter: parsedChapter ?? 0,
        })
      }
      onCancel={controller.close}
      saveDisabled={!value.trim() || parsedChapter === null}
      pending={controller.pending}
    >
      获得
      <DimensionValueControl dim={dim} value={value} onChange={setValue} />
      <ChapterField label="自第" value={chapter} onChange={setChapter} />
    </EditorShell>
  )
}

/** many 维度移除项（失去） */
function ManyRemoveEditor({
  dim,
  item,
  controller,
}: {
  dim: CharacterStateDimensionInfo
  item: CharacterStateValue
  controller: StateEditController
}) {
  const [chapter, setChapter] = useState(String(controller.defaultChapter))
  const parsedChapter = parseChapterDraft(chapter)
  return (
    <EditorShell
      onSave={() =>
        void controller.submitState({
          action: 'set_current',
          dimension: dim.key,
          operation: 'remove',
          value: item.value,
          effective_chapter: parsedChapter ?? 0,
        })
      }
      onCancel={controller.close}
      saveDisabled={parsedChapter === null}
      pending={controller.pending}
      saveLabel="移除"
    >
      <span className="text-sm">
        移除「{item.value}」，
      </span>
      <ChapterField label="自第" value={chapter} onChange={setChapter} />
      起失去
    </EditorShell>
  )
}

// ---------------------------------------------------------------------------
// 时间线编辑器
// ---------------------------------------------------------------------------

/** 纠错·改历史：新值 / 新发生章至少一项，原记录标失效留审计（引擎 correct） */
export function TimelineCorrectEditor({
  event,
  dim,
  controller,
}: {
  event: CharacterTimelineEvent
  dim: CharacterStateDimensionInfo | null
  controller: StateEditController
}) {
  const [value, setValue] = useState(event.value)
  const [chapter, setChapter] = useState(String(event.chapter))
  const parsedChapter = parseChapterDraft(chapter)
  const valueChanged = value.trim() !== event.value && value.trim().length > 0
  const chapterChanged = parsedChapter !== null && parsedChapter !== event.chapter
  return (
    <EditorShell
      onSave={() =>
        void controller.submitState({
          action: 'correct',
          target_fact_id: event.factId,
          ...(valueChanged ? { new_value: value.trim() } : {}),
          ...(chapterChanged ? { new_event_chapter: parsedChapter } : {}),
        })
      }
      onCancel={controller.close}
      saveDisabled={(!valueChanged && !chapterChanged) || parsedChapter === null}
      pending={controller.pending}
      saveLabel="修正"
      hint={`修正记忆使其符合正文，原记录标失效留痕。${TIMELINE_EDIT_DISCIPLINE}`}
    >
      {dim ? (
        <DimensionValueControl dim={dim} value={value} onChange={setValue} />
      ) : (
        <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-7 w-40" maxLength={60} />
      )}
      <ChapterField label="发生于第" value={chapter} onChange={setChapter} />
    </EditorShell>
  )
}

/** 纠错·删记录：作废虚构记录，不补新值（引擎 retract，受害行自动复活） */
export function TimelineRetractConfirm({
  event,
  controller,
}: {
  event: CharacterTimelineEvent
  controller: StateEditController
}) {
  return (
    <EditorShell
      onSave={() => void controller.submitState({ action: 'retract', target_fact_id: event.factId })}
      onCancel={controller.close}
      saveDisabled={false}
      pending={controller.pending}
      saveLabel="作废"
      hint={TIMELINE_EDIT_DISCIPLINE}
    >
      <span className="text-sm">
        作废「{event.value}（{formatChapter(event.chapter)}）」？记录将标记为从未生效，留痕可查。
      </span>
    </EditorShell>
  )
}

// ---------------------------------------------------------------------------
// 出生证编辑器（性别/年龄/别名；改名本片不开）
// ---------------------------------------------------------------------------

function IdentityEditor({
  identity,
  controller,
}: {
  identity: CharacterIdentitySummary
  controller: StateEditController
}) {
  const [gender, setGender] = useState(identity.gender ?? '')
  const [age, setAge] = useState(identity.age ?? '')
  const [aliasesDraft, setAliasesDraft] = useState(identity.aliases.join('、'))
  const aliases = aliasesDraft
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return (
    <EditorShell
      onSave={() => void controller.submitIdentity({ gender: gender.trim(), age: age.trim(), aliases })}
      onCancel={controller.close}
      saveDisabled={aliases.length > 12 || aliases.some((item) => item.length > 20)}
      pending={controller.pending}
      hint="身份字段机械同步进档案 md；清空即移除该字段"
    >
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        性别
        <Input value={gender} onChange={(e) => setGender(e.target.value)} className="h-7 w-20" maxLength={8} />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        年龄
        <Input value={age} onChange={(e) => setAge(e.target.value)} className="h-7 w-28" maxLength={20} />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        别名
        <Input
          value={aliasesDraft}
          onChange={(e) => setAliasesDraft(e.target.value)}
          className="h-7 w-48"
          placeholder="顿号分隔，最多 12 个"
        />
      </label>
    </EditorShell>
  )
}

// ---------------------------------------------------------------------------
// 状态卡（读 + 编辑入口）
// ---------------------------------------------------------------------------

function CardFieldRow({ label, actions, children }: { label: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="group/staterow grid grid-cols-[88px_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-2.5">
      <dt className="pt-0.5 text-xs leading-6 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-6 text-foreground">
        {children}
      </dd>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : <span />}
    </div>
  )
}

function StateValueChip({
  item,
  controller,
  removeEditorId,
}: {
  item: CharacterStateValue
  controller?: StateEditController
  removeEditorId?: string
}) {
  const canEndorse = controller?.enabled && item.source === 'extracted' && item.factId !== null
  // secret「本人已知晓」开关为 fact 锚定，不受词表门限制（PR#458 P2，产品拍板 2026-07-15）：
  // mark_secret_known 引擎工具不需词表，无词表存量书也应能打标——controller 对象存在即编辑
  // 通道可用，enabled 只是维度锚定编辑（直改/补录）的门，不该连带锁死 secret 开关。
  const canToggleSecret = Boolean(controller) && item.factId !== null
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <ClampedValueText text={item.value} />
      {item.source === 'extracted' && (
        <PendingBadge
          pending={controller?.pending}
          onEndorse={
            canEndorse
              ? () => void controller.submitState({ action: 'endorse', target_fact_id: item.factId as string })
              : undefined
          }
        />
      )}
      {item.secretKnown !== null && (
        <SecretKnownBadge
          known={item.secretKnown}
          pending={controller?.pending ?? false}
          onToggle={
            canToggleSecret && controller
              ? () => void controller.submitState(buildSecretTogglePayload(item.factId as string, item.secretKnown as boolean))
              : undefined
          }
        />
      )}
      {controller?.enabled && removeEditorId && (
        <EditIconButton
          label={`移除${item.value}`}
          icon={<X className="size-3" />}
          onClick={() => controller.open(removeEditorId)}
          revealOnHover
        />
      )}
    </span>
  )
}

/** 状态卡行 = 词表维度全集（含尚无记录的维度，占位可钦定）∪ 卡面「其他」区条目 */
interface CardRow {
  key: string
  displayName: string
  cardinality: 'one' | 'many'
  values: CharacterStateValue[]
  dim: CharacterStateDimensionInfo | null
}

function buildCardRows(snapshot: CharacterStateSnapshot, controller?: StateEditController): CardRow[] {
  const byKey = new Map(snapshot.card.map((entry) => [entry.key, entry]))
  const rows: CardRow[] = []
  if (controller?.enabled) {
    for (const dim of controller.dimensions) {
      const entry = byKey.get(dim.key)
      rows.push({
        key: dim.key,
        displayName: dim.displayName,
        cardinality: dim.cardinality,
        values: entry?.values ?? [],
        dim,
      })
      byKey.delete(dim.key)
    }
  }
  for (const entry of snapshot.card) {
    if (!byKey.has(entry.key)) continue
    rows.push({ ...entry, dim: null })
  }
  return rows
}

function identityText(identity: CharacterIdentitySummary): string {
  const parts = [identity.gender, identity.age].filter(Boolean) as string[]
  if (identity.aliases.length > 0) parts.push(`别名：${identity.aliases.join('、')}`)
  return parts.join(' · ')
}

function StateCardSection({
  snapshot,
  controller,
}: {
  snapshot: CharacterStateSnapshot
  controller?: StateEditController
}) {
  const { identity, relationships, asOfChapter } = snapshot
  const rows = buildCardRows(snapshot, controller)
  return (
    <div data-character-state-card="true">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className={SECTION_TITLE_CLASS}>当前状态</h3>
        {typeof asOfChapter === 'number' && asOfChapter > 0 && (
          <span className="text-xs text-muted-foreground">截至第 {asOfChapter} 章</span>
        )}
      </div>
      <dl className={GROUP_CLASS}>
        {identity && (
          <CardFieldRow
            label="基本"
            actions={
              controller && controller.activeEditor !== 'identity' ? (
                <EditIconButton
                  label="编辑身份字段"
                  icon={<Pencil className="size-3.5" />}
                  onClick={() => controller.open('identity')}
                  revealOnHover
                />
              ) : undefined
            }
          >
            {controller?.activeEditor === 'identity' ? (
              <IdentityEditor identity={identity} controller={controller} />
            ) : (
              <span className={cn(!identityText(identity) && 'text-muted-foreground')}>
                {identityText(identity) || '未设定'}
              </span>
            )}
          </CardFieldRow>
        )}
        {rows.map((row) => {
          const editable = controller?.enabled && row.dim !== null
          const editorId = row.cardinality === 'one' ? `card:${row.key}` : `card-add:${row.key}`
          const editorOpen = controller?.activeEditor === editorId
          return (
            <CardFieldRow
              key={row.key}
              label={row.displayName}
              actions={
                editable && !editorOpen ? (
                  <EditIconButton
                    label={row.cardinality === 'one' ? `编辑${row.displayName}` : `添加${row.displayName}`}
                    icon={row.cardinality === 'one' ? <Pencil className="size-3.5" /> : <Plus className="size-3.5" />}
                    onClick={() => controller?.open(editorId)}
                    revealOnHover
                  />
                ) : undefined
              }
            >
              {editorOpen && controller && row.dim ? (
                row.cardinality === 'one' ? (
                  <OneDimEditor dim={row.dim} current={row.values[0] ?? null} controller={controller} />
                ) : (
                  <ManyAddEditor dim={row.dim} controller={controller} />
                )
              ) : (
                <>
                  {row.values.length === 0 && <span className="text-muted-foreground">未设定</span>}
                  {row.values.map((item, index) => {
                    const removeEditorId =
                      row.cardinality === 'many' && row.dim ? `chip-remove:${row.key}:${item.factId ?? index}` : undefined
                    return (
                      <Fragment key={`${item.value}-${index}`}>
                        <StateValueChip item={item} controller={controller} removeEditorId={removeEditorId} />
                        {removeEditorId && controller?.activeEditor === removeEditorId && row.dim && (
                          <ManyRemoveEditor dim={row.dim} item={item} controller={controller} />
                        )}
                      </Fragment>
                    )
                  })}
                </>
              )}
            </CardFieldRow>
          )
        })}
        {relationships.length > 0 && (
          <CardFieldRow label="关系">
            {relationships.map((entry, index) => (
              <span key={`${entry.otherName}-${index}`} className="inline-flex items-center gap-1">
                <span>
                  {entry.otherName}
                  <span className="text-muted-foreground">（{entry.state}）</span>
                </span>
                {/* 关系事实引擎工具不受理（follow-up），只读展示不开确认入口 */}
                {entry.source === 'extracted' && <PendingBadge />}
              </span>
            ))}
          </CardFieldRow>
        )}
      </dl>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

/** 轻提示②节点构造（spec §6.3）：把该角色未来计划行拼成编辑器底部提示文案 */
function buildFuturePlansHint(
  dimensions: CharacterStateDimensionInfo[],
  futurePlans: PlannedStateRowDto[],
): ReactNode {
  if (futurePlans.length === 0) return null
  return (
    <p className="mt-2 text-xs leading-5 text-muted-foreground" data-future-plans-hint="true">
      该角色已有未来计划：
      {futurePlans
        .map(
          (plan) =>
            `第 ${plan.chapter} 章 ${dimensionLabel(dimensions, plan.dimension)} ${OP_LABEL[plan.operation]}「${plan.value}」`,
        )
        .join('；')}
    </p>
  )
}

export function CharacterStatePanelView({
  snapshot,
  controller,
  futurePlans = [],
}: {
  snapshot: CharacterStateSnapshot
  controller?: StateEditController
  /**
   * 轻提示②数据（spec §6.3）：主进程已按精确「已写章集合」过滤好的未写章计划行（readCharacterFuturePlans）。
   * 经 FuturePlansHintContext 渲染在当前打开的编辑器（EditorShell）容器底部——没有编辑器
   * 挂载（activeEditor 为空）时提示自然不出现。
   */
  futurePlans?: PlannedStateRowDto[]
}) {
  const hasEditableDimensions = Boolean(controller?.enabled && controller.dimensions.length > 0)
  const isEmpty =
    snapshot.identity === null &&
    snapshot.card.length === 0 &&
    snapshot.timeline.length === 0 &&
    snapshot.relationships.length === 0 &&
    !hasEditableDimensions
  const futurePlansHint = buildFuturePlansHint(snapshot.dimensions, futurePlans)
  return (
    <FuturePlansHintContext.Provider value={futurePlansHint}>
      <section className="mb-8 flex flex-col gap-5" data-character-state-panel="true">
        {isEmpty ? (
          <p className="text-xs text-muted-foreground">尚无结构化状态记录，写作与记忆抽取会逐步填充。</p>
        ) : (
          <>
            <StateCardSection snapshot={snapshot} controller={controller} />
            <ChapterAxisTimeline groups={snapshot.timeline} dimensions={snapshot.dimensions} controller={controller} />
          </>
        )}
      </section>
    </FuturePlansHintContext.Provider>
  )
}

/** 状态 tab 快照不可用（记忆库未建/损坏）的克制空态——不藏 tab（spec 2026-08-03 §4.5） */
export function CharacterStateUnavailableNotice() {
  return (
    <p className="text-xs text-muted-foreground" data-character-state-unavailable="true">
      本书的记忆库还没就绪，暂时无法展示状态记录。
    </p>
  )
}

/**
 * 轻提示②的完整 effect 体（spec §6.3）：编辑器打开时拉该角色计划行，原样展示——「未写章」
 * 过滤已下沉主进程（readCharacterFuturePlans 按精确已写章集合过滤，见
 * electron/main/novel/planned-state-read.ts 头注），本层不再复刻 floor 判定（评审 P2-1：
 * 按最大完成章过滤会漏新书与断档章）。editor 未打开则同步清空，不发起请求——这同时保证了
 * 编辑器关闭后提示不残留、切换角色/编辑器时靠 cancelled 标记防止晚到的旧请求覆盖新状态。
 * 加载失败静默清空（提示是增益不是账，不弹 toast、不打日志）。抽成可注入 setFuturePlans
 * 的独立函数是为了不依赖真实 DOM 也能对整条链路做真行为单测（同 use-planned-state-counts.ts
 * 的既有套路）。
 */
export function runFuturePlansEffect(
  {
    projectPath,
    characterUid,
    activeEditor,
  }: {
    projectPath: string
    characterUid: string
    activeEditor: string | null
  },
  setFuturePlans: (rows: PlannedStateRowDto[]) => void,
): (() => void) | undefined {
  if (!activeEditor) {
    setFuturePlans([])
    return undefined
  }
  let cancelled = false
  readPlannedState({ projectPath, scope: { kind: 'character', characterUid } })
    .then((result) => {
      if (cancelled) return
      setFuturePlans(result.available ? result.rows : [])
    })
    .catch(() => {
      if (!cancelled) setFuturePlans([])
    })
  return () => {
    cancelled = true
  }
}

export function CharacterStatePanel({
  projectPath,
  characterUid,
  characterName,
  mode,
  reloadSignal,
  onChanged,
}: {
  projectPath: string
  characterUid: string
  characterName: string
  /**
   * 文档 tab 切片：'profile' 时本面板不渲染内容（恒 null）——容器仍常驻挂载，只为让快照在
   * 后台单次加载好，切到 'state' 时无需等待即可展示状态卡+章节轴。
   */
  mode: CharacterDocTab
  /** 工作台 artifacts 重载信号（身份变化即重取快照，平滑不清空）——smooth 刷新重取 */
  reloadSignal?: unknown
  /** 出生证编辑落盘后通知上游重载 artifacts（md 身份行由引擎机械同步） */
  onChanged?: () => void
}) {
  const [snapshot, setSnapshot] = useState<CharacterStateSnapshot | null>(null)
  const [activeEditor, setActiveEditor] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [futurePlans, setFuturePlans] = useState<PlannedStateRowDto[]>([])
  const requestSeq = useRef(0)

  const load = useCallback(
    async (clear: boolean) => {
      const seq = ++requestSeq.current
      if (clear) setSnapshot(null)
      try {
        const result = await readCharacterState({ projectPath, characterUid, characterName })
        if (seq === requestSeq.current) setSnapshot(result)
      } catch {
        // 读取失败按不可用处理：页面回到现状（只有 md），不打扰
        if (seq === requestSeq.current && clear) setSnapshot(null)
      }
    },
    [projectPath, characterUid, characterName],
  )

  useEffect(() => {
    setActiveEditor(null)
    void load(true)
  }, [load])

  // 外部重载信号（F5/agent run 后 artifacts 重建）：平滑重取，不清空已渲染内容
  const isFirstSignal = useRef(true)
  useEffect(() => {
    if (isFirstSignal.current) {
      isFirstSignal.current = false
      return
    }
    void load(false)
  }, [reloadSignal, load])

  // 轻提示②（spec §6.3）：编辑器打开时异步加载该角色未来计划，供作者自查；「未写章」过滤
  // 已下沉主进程（见 runFuturePlansEffect 头注），此处只需在快照未就绪时不发起请求——依赖
  // 收窄到 snapshot?.available（而非整个 snapshot 对象），避免 reloadSignal 平滑重取换了
  // snapshot 引用但可用性没变时重复拉计划表。
  const snapshotAvailable = snapshot?.available ?? false
  useEffect(
    () =>
      runFuturePlansEffect(
        { projectPath, characterUid, activeEditor: snapshotAvailable ? activeEditor : null },
        setFuturePlans,
      ),
    [projectPath, characterUid, activeEditor, snapshotAvailable],
  )

  if (mode === 'profile') return null
  if (snapshot === null) return null
  if (!snapshot.available) return <CharacterStateUnavailableNotice />

  const submitState = async (payload: Omit<AuthoredStatePayload, 'character_uid'>) => {
    setPending(true)
    try {
      const result = await submitAuthoredState({
        projectPath,
        payload: { character_uid: characterUid, ...payload },
      })
      if (result.ok) {
        toast.success('已保存')
        setActiveEditor(null)
        await load(false)
      } else {
        toast.error(result.message ?? '保存失败')
      }
    } catch {
      // IPC 入参校验抛错等异常路径：与引擎失败同口径提示，不留未处理 rejection
      toast.error('保存失败，请稍后重试。')
    } finally {
      setPending(false)
    }
  }

  const submitIdentity = async (fields: { gender: string; age: string; aliases: string[] }) => {
    setPending(true)
    try {
      const result = await submitCharacterIdentity({ projectPath, characterUid, characterName, ...fields })
      if (result.ok) {
        toast.success('已保存')
        setActiveEditor(null)
        await load(false)
        onChanged?.()
      } else {
        toast.error(result.message ?? '保存失败')
      }
    } catch {
      toast.error('保存失败，请稍后重试。')
    } finally {
      setPending(false)
    }
  }

  const controller: StateEditController = {
    enabled: snapshot.hasVocabulary,
    dimensions: snapshot.dimensions,
    // 生效章默认=最新完成章（spec §3.3），不取角色卡 asOf——角色尚无卡时 asOf 为 null，
    // 回落 0 会把「当下钦定」静默写成全书初始设定（PR#455 评审 F4）
    defaultChapter: snapshot.latestCompletedChapter,
    activeEditor,
    open: setActiveEditor,
    close: () => setActiveEditor(null),
    pending,
    submitState,
    submitIdentity,
  }

  return <CharacterStatePanelView snapshot={snapshot} controller={controller} futurePlans={futurePlans} />
}
