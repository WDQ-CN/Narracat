import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GROUP_CLASS, MUTED_PILL_CLASS, SUCCESS_PILL_CLASS, WARNING_PILL_CLASS } from '@/design-system'
import { cn } from '@/lib/cn'
import { useAgentStore } from '@/lib/agent-store'
import { readPlannedState, resolvePlannedState, submitAuthoredState, updateChapterStateChanges } from '@/lib/ipc'
import { usePlannedStateRefresh } from '@/lib/planned-state-refresh'
import { StateChangesRowActions } from './StateChangesRowActions'
import type {
  ChapterPlannedStateSnapshot,
  PlannedStateCharacterDto,
  PlannedStateDimensionDto,
  PlannedStateRowDto,
} from '@shared/types/planned-state'
import type { UpdateChapterStateChangesInput } from '@shared/types/ipc'
import { characterPredicateLabel } from '@shared/lib/character-predicate-labels'

/**
 * 章纲卡「本章状态变更」计划账本区（A4×D2 片3b，spec §2.1/§7.1，Task 6）。
 *
 * 数据源=计划表（planned_state_changes，片3a 只读通道 T5），不是章纲 json——json 只在提交编辑时
 * 作为 CAS 基线（expected_state_changes）。未写章且词表齐全时行内可编辑（增删改），保存时把编辑后的
 * 全量 planned 行整段替换进 json（json 自愈同步为当前 planned 集合）；已写章或词表缺失时只读展示，
 * 五态徽标反映兑现进度。四个处置动作（未兑现行的 defer/cancel/acknowledge/mark_delivered，Task 7）
 * 挂在 data-state-ledger-row-actions 插槽里：defer/cancel/acknowledge 经 resolvePlannedState 直调
 * 三态迁移；mark_delivered 是两步路由（先 submitAuthoredState 补记忆再 resolvePlannedState 落账，
 * 第一步失败第二步绝不发），UI 交给 StateChangesRowActions 子组件（行内迷你表单）。
 *
 * 保存/四动作成功后除了本地 reload，还调 planned-state-refresh 的 bump()（终审 Fix 1）：
 * WorkbenchPrimarySidebar 的「未兑现计划」橙点徽标跟本组件不在同一棵组件子树上，onChanged
 * 只够刷新同分支内的章纲 artifacts，够不到侧栏，须走跨组件的 module 级 store 信号。
 */

type StateChangeJsonEntry = UpdateChapterStateChangesInput['payload']['state_changes'][number]

const MAX_PLANNED_ROWS = 8
const VALUE_MAX_LENGTH = 60
const REASON_MAX_LENGTH = 100

/** 编辑集→payload 映射（brief 逐字实现）：只含 planned 行，终态行（delivered/deferred/…）绝不混入保存请求。 */
export function toJsonEntries(rows: PlannedStateRowDto[]): StateChangeJsonEntry[] {
  return rows
    .filter((row) => row.status === 'planned')
    .map((row) => ({
      character: { character_uid: row.characterUid, name: row.characterName },
      dimension: row.dimension,
      operation: row.operation,
      value: row.value,
      ...(row.reason ? { reason: row.reason } : {}),
    }))
}

// ---------------------------------------------------------------------------
// 下拉选项构造（纯函数）——Radix SelectContent 关闭态在 SSR 下渲染为 null（Portal 内容
// 只在 layout effect 里挂载），选项集合无法靠静态渲染断言锁定；抽成纯函数让单测直接锁
// 数据映射正确性，组件内只消费结果。
// ---------------------------------------------------------------------------

export interface LedgerSelectOption {
  value: string
  label: string
}

export function characterOptions(characters: PlannedStateCharacterDto[]): LedgerSelectOption[] {
  return characters.map((c) => ({ value: c.uid, label: c.name }))
}

export function dimensionOptions(dimensions: PlannedStateDimensionDto[]): LedgerSelectOption[] {
  return dimensions.map((d) => ({ value: d.key, label: d.displayName }))
}

