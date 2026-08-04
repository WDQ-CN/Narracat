import { useState } from 'react'
import { Check, FileText, Loader2, MessageCircleQuestion, MoreHorizontal, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { ArtifactDocumentShell } from './ArtifactDocumentShell'
import { WorkbenchEmptyState } from '../WorkbenchEmptyState'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/cn'
import { GROUP_CLASS, MUTED_PILL_CLASS, READING_BODY_FONT_CLASS, SUCCESS_PILL_CLASS, WARNING_PILL_CLASS } from '@/design-system'
import { submitPremiseFieldEdit } from '@/lib/ipc'
import { isFirstTierField, isSecondTierEvaluableField } from '@shared/lib/premise-field-tier'
import { buildRevisePremiseEvaluationPrompt } from '@/lib/premise-impact-evaluation'
import { ImpactEvaluationDock } from '../ImpactEvaluationDock'
import { Textarea } from '@/components/ui/textarea'
import {
  buildPremiseCardViews,
  formatPremiseOpennessRef,
  renderPremiseCardsMarkdown,
  summarizePremiseOpenness,
  type PremiseCardsData,
  type PremiseCardView,
  type PremiseFieldView,
  type PremiseOpennessSummary,
} from '@/lib/premise-cards'
import type { NovelArtifact, NovelWorkbenchArtifact } from '@shared/types/novel'

/**
 * 立项卡分组列表（ADR-0019 step-2A，#276）：每张实体卡 = 卡标题 + 子列表，每行 = 状态前置 +
 * 标题/内容 + 操作区。状态与行为绑定（不让裸切状态）：
 * - 已定：⋯{重新讨论→AI}
 * - 暂定：⋯{标记为已定→App 直写, 重新讨论→AI}
 * - 未确定：显性「讨论确定」→AI
 * 「标记为已定」(暂定→已定) 是唯一 App 直写（纯信心、内容不变）；内容变更（重新讨论 / 讨论确定）
 * 经现有「交给 Agent」handoff 引导。第 9「留白声明」由各条确定度自动汇总。
 */

interface FieldStatus {
  key: 'canon' | 'tentative' | 'open'
  label: string
  pillClass: string
}

function statusOf(field: PremiseFieldView): FieldStatus {
  if (field.isOpen) return { key: 'open', label: '未确定', pillClass: WARNING_PILL_CLASS }
  if (field.isTentative) return { key: 'tentative', label: '暂定', pillClass: MUTED_PILL_CLASS }
  return { key: 'canon', label: '已定', pillClass: SUCCESS_PILL_CLASS }
}

interface PremiseEditContext {
  /** 提交中条目标识 `cardKey:sourceIndex` */
  pendingId: string | null
  /** 是否具备 App 直写能力（有 projectPath）——决定「标记为已定」/「编辑内容」是否可用 */
  canMark: boolean
  /** 标记为已定（暂定→已定，App 直写）；带上渲染时的 field 做乐观锁 */
  onMarkCanon: (cardKey: string, field: PremiseFieldView) => void
  /** 重新讨论 / 讨论确定 → 交给 Agent 引导（缺 handoff 时为 null） */
  onDiscuss: ((instruction: string) => void) | null
  /** 当前正在编辑的条目标识 `cardKey:sourceIndex`；null = 未进入编辑态 */
  editingId: string | null
  /** 编辑中的草稿文本 */
  draft: string
  setEditingId: (id: string | null) => void
  setDraft: (v: string) => void
  /** 保存内容编辑（edit-content，仅第一档字段） */
  onSaveContent: (cardKey: string, field: PremiseFieldView) => void
  /** 第二档「保存并评估影响」可用时为非 null（缺接线时 null） */
  onEvaluateImpact: ((prompt: string) => void) | null
}

export function PremiseCardsView({
  artifact,
  projectPath,
  onChanged,
  onDiscuss,
  onEvaluateImpact,
}: {
  artifact?: NovelWorkbenchArtifact
  /** 写回所需项目路径；缺失则退化为只读 */
  projectPath?: string
  /** 「标记为已定」写回成功后触发刷新 */
  onChanged?: () => void
  /** 「重新讨论 / 讨论确定」把构造好的指令交给 Agent */
  onDiscuss?: (instruction: string) => void
  /** 第二档「保存并评估影响」：把构造好的 revise-premise prompt 交主面板一键直发 */
  onEvaluateImpact?: (prompt: string) => void
}) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  if (!artifact?.exists) {
    return (
      <WorkbenchEmptyState icon={FileText} title="立项卡尚未生成">
        完成立项对话后，九张立项卡会在这里显示。
      </WorkbenchEmptyState>
    )
  }

  const data = artifact.data as PremiseCardsData | undefined
  const cards = data && typeof data === 'object' ? buildPremiseCardViews(data) : []
  if (cards.length === 0) {
    return (
      <WorkbenchEmptyState icon={FileText} title="立项卡无法显示">
        立项卡数据契约缺失或为空，可重新运行立项对话。
      </WorkbenchEmptyState>
    )
  }

  const content = renderPremiseCardsMarkdown(data)
  const displayArtifact: NovelArtifact = {
    kind: 'outline',
    title: artifact.title,
    path: artifact.path ?? '',
    exists: true,
    content,
  }
  const openness = summarizePremiseOpenness(data)

  async function markCanon(cardKey: string, field: PremiseFieldView) {
    if (!projectPath) return
    const id = `${cardKey}:${field.sourceIndex}`
    setPendingId(id)
    try {
      const result = await submitPremiseFieldEdit({
        kind: 'mark-canon',
        projectPath,
        cardKey,
        fieldIndex: field.sourceIndex,
        certainty: 'canon',
        // 乐观锁：带上渲染时的字段身份，main 读盘后不符（Agent 改过）即拒绝并提示刷新
        expectedKey: field.key,
        expectedValue: field.value,
        expectedCertainty: field.isOpen ? 'open' : field.isTentative ? 'tentative' : 'canon',
      })
      if (result.ok) {
        toast.success('已标记为已定')
        onChanged?.()
      } else {
        toast.error(result.message ?? '更新失败')
      }
    } catch (error) {
      console.error(error)
      toast.error('更新失败')
    } finally {
      setPendingId(null)
    }
  }

  async function saveContent(cardKey: string, field: PremiseFieldView) {
    if (!projectPath) return
    const id = `${cardKey}:${field.sourceIndex}`
    setPendingId(id)
    try {
      const result = await submitPremiseFieldEdit({
        kind: 'edit-content',
        projectPath,
        cardKey,
        fieldIndex: field.sourceIndex,
        newValue: draft,
        expectedKey: field.key,
        expectedValue: field.value,
        expectedCertainty: field.isOpen ? 'open' : field.isTentative ? 'tentative' : 'canon',
      })
      if (result.ok) {
        toast.success('已保存')
        setEditingId(null)
        onChanged?.()
      } else {
        toast.error(result.message ?? '保存失败')
      }
    } catch (error) {
      console.error(error)
      toast.error('保存失败')
    } finally {
      setPendingId(null)
    }
  }

  const editingField = findEditingField(cards, editingId)
  const draftValue = draft.trim()
  const showImpactBar =
    Boolean(onEvaluateImpact) &&
    editingField !== null &&
    isSecondTierEvaluableField(editingField.cardKey, editingField.field.key) &&
    draftValue.length > 0 &&
    draftValue !== editingField.field.value.trim()

  function evaluateImpact() {
    if (!onEvaluateImpact || !editingField) return
    onEvaluateImpact(
      buildRevisePremiseEvaluationPrompt({
        cardTitle: editingField.cardTitle,
        fieldLabel: editingField.fieldLabel,
        oldValue: editingField.field.value,
        newValue: draft.trim(),
      }),
    )
    setEditingId(null)
    setDraft('')
  }

  const edit: PremiseEditContext = {
    pendingId,
    canMark: Boolean(projectPath),
    onMarkCanon: markCanon,
    onDiscuss: onDiscuss ?? null,
    editingId,
    draft,
    setEditingId,
    setDraft,
    onSaveContent: saveContent,
    onEvaluateImpact: onEvaluateImpact ?? null,
  }

  return (
    <>
      <ArtifactDocumentShell artifact={displayArtifact} title={artifact.title}>
        <div data-premise-cards="true">
          {/* 与其他设定页（markdown H1）一致的页内标题。 */}
          <h1 className="mb-6 text-xl font-semibold leading-tight text-foreground">{artifact.title}</h1>
          <div className="flex flex-col gap-7">
            {cards.map((card) => (
              <PremiseCard key={card.key} card={card} edit={edit} />
            ))}
            <PremiseOpennessCard openness={openness} />
          </div>
        </div>
      </ArtifactDocumentShell>
      {/* 第二档评估 dock 放在阅读画布之外：浮出 820 居中阅读列、贴内容面板底部上提，避免被阅读列宽度剪切（dogfood 反馈）。
          用通用 ImpactEvaluationDock（不显示具体改动内容，具体改动随 evaluateImpact 的 prompt 发给 Agent）。 */}
      {showImpactBar && editingField && <ImpactEvaluationDock onEvaluate={evaluateImpact} />}
    </>
  )
}

