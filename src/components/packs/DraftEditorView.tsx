import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownRenderer } from '@/components/workbench/MarkdownRenderer'
import { EMPTY_PRIMARY_BODY_CLASS, GROUP_CLASS, MUTED_PILL_CLASS, ROW_CLASS, WARNING_PILL_CLASS } from '@/design-system'
import { cn } from '@/lib/cn'
import { SEMVER_RE, type DraftCard, type PackDraftMeta } from '@shared/types/capability-pack'
import type { DraftPublishLintFinding } from '@shared/types/ipc'
import { CARD_TYPE_LABELS } from './pack-card-labels'
import { DraftCardForm } from './DraftCardForm'

const FIELD_LABEL_CLASS = 'text-xs font-medium leading-5 text-muted-foreground'
const SMALL_TOGGLE_OPTION_CLASS =
  'flex h-6 items-center justify-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:text-foreground data-[active=true]:bg-workspace data-[active=true]:text-foreground data-[active=true]:shadow-[var(--shadow-workspace)]'

/** 防抖自动保存等待时长（ms）：与立项卡 draft state 先例同量级，键入停顿即保存。 */
const AUTOSAVE_DEBOUNCE_MS = 800

type LoadState = 'loading' | 'loaded' | 'not-found' | 'error'
type ReadmeMode = 'edit' | 'preview'
/** 待落盘的字段变更：`cardsDirty` 而非直接存数组快照——flush 时永远读 `cardsRef` 取当下最新值，
 * 避免「防抖窗口内卡片被其它路径（如编译成功回写）更新后，旧快照把新值覆盖回去」的静默丢字。 */
type PendingDraftPatch = { meta?: Partial<PackDraftMeta>; cardsDirty?: boolean; readme?: string }

/** 发布默认版本：已发布过按 minor 递增（0.1.0→0.2.0），否则回落首发版本。 */
function nextDraftVersion(lastPublishedVersion: string | null): string {
  const match = lastPublishedVersion ? /^(\d+)\.(\d+)\.(\d+)/.exec(lastPublishedVersion) : null
  if (!match) return '0.1.0'
  return `${match[1]}.${Number(match[2]) + 1}.0`
}

function newDraftCard(type: DraftCard['type']): DraftCard {
  return { cardId: crypto.randomUUID(), type, name: '', oneLine: '', body: '', intent: '', compiled: null }
}

/**
 * 造包中心编辑器（B2 刀3 Task 12）：顶部包信息（名称/一句话/作者/README）+ 左卡列表（三选一添加）
 * + 右侧 `DraftCardForm` + 底部发布区。保存策略：`updatePackDraft` 防抖 800ms 自动保存 + 失焦立即
 * 保存（同 `PremiseCardsView` 的 draft state 先例）；新建/删除卡属结构性变更，立即落盘不等防抖。
 * 返回入口在设置页 titlebar 面包屑（导航规范 §9.8），本视图不放返回按钮。
 */