/** enum 维度返回值域梯子选项；free 维度返回 null（走文本输入分支） */
export function valueOptions(dim: PlannedStateDimensionDto | undefined): LedgerSelectOption[] | null {
  if (dim?.valueType !== 'enum') return null
  return (dim.values ?? []).map((v) => ({ value: v, label: v }))
}

/** many 维度返回「获得/失去」操作对；one 维度返回 null（固定「设为」，无操作选择） */
export function operationOptions(dim: PlannedStateDimensionDto | undefined): LedgerSelectOption[] | null {
  if (dim?.cardinality !== 'many') return null
  return [
    { value: 'add', label: '获得' },
    { value: 'remove', label: '失去' },
  ]
}

export interface DraftRow {
  /** 本地编辑态标识：既有行沿用计划表行 id，新增行为随机临时 id，仅供 React key/编辑定位用 */
  tempId: string
  characterUid: string
  characterName: string
  dimension: string
  operation: 'set' | 'add' | 'remove'
  value: string
  reason: string
}

function createTempId(): string {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function defaultOperationForDimension(dim: PlannedStateDimensionDto | undefined): 'set' | 'add' | 'remove' {
  return dim?.cardinality === 'many' ? 'add' : 'set'
}

function rowFromPlanned(row: PlannedStateRowDto): DraftRow {
  return {
    tempId: row.id,
    characterUid: row.characterUid,
    characterName: row.characterName,
    dimension: row.dimension,
    operation: row.operation,
    value: row.value,
    reason: row.reason ?? '',
  }
}

function draftRowsToPlannedRows(chapter: number, rows: DraftRow[]): PlannedStateRowDto[] {
  return rows.map((row) => ({
    id: row.tempId,
    chapter,
    status: 'planned',
    deferredToChapter: null,
    characterUid: row.characterUid,
    characterName: row.characterName,
    dimension: row.dimension,
    operation: row.operation,
    value: row.value,
    reason: row.reason.trim() ? row.reason.trim() : null,
  }))
}

function hasInvalidRow(rows: DraftRow[]): boolean {
  return rows.some((row) => !row.characterUid.trim() || !row.dimension.trim() || !row.value.trim())
}

/** 五态徽标：未到章（planned+未写）/未兑现（planned+已写，橙）/已兑现/已顺延（→ 第 N 章）/已取消/已知悉 */
export function deriveStatusBadge(
  row: Pick<PlannedStateRowDto, 'status' | 'deferredToChapter'>,
  chapterWritten: boolean,
): { label: string; className: string } {
  switch (row.status) {
    case 'planned':
      return chapterWritten
        ? { label: '未兑现', className: WARNING_PILL_CLASS }
        : { label: '未到章', className: MUTED_PILL_CLASS }
    case 'delivered':
      return { label: '已兑现', className: SUCCESS_PILL_CLASS }
    case 'deferred':
      return {
        label: row.deferredToChapter ? `已顺延 → 第 ${row.deferredToChapter} 章` : '已顺延',
        className: MUTED_PILL_CLASS,
      }
    case 'cancelled':
      return { label: '已取消', className: MUTED_PILL_CLASS }
    case 'acknowledged':
    default:
      return { label: '已知悉', className: MUTED_PILL_CLASS }
  }
}

/** 操作+值展示文案：set 直接给值本身（编辑器里固定操作叫「设为」，展示语境不复述动词）；add/remove 保留动词。 */
function operationText(row: Pick<PlannedStateRowDto, 'operation' | 'value'>): string {
  if (row.operation === 'add') return `获得「${row.value}」`
  if (row.operation === 'remove') return `失去「${row.value}」`
  return row.value
}

function dimensionLabel(dimensions: PlannedStateDimensionDto[], key: string): string {
  // 缺映射回退受控谓词中文映射（真机走查回报：裸英文作者看不懂）
  return dimensions.find((d) => d.key === key)?.displayName ?? characterPredicateLabel(key)
}

/** 未兑现行判定（Task 7 四动作只出现在这类行上）：与 deriveStatusBadge 的「未兑现」分支同一口径。 */
export function isUndeliveredRow(row: Pick<PlannedStateRowDto, 'status'>, chapterWritten: boolean): boolean {
  return row.status === 'planned' && chapterWritten
}

export interface StateChangesLedgerController {
  /** null=只读展示；非 null=编辑态草稿行数组 */
  editingRows: DraftRow[] | null
  pending: boolean
  /** 活动 agent run 存在：保存/编辑入口按钮禁用（WorkbenchStage 同款互斥口径） */
  saveBlocked: boolean
  /** 未写章 && 词表齐全 && 有 json CAS 基线——编辑总开关 */
  canEdit: boolean
  startEdit: () => void
  cancelEdit: () => void
  addRow: () => void
  removeRow: (tempId: string) => void
  updateRow: (tempId: string, patch: Partial<DraftRow>) => void
  save: () => void
  /** 「移到后续章」候选章号（父级三级透传：WorkbenchObjectView 按 tocItems 算 → ChapterOutlineCardsView → 本组件） */
  deferTargets: number[]
  /** 未兑现行四动作互斥：非 null 时全账本区动作按钮禁用，值=正在处理的行 id（用于该行按钮显示 spinner） */
  rowActionPending: string | null
  confirmDelivered: (row: PlannedStateRowDto, eventChapter: number) => void
  defer: (row: PlannedStateRowDto, toChapter: number) => void
  cancelPlanned: (row: PlannedStateRowDto) => void
  acknowledgePlanned: (row: PlannedStateRowDto) => void
}

function OptionSelect({
  value,
  options,
  placeholder,
  ariaLabel,
  onChange,
}: {
  value: string | undefined
  options: LedgerSelectOption[]
  placeholder?: string
  ariaLabel: string
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function EditableRow({
  row,
  characters,
  dimensions,
  onChange,
  onRemove,
  removeDisabled,
}: {
  row: DraftRow
  characters: PlannedStateCharacterDto[]
  dimensions: PlannedStateDimensionDto[]
  onChange: (patch: Partial<DraftRow>) => void
  onRemove: () => void
  /** 活动 agent run 期间账本区整体只读（spec）：删行也一并禁 */
  removeDisabled: boolean
}) {
  const dim = dimensions.find((d) => d.key === row.dimension)
  const opOptions = operationOptions(dim)
  const enumValueOptions = valueOptions(dim)
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-row border border-border bg-surface px-3 py-2"
      data-state-ledger-edit-row={row.tempId}
    >
      <OptionSelect
        value={row.characterUid || undefined}
        options={characterOptions(characters)}
        placeholder="选择角色"
        ariaLabel="角色"
        onChange={(uid) => {
          const character = characters.find((c) => c.uid === uid)
          onChange({ characterUid: uid, characterName: character?.name ?? '' })
        }}
      />

      <OptionSelect
        value={row.dimension || undefined}
        options={dimensionOptions(dimensions)}
        placeholder="选择维度"
        ariaLabel="维度"
        onChange={(key) => {
          const nextDim = dimensions.find((d) => d.key === key)
          onChange({ dimension: key, operation: defaultOperationForDimension(nextDim), value: '' })
        }}
      />

      {opOptions ? (
        <OptionSelect
          value={row.operation}
          options={opOptions}
          ariaLabel="操作"
          onChange={(operation) => onChange({ operation: operation as 'add' | 'remove' })}
        />
      ) : (
        <span className="text-xs text-muted-foreground">设为</span>
      )}

      {enumValueOptions ? (
        <OptionSelect
          value={row.value || undefined}
          options={enumValueOptions}
          placeholder="选择值"
          ariaLabel="值"
          onChange={(value) => onChange({ value })}
        />
      ) : (
        <Input
          value={row.value}
          onChange={(e) => onChange({ value: e.target.value.slice(0, VALUE_MAX_LENGTH) })}
          maxLength={VALUE_MAX_LENGTH}
          className="h-7 w-32"
          placeholder="值"
          aria-label="值"
        />
      )}

      <Input
        value={row.reason}
        onChange={(e) => onChange({ reason: e.target.value.slice(0, REASON_MAX_LENGTH) })}
        maxLength={REASON_MAX_LENGTH}
        className="h-7 w-40"
        placeholder="缘由（可选）"
        aria-label="缘由"
      />

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="删除该行"
        data-state-ledger-action="remove-row"
        disabled={removeDisabled}
        onClick={onRemove}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

/** 纯展示组件：接受快照+受控编辑态，SSR 可测（renderToStaticMarkup），不含任何 IPC/store 依赖。 */
export function StateChangesLedgerView({
  snapshot,
  chapterWritten,
  controller,
}: {
  snapshot: ChapterPlannedStateSnapshot
  chapterWritten: boolean
  controller: StateChangesLedgerController
}) {
  const { available, rows, dimensions, characters } = snapshot
  // 词表缺失（dimensions 空）且无行时零打扰整体不渲染（行为规格 1）
  if (!available || (rows.length === 0 && dimensions.length === 0)) return null

  const isEditing = controller.editingRows !== null
  const canEnterEdit = controller.canEdit && !isEditing

  return (
    <section className="mt-6 space-y-2" data-state-ledger="true">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 className="text-sm font-semibold text-foreground">本章状态变更</h3>
        {canEnterEdit && rows.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-state-ledger-action="edit"
            disabled={controller.saveBlocked}
            onClick={controller.startEdit}
          >
            编辑
          </Button>
        )}
      </div>

      {!isEditing && rows.length === 0 && (
        <div
          className="flex items-center justify-between gap-3 rounded-row border border-border bg-surface px-3 py-3"
          data-state-ledger-empty="true"
        >
          <p className="text-sm text-muted-foreground">本章暂无计划的状态变更</p>
          {controller.canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={controller.saveBlocked}
              data-state-ledger-action="add-first"
              onClick={controller.addRow}
            >
              <Plus className="size-3.5" />
              计划一条状态变更
            </Button>
          )}
        </div>
      )}

      {!isEditing && rows.length > 0 && (
        <dl className={GROUP_CLASS}>
          {rows.map((row) => {
            const badge = deriveStatusBadge(row, chapterWritten)
            const undelivered = isUndeliveredRow(row, chapterWritten)
            return (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
                data-state-ledger-row={row.id}
              >
                <div className="min-w-0 flex-1 text-sm leading-6 text-foreground">
                  <span className="font-medium">{row.characterName}</span>
                  <span className="text-muted-foreground"> · {dimensionLabel(dimensions, row.dimension)}</span>
                  <span className="ml-1">{operationText(row)}</span>
                  {row.reason && <span className="ml-1 text-xs text-muted-foreground">（{row.reason}）</span>}
                </div>
                <div className="flex shrink-0 items-center gap-2" data-state-ledger-row-actions="true">
                  <span className={cn('shrink-0', badge.className)} data-state-ledger-status={row.status}>
                    {badge.label}
                  </span>
                  {undelivered && (
                    <StateChangesRowActions
                      row={row}
                      rowLabel={`${row.characterName} · ${dimensionLabel(dimensions, row.dimension)} ${operationText(row)}`}
                      deferTargets={controller.deferTargets}
                      disabled={controller.saveBlocked || controller.rowActionPending !== null}
                      pending={controller.rowActionPending === row.id}
                      onConfirmDelivered={(eventChapter) => controller.confirmDelivered(row, eventChapter)}
                      onDefer={(toChapter) => controller.defer(row, toChapter)}
                      onCancel={() => controller.cancelPlanned(row)}
                      onAcknowledge={() => controller.acknowledgePlanned(row)}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </dl>
      )}

      {isEditing && controller.editingRows && (
        <div className="flex flex-col gap-2" data-state-ledger-editor="true">
          <div className="flex flex-col gap-2">
            {controller.editingRows.map((row) => (
              <EditableRow
                key={row.tempId}
                row={row}
                characters={characters}
                dimensions={dimensions}
                onChange={(patch) => controller.updateRow(row.tempId, patch)}
                onRemove={() => controller.removeRow(row.tempId)}
                removeDisabled={controller.saveBlocked}
              />
            ))}
          </div>
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-state-ledger-action="add-row"
              disabled={controller.editingRows.length >= MAX_PLANNED_ROWS || controller.saveBlocked}
              onClick={controller.addRow}
            >
              <Plus className="size-3.5" />
              加一行
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              data-state-ledger-action="save"
              disabled={controller.pending || controller.saveBlocked || hasInvalidRow(controller.editingRows)}
              onClick={controller.save}
            >
              {controller.pending && <Loader2 className="size-3.5 animate-spin" />}
              保存
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-state-ledger-action="cancel"
              disabled={controller.pending}
              onClick={controller.cancelEdit}
            >
              取消
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

/** 自加载自刷新的账本区：读计划表快照、驱动编辑态、保存经 updateChapterStateChanges 一次性直调。 */
export function StateChangesLedger({
  projectPath,
  chapter,
  chapterWritten,
  deferTargets = [],
  onChanged,
}: {
  projectPath: string
  chapter: number
  chapterWritten: boolean
  /** 「移到后续章」候选章号：WorkbenchObjectView 按 tocItems 算 → ChapterOutlineCardsView 透传 */
  deferTargets?: number[]
  /** 保存成功后触发上游刷新（章纲 artifacts 重取，md 由主进程按最新 json 重渲） */
  onChanged?: () => void
}) {
  const [snapshot, setSnapshot] = useState<ChapterPlannedStateSnapshot | null>(null)
  const [editingRows, setEditingRows] = useState<DraftRow[] | null>(null)
  const [pending, setPending] = useState(false)
  const [rowActionPending, setRowActionPending] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const activeRun = useAgentStore((state) => Boolean(state.threadsById[state.activeThreadId]?.activeRun))
  const bumpPlannedStateVersion = usePlannedStateRefresh((state) => state.bump)

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    try {
      const result = (await readPlannedState({
        projectPath,
        scope: { kind: 'chapter', chapter },
      })) as ChapterPlannedStateSnapshot
      if (seq === requestSeq.current) setSnapshot(result)
    } catch {
      // 读取失败按不可用处理：整区不渲染，不打扰
      if (seq === requestSeq.current) setSnapshot(null)
    }
  }, [projectPath, chapter])

  useEffect(() => {
    setEditingRows(null)
    setRowActionPending(null)
    void load()
  }, [load])

  /** 「正文已写到」两步路由（spec §3.3）：先补记忆（remove 走 set_current+remove、set/add 走 backfill），
   * 第一步失败第二步绝不发；两步都成功才提示「已兑现并修正记忆」并刷新。 */
  async function confirmDelivered(row: PlannedStateRowDto, eventChapter: number) {
    setRowActionPending(row.id)
    try {
      const memoryWrite =
        row.operation === 'remove'
          ? submitAuthoredState({
              projectPath,
              payload: {
                character_uid: row.characterUid,
                action: 'set_current',
                dimension: row.dimension,
                operation: 'remove',
                value: row.value,
                effective_chapter: eventChapter,
              },
            })
          : submitAuthoredState({
              projectPath,
              payload: {
                character_uid: row.characterUid,
                action: 'backfill',
                dimension: row.dimension,
                value: row.value,
                effective_chapter: eventChapter,
              },
            })
      const memoryResult = await memoryWrite
      if (!memoryResult.ok) {
        // 第一步失败第二步不发（spec §3.2）；remove 值不在当前状态时透传 hint 并建议改用「取消」
        toast.error(memoryResult.message ?? '记忆写入失败')
        return
      }
      const resolveResult = await resolvePlannedState({ projectPath, payload: { id: row.id, action: 'mark_delivered' } })
      if (resolveResult.ok) {
        toast.success('已兑现并修正记忆')
        await load()
        onChanged?.()
        bumpPlannedStateVersion()
      } else {
        // 与 resolveRowAction 同一自愈口径：失败也 reload 刷掉 stale 行。重试安全：backfill 同值同章
        // 走引擎 dup 门幂等通过（skipped），remove 重试 fail-loud，第二步可安全重发。
        toast.error(resolveResult.message ?? '计划落账失败，请重试')
        await load()
      }
    } finally {
      setRowActionPending(null)
    }
  }

  /** defer/cancel/acknowledge 三态迁移共用路由：直调 resolvePlannedState，成功/失败都 reload（自动刷掉
   * 「计划行不存在/已处置」类 stale 行，行为规格 4）。 */
  async function resolveRowAction(
    row: PlannedStateRowDto,
    action: 'defer' | 'cancel' | 'acknowledge',
    options: { toChapter?: number; successMessage: string; errorFallback: string },
  ) {
    setRowActionPending(row.id)
    try {
      const result = await resolvePlannedState({
        projectPath,
        payload: { id: row.id, action, ...(options.toChapter !== undefined ? { to_chapter: options.toChapter } : {}) },
      })
      if (result.ok) {
        toast.success(options.successMessage)
        await load()
        onChanged?.()
        bumpPlannedStateVersion()
      } else {
        toast.error(result.message ?? options.errorFallback)
        await load()
      }
    } finally {
      setRowActionPending(null)
    }
  }

  const defer = (row: PlannedStateRowDto, toChapter: number) =>
    resolveRowAction(row, 'defer', { toChapter, successMessage: '已顺延', errorFallback: '顺延失败，请重试' })
  const cancelPlanned = (row: PlannedStateRowDto) =>
    resolveRowAction(row, 'cancel', { successMessage: '已取消该计划', errorFallback: '取消失败，请重试' })
  const acknowledgePlanned = (row: PlannedStateRowDto) =>
    resolveRowAction(row, 'acknowledge', { successMessage: '已知悉，不再提醒', errorFallback: '操作失败，请重试' })

  if (!snapshot) return null

  const canEdit = !chapterWritten && snapshot.dimensions.length > 0 && snapshot.jsonStateChanges !== null

  const controller: StateChangesLedgerController = {
    editingRows,
    pending,
    saveBlocked: activeRun,
    canEdit,
    startEdit: () =>
      setEditingRows(snapshot.rows.filter((row) => row.status === 'planned').map(rowFromPlanned)),
    cancelEdit: () => setEditingRows(null),
    addRow: () => {
      const firstDim = snapshot.dimensions[0]
      setEditingRows((prev) => [
        ...(prev ?? []),
        {
          tempId: createTempId(),
          characterUid: '',
          characterName: '',
          dimension: firstDim?.key ?? '',
          operation: defaultOperationForDimension(firstDim),
          value: '',
          reason: '',
        },
      ])
    },
    removeRow: (tempId) => setEditingRows((prev) => (prev ?? []).filter((row) => row.tempId !== tempId)),
    updateRow: (tempId, patch) =>
      setEditingRows((prev) => (prev ?? []).map((row) => (row.tempId === tempId ? { ...row, ...patch } : row))),
    save: async () => {
      if (!editingRows) return
      setPending(true)
      try {
        const result = await updateChapterStateChanges({
          projectPath,
          payload: {
            chapter,
            state_changes: toJsonEntries(draftRowsToPlannedRows(chapter, editingRows)),
            expected_state_changes: snapshot.jsonStateChanges ?? [],
          },
        })
        if (result.ok) {
          toast.success('已保存')
          setEditingRows(null)
          await load()
          onChanged?.()
          bumpPlannedStateVersion()
        } else {
          toast.error(result.message ?? '保存失败')
          // CAS 冲突自愈（终审 Fix 2）：snapshot.jsonStateChanges 是保存时的 CAS 基线，失败多半是
          // 已被别处更新导致 expected 过期——不重拉就会一直拿陈旧基线重试、永远撞同一个 CAS 错误。
          // editingRows 是独立 state，重拉不影响草稿（草稿本就不跟 snapshot 双向绑定）。
          await load()
        }
      } catch {
        toast.error('保存失败，请稍后重试。')
      } finally {
        setPending(false)
      }
    },
    deferTargets,
    rowActionPending,
    confirmDelivered,
    defer,
    cancelPlanned,
    acknowledgePlanned,
  }

  return <StateChangesLedgerView snapshot={snapshot} chapterWritten={chapterWritten} controller={controller} />
}