/** 由 editingId（`cardKey:sourceIndex`）在卡视图里定位编辑中的卡·字段，供底部评估栏取摘要/旧值。 */
function findEditingField(cards: PremiseCardView[], editingId: string | null) {
  if (!editingId) return null
  const sep = editingId.lastIndexOf(':')
  if (sep < 0) return null
  const cardKey = editingId.slice(0, sep)
  const sourceIndex = Number(editingId.slice(sep + 1))
  const card = cards.find((entry) => entry.key === cardKey)
  const field = card?.fields.find((entry) => entry.sourceIndex === sourceIndex)
  if (!card || !field) return null
  return { cardKey, cardTitle: card.title, fieldLabel: field.label, field }
}

function PremiseCard({ card, edit }: { card: PremiseCardView; edit: PremiseEditContext }) {
  // Settings 列表语言：卡标题在列表卡片外（上方），列表集为圆角分组容器（GROUP_CLASS），行级 hover。
  return (
    <section className="space-y-2" data-premise-card={card.key}>
      <h3 className="px-1 text-sm font-semibold text-foreground">{card.title}</h3>
      <dl className={GROUP_CLASS}>
        {card.fields.map((field) => (
          <PremiseFieldRow key={field.sourceIndex} cardKey={card.key} cardTitle={card.title} field={field} edit={edit} />
        ))}
      </dl>
    </section>
  )
}