export function DraftEditorView({
  draftId,
  onPublished,
  onOpenGuide,
}: {
  draftId: string
  onPublished?: () => void
  /** 打开制作指南（父层 setSub('guide')）；小白在编辑器里卡住时的就近帮助入口。 */
  onOpenGuide?: () => void
}) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [meta, setMeta] = useState<PackDraftMeta | null>(null)
  const [cards, setCards] = useState<DraftCard[]>([])
  const [readme, setReadme] = useState('')
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [readmeMode, setReadmeMode] = useState<ReadmeMode>('edit')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmingCardId, setConfirmingCardId] = useState<string | null>(null)

  const [versionInput, setVersionInput] = useState('0.1.0')
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishErrors, setPublishErrors] = useState<string[] | null>(null)
  const [publishLintFindings, setPublishLintFindings] = useState<Array<{ cardId: string; findings: DraftPublishLintFinding[] }>>([])
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false)
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null)

  // 防抖保存基建：pending patch 合并进 ref，800ms 静默期或失焦（flushSave）时落盘。
  // cardsRef 与 cards state 同步保持最新（每次 setCards 的调用点同步写入，不经 useEffect 那一拍延迟），
  // flush 时永远从这里取值，而不是 schedule 当时捕获的数组快照。
  const pendingPatchRef = useRef<PendingDraftPatch>({})
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardsRef = useRef<DraftCard[]>([])

  function setCardsTracked(next: DraftCard[]) {
    cardsRef.current = next
    setCards(next)
  }

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const pending = pendingPatchRef.current
    if (!pending.meta && !pending.cardsDirty && pending.readme === undefined) return
    pendingPatchRef.current = {}
    const patch: { meta?: Partial<PackDraftMeta>; cards?: DraftCard[]; readme?: string } = {}
    if (pending.meta) patch.meta = pending.meta
    if (pending.cardsDirty) patch.cards = cardsRef.current
    if (pending.readme !== undefined) patch.readme = pending.readme
    try {
      await window.electron.updatePackDraft({ draftId, patch })
      setSaveError(null)
    } catch {
      setSaveError('保存失败，请重试。')
    }
  }, [draftId])

  const scheduleSave = useCallback(
    (patch: PendingDraftPatch) => {
      pendingPatchRef.current = {
        meta: patch.meta ? { ...pendingPatchRef.current.meta, ...patch.meta } : pendingPatchRef.current.meta,
        cardsDirty: pendingPatchRef.current.cardsDirty || patch.cardsDirty,
        readme: patch.readme !== undefined ? patch.readme : pendingPatchRef.current.readme,
      }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        void flushSave()
      }, AUTOSAVE_DEBOUNCE_MS)
    },
    [flushSave],
  )

  // 组件卸载 / 切换草稿前把尚未落盘的编辑冲掉，避免静默丢字。
  useEffect(() => {
    return () => {
      void flushSave()
    }
  }, [flushSave])

  useEffect(() => {
    let alive = true
    setLoadState('loading')
    window.electron
      .getPackDraft({ draftId })
      .then((result) => {
        if (!alive) return
        if (!result) {
          setLoadState('not-found')
          return
        }
        setMeta(result.meta)
        setCardsTracked(result.cards)
        setReadme(result.readme)
        setSelectedCardId(result.cards[0]?.cardId ?? null)
        setVersionInput(nextDraftVersion(result.meta.lastPublishedVersion))
        setLoadState('loaded')
      })
      .catch(() => {
        if (alive) setLoadState('error')
      })
    return () => {
      alive = false
    }
  }, [draftId])

  function updateMeta(patch: Partial<PackDraftMeta>) {
    setMeta((prev) => (prev ? { ...prev, ...patch } : prev))
    scheduleSave({ meta: patch })
  }

  function updateReadme(value: string) {
    setReadme(value)
    scheduleSave({ readme: value })
  }

  function updateCard(cardId: string, patch: Partial<DraftCard>) {
    const next = cards.map((card) => (card.cardId === cardId ? { ...card, ...patch } : card))
    setCardsTracked(next)
    scheduleSave({ cardsDirty: true })
  }

  async function persistCardsNow(next: DraftCard[]) {
    setCardsTracked(next)
    scheduleSave({ cardsDirty: true })
    await flushSave()
  }

  async function handleAddCard(type: DraftCard['type']) {
    const card = newDraftCard(type)
    setSelectedCardId(card.cardId)
    await persistCardsNow([...cards, card])
  }

  async function handleConfirmDelete(cardId: string) {
    const next = cards.filter((card) => card.cardId !== cardId)
    setConfirmingCardId(null)
    if (selectedCardId === cardId) setSelectedCardId(next[0]?.cardId ?? null)
    await persistCardsNow(next)
  }

  const handleCompileCard = useCallback(
    async (cardId: string) => {
      await flushSave() // 确保最新意图已落盘，引擎编译读的是磁盘上的草稿
      const result = await window.electron.compileDraftCard({ draftId, cardId })
      if (result.status === 'ok') {
        // 编译结果已由主进程直接持久化（writeCompiledCard），这里只同步渲染端本地状态；
        // 用 cardsRef 兜底写入，防止后续防抖 flush 用过期快照把这次编译结果覆盖掉。
        const next = cardsRef.current.map((card) => (card.cardId === cardId ? { ...card, compiled: result.compiled } : card))
        setCardsTracked(next)
      }
      return result
    },
    [draftId, flushSave],
  )

  const handlePreviewCard = useCallback(
    async (cardId: string) => {
      await flushSave()
      return window.electron.previewDraftCard({ draftId, cardId })
    },
    [draftId, flushSave],
  )

  async function handlePublish() {
    if (publishBusy || !meta || cards.length === 0) return
    const version = versionInput.trim()
    if (!SEMVER_RE.test(version)) {
      setPublishSuccess(null)
      setPublishErrors(['版本号格式不对，请填写类似 0.1.0 的写法。'])
      setPublishLintFindings([])
      return
    }
    await flushSave()
    setPublishBusy(true)
    setPublishErrors(null)
    setPublishLintFindings([])
    setPublishSuccess(null)
    try {
      const result = await window.electron.publishPackDraft({ draftId, version, acknowledgeWarnings })
      if (result.status === 'ok') {
        setPublishSuccess(`已发布 ${result.summary.version}，可在能力包库启用。`)
        setMeta((prev) =>
          prev ? { ...prev, lastPublishedVersion: result.summary.version, packId: prev.packId ?? result.summary.id } : prev,
        )
        setVersionInput(nextDraftVersion(result.summary.version))
        setAcknowledgeWarnings(false)
        onPublished?.()
      } else {
        setPublishErrors(result.errors)
        setPublishLintFindings(result.lintFindings)
      }
    } catch {
      setPublishErrors(['发布失败，请重试。'])
    } finally {
      setPublishBusy(false)
    }
  }

  if (loadState === 'loading') {
    return (
      <section className="space-y-4" data-pack-draft-editor={draftId}>
        <p className="text-xs leading-5 text-muted-foreground">加载中…</p>
      </section>
    )
  }
  if (loadState === 'not-found' || loadState === 'error' || !meta) {
    return (
      <section className="space-y-4" data-pack-draft-editor={draftId}>
        <p className="text-xs leading-5 text-destructive">
          {loadState === 'not-found' ? '找不到这份创作草稿，可能已被删除。' : '加载失败，请重试。'}
        </p>
      </section>
    )
  }

  const selectedCard = cards.find((card) => card.cardId === selectedCardId) ?? null
  const hasBlockingFindings = publishLintFindings.some((entry) => entry.findings.some((f) => f.severity === 'block'))
  const hasWarnFindings = publishLintFindings.some((entry) => entry.findings.some((f) => f.severity === 'warn'))
  const canAcknowledgeWarnings = hasWarnFindings && !hasBlockingFindings

  return (
    <section className="space-y-4" data-pack-draft-editor={draftId}>
      {onOpenGuide ? (
        <button
          type="button"
          onClick={onOpenGuide}
          className="text-xs leading-5 text-muted-foreground transition-colors duration-200 hover:text-foreground"
          data-draft-open-guide="true"
        >
          第一次做能力包？把你的写作诀窍讲清楚就行 · 看制作指南 →
        </button>
      ) : null}

      <div className="space-y-3 rounded-row border border-border bg-surface p-4" data-draft-pack-info="true">
        {meta.localSource === 'learned-own' || meta.localSource === 'learned-external' ? (
          <span
            className={meta.localSource === 'learned-external' ? WARNING_PILL_CLASS : MUTED_PILL_CLASS}
            data-draft-provenance-badge={meta.localSource}
          >
            {meta.localSource === 'learned-external'
              ? '学自外部书 · 仅本机使用，不可导出'
              : `学自《${meta.learnedFrom?.title ?? ''}》`}
          </span>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className={FIELD_LABEL_CLASS} htmlFor="draft-meta-name">
              包名
            </label>
            <Input
              id="draft-meta-name"
              value={meta.name}
              placeholder="例：我的写作习惯"
              onChange={(event) => updateMeta({ name: event.target.value })}
              onBlur={() => void flushSave()}
            />
          </div>
          <div className="space-y-1.5">
            <label className={FIELD_LABEL_CLASS} htmlFor="draft-meta-author">
              作者
            </label>
            <Input
              id="draft-meta-author"
              value={meta.author}
              placeholder="你的署名"
              onChange={(event) => updateMeta({ author: event.target.value })}
              onBlur={() => void flushSave()}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className={FIELD_LABEL_CLASS} htmlFor="draft-meta-description">
            一句话简介
          </label>
          <Input
            id="draft-meta-description"
            value={meta.description}
            onChange={(event) => updateMeta({ description: event.target.value })}
            onBlur={() => void flushSave()}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className={FIELD_LABEL_CLASS}>说明（README）</label>
            <div className="flex items-center gap-0.5 rounded-row bg-active p-0.5">
              <button
                type="button"
                data-active={readmeMode === 'edit'}
                aria-pressed={readmeMode === 'edit'}
                className={SMALL_TOGGLE_OPTION_CLASS}
                onClick={() => setReadmeMode('edit')}
              >
                编辑
              </button>
              <button
                type="button"
                data-active={readmeMode === 'preview'}
                aria-pressed={readmeMode === 'preview'}
                className={SMALL_TOGGLE_OPTION_CLASS}
                onClick={() => setReadmeMode('preview')}
              >
                预览
              </button>
            </div>
          </div>
          {readmeMode === 'edit' ? (
            <Textarea
              value={readme}
              rows={6}
              className="text-sm leading-6"
              onChange={(event) => updateReadme(event.target.value)}
              onBlur={() => void flushSave()}
            />
          ) : (
            <div className="rounded-row border border-border bg-surface px-3 py-2.5" data-draft-readme-preview="true">
              {readme.trim() ? (
                <MarkdownRenderer text={readme} variant="document" />
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">还没有写说明。</p>
              )}
            </div>
          )}
        </div>
        {saveError && (
          <p className="text-xs leading-5 text-destructive" data-draft-save-error="true">
            {saveError}
          </p>
        )}
      </div>

      <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4">
        <div className="space-y-2" data-draft-card-list="true">
          <div className="flex items-center justify-between">
            <span className={FIELD_LABEL_CLASS}>卡片</span>
            <DropdownMenu>
              <IconTooltip label="添加卡">
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="添加卡" data-draft-add-card-trigger="true">
                    <Plus className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </IconTooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-draft-add-card="persona" onSelect={() => void handleAddCard('persona')}>
                  角色/叙述的腔调
                </DropdownMenuItem>
                <DropdownMenuItem data-draft-add-card="craft" onSelect={() => void handleAddCard('craft')}>
                  具体写法技巧
                </DropdownMenuItem>
                <DropdownMenuItem data-draft-add-card="structure" onSelect={() => void handleAddCard('structure')}>
                  剧情编排方法
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {cards.length === 0 ? (
            <div className="rounded-row border border-dashed border-border px-3 py-6 text-center" data-draft-card-list-empty="true">
              <p className={EMPTY_PRIMARY_BODY_CLASS}>还没有卡片，先加一张。</p>
            </div>
          ) : (
            <div className={GROUP_CLASS}>
              {cards.map((card) => (
                <div
                  key={card.cardId}
                  className={cn('flex items-center gap-1 px-2.5 py-2', ROW_CLASS)}
                  data-active={card.cardId === selectedCardId}
                  data-draft-card-row={card.cardId}
                >
                  {confirmingCardId === card.cardId ? (
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">删除这张卡？</span>
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="ghost" size="xs" onClick={() => setConfirmingCardId(null)}>
                          取消
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="xs"
                          data-draft-delete-confirm={card.cardId}
                          onClick={() => void handleConfirmDelete(card.cardId)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        data-draft-card-select={card.cardId}
                        onClick={() => setSelectedCardId(card.cardId)}
                      >
                        <span className={MUTED_PILL_CLASS}>{CARD_TYPE_LABELS[card.type]}</span>
                        <div className="mt-1 truncate text-sm leading-tight text-foreground">{card.name || '未命名卡'}</div>
                      </button>
                      <IconTooltip label="删除">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label="删除"
                          data-draft-delete-request={card.cardId}
                          onClick={() => setConfirmingCardId(card.cardId)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </IconTooltip>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-row border border-border bg-surface p-4">
          {selectedCard ? (
            <DraftCardForm
              key={selectedCard.cardId}
              card={selectedCard}
              onChange={(patch) => updateCard(selectedCard.cardId, patch)}
              onBlur={() => void flushSave()}
              onCompile={() => handleCompileCard(selectedCard.cardId)}
              onPreview={() => handlePreviewCard(selectedCard.cardId)}
            />
          ) : (
            <p className="text-xs leading-5 text-muted-foreground" data-draft-card-form-empty="true">
              选一张卡开始编辑，或先添加一张。
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-row border border-border bg-surface p-4" data-draft-publish="true">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium leading-tight text-foreground">发布</p>
            <p className="text-xs leading-5 text-muted-foreground">
              {meta.lastPublishedVersion ? `当前已发布 v${meta.lastPublishedVersion}` : '还没有发布过'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="w-28"
              value={versionInput}
              onChange={(event) => setVersionInput(event.target.value)}
              data-draft-version-input="true"
            />
            <Button
              type="button"
              disabled={publishBusy || cards.length === 0}
              data-draft-publish-trigger="true"
              onClick={() => void handlePublish()}
            >
              {publishBusy && <Loader2 className="size-3.5 animate-spin" />}
              发布
            </Button>
          </div>
        </div>

        {cards.length === 0 && (
          <p className="text-xs leading-5 text-muted-foreground" data-draft-publish-empty-hint="true">
            先添加一张卡片再发布。
          </p>
        )}

        {publishSuccess && (
          <p className="text-sm leading-6 text-success" data-draft-publish-success="true">
            {publishSuccess}
          </p>
        )}

        {publishErrors && publishErrors.length > 0 && (
          <div className="space-y-2" data-draft-publish-errors="true">
            {publishErrors.map((message, index) => (
              <p key={index} className="text-xs leading-5 text-destructive">
                {message}
              </p>
            ))}
            {publishLintFindings.flatMap((entry) => {
              const cardName = cards.find((card) => card.cardId === entry.cardId)?.name || '未命名卡'
              return entry.findings.map((finding, index) => (
                <div
                  key={`${entry.cardId}-${index}`}
                  className="rounded-row border border-border bg-surface px-3 py-2 text-xs leading-5 text-muted-foreground"
                >
                  「{cardName}」第 {finding.line} 行：{finding.excerpt}
                  {finding.severity === 'warn' && <span className="ml-1.5 text-warning">（确认后仍可发布）</span>}
                </div>
              ))
            })}
            {canAcknowledgeWarnings && (
              <label className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
                <Switch checked={acknowledgeWarnings} onCheckedChange={setAcknowledgeWarnings} />
                我已确认，仍要发布
              </label>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