function PremiseFieldRow({
  cardKey,
  cardTitle,
  field,
  edit,
}: {
  cardKey: string
  cardTitle: string
  field: PremiseFieldView
  edit: PremiseEditContext
}) {
  const status = statusOf(field)
  const noteText = field.note ? (cardKey === 'world_rules' ? ` —— ${field.note}` : `（${field.note}）`) : ''
  const fieldLabel = field.label || cardTitle
  const id = `${cardKey}:${field.sourceIndex}`
  const pending = edit.pendingId === id
  const isFirstTier = isFirstTierField(cardKey, field.key)
  const canEvaluate = isSecondTierEvaluableField(cardKey, field.key) && edit.canMark && Boolean(edit.onEvaluateImpact)
  const isEditing = (isFirstTier || canEvaluate) && edit.editingId === id

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-hover',
        field.isOpen && 'bg-warning/5',
      )}
      data-premise-field={status.key}
      data-premise-field-open={field.isOpen ? 'true' : undefined}
      data-premise-editable={isFirstTier && edit.canMark ? 'true' : undefined}
      data-premise-evaluable={canEvaluate ? 'true' : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn(status.pillClass, 'shrink-0')} data-premise-field-status={status.key}>
            {status.label}
          </span>
          {field.label && <dt className="min-w-0 truncate text-xs font-medium text-muted-foreground">{field.label}</dt>}
        </div>
        {isEditing ? (
          <div className="mt-1 flex flex-col gap-2">
            <Textarea
              value={edit.draft}
              onChange={(e) => edit.setDraft(e.target.value)}
              autoFocus
              rows={3}
              className={`${READING_BODY_FONT_CLASS} leading-6`}
            />
            <div className="flex gap-2">
              {isFirstTier && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => edit.onSaveContent(cardKey, field)}
                  disabled={pending}
                >
                  {pending && <Loader2 className="size-3.5 animate-spin" />}
                  保存
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => edit.setEditingId(null)}
                disabled={pending}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <dd
            className={cn(
              `mt-1 ${READING_BODY_FONT_CLASS} leading-6 [overflow-wrap:anywhere]`,
              field.isOpen ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {field.value}
            {noteText && <span className="text-muted-foreground">{noteText}</span>}
          </dd>
        )}
      </div>
      {isEditing ? null : (
        <FieldActions
          cardTitle={cardTitle}
          fieldLabel={fieldLabel}
          field={field}
          pending={pending}
          edit={edit}
          isFirstTier={isFirstTier}
          canEvaluate={canEvaluate}
          onMarkCanon={() => edit.onMarkCanon(cardKey, field)}
          onEdit={() => {
            edit.setEditingId(id)
            edit.setDraft(field.value)
          }}
        />
      )}
    </div>
  )
}

function FieldActions({
  cardTitle,
  fieldLabel,
  field,
  pending,
  edit,
  isFirstTier,
  canEvaluate,
  onMarkCanon,
  onEdit,
}: {
  cardTitle: string
  fieldLabel: string
  field: PremiseFieldView
  pending: boolean
  edit: PremiseEditContext
  isFirstTier: boolean
  canEvaluate: boolean
  onMarkCanon: () => void
  onEdit: () => void
}) {
  const ref = `${cardTitle}·${fieldLabel}`

  // 未确定：显性「讨论确定」主召唤（→AI）
  if (field.isOpen) {
    if (!edit.onDiscuss) return null
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0"
        data-premise-discuss="settle"
        onClick={() => edit.onDiscuss?.(`请引导我确定立项卡「${ref}」——这一点目前未确定，请逐步帮我定下来。`)}
      >
        <MessageCircleQuestion className="size-3.5" />
        讨论确定
      </Button>
    )
  }

  // 已定 / 暂定 / 第一档 / 第二档：操作收进 ⋯ 菜单
  const canMarkCanon = field.isTentative && edit.canMark
  const canEdit = (isFirstTier && edit.canMark) || canEvaluate // 第一档直改 + 第二档评估，共用「编辑」入口
  if (!edit.onDiscuss && !canMarkCanon && !canEdit) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="shrink-0 rounded-row p-1 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          data-premise-field-menu="true"
          aria-label="更多操作"
          disabled={pending}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit && (
          <DropdownMenuItem data-premise-action="edit" onSelect={() => onEdit()}>
            <Pencil className="size-3.5" />
            编辑
          </DropdownMenuItem>
        )}
        {canMarkCanon && (
          <DropdownMenuItem data-premise-action="mark-canon" onSelect={() => onMarkCanon()}>
            <Check className="size-3.5" />
            标记为已定
          </DropdownMenuItem>
        )}
        {edit.onDiscuss && (
          <DropdownMenuItem
            data-premise-action="rediscuss"
            onSelect={() =>
              edit.onDiscuss?.(`请引导我重新讨论立项卡「${ref}」，当前内容：${field.value}。改动可能牵动已写章节，请先评估影响再调整。`)
            }
          >
            <MessageCircleQuestion className="size-3.5" />
            重新讨论
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PremiseOpennessCard({ openness }: { openness: PremiseOpennessSummary }) {
  const empty = openness.tentative.length === 0 && openness.open.length === 0

  return (
    <section className="space-y-2" data-premise-card="openness">
      <h3 className="px-1 text-sm font-semibold text-foreground">
        <span className="mr-1.5 text-muted-foreground tabular">9</span>
        留白声明
      </h3>
      <div className="rounded-row border border-border bg-surface px-3 py-3">
        {empty ? (
          <p className="text-sm text-muted-foreground" data-premise-openness-empty="true">
            九卡均已定，暂无暂定或未确定项。
          </p>
        ) : (
          <dl className="flex flex-col gap-2 text-sm">
            {openness.tentative.length > 0 && (
              <div>
                <dt className="text-xs text-muted-foreground">暂定</dt>
                <dd className="mt-0.5 text-foreground">
                  {openness.tentative.map(formatPremiseOpennessRef).join('、')}
                </dd>
              </div>
            )}
            {openness.open.length > 0 && (
              <div>
                <dt className="text-xs text-muted-foreground">未确定</dt>
                <dd className="mt-0.5 text-foreground">{openness.open.map(formatPremiseOpennessRef).join('、')}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </section>
  )
}
