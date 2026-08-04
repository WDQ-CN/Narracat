import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ChapterPreview } from './ChapterPreview'
import { ManuscriptEditorView } from './ManuscriptEditorView'
import { ManuscriptRevisionSheet } from './ManuscriptRevisionSheet'
import { ImpactEvaluationDock } from '../ImpactEvaluationDock'
import type { MarkdownSelectionHandoff } from './ArtifactDocumentShell'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { WORKBENCH_READING_CANVAS_CLASS } from '@/design-system'
import {
  discardManuscriptDraft,
  getManuscriptDraft,
  saveChapterManuscript,
  saveManuscriptDraft,
} from '@/lib/ipc'
import { extractChapterMetadata } from '@/lib/workbench-copy-document'
import { buildSyncChapterMemoryPrompt } from '@/lib/manuscript-impact-evaluation'
import {
  cancelPendingManuscriptLeave,
  confirmLeaveManuscriptEditor,
  resolveManuscriptLeave,
  useManuscriptEditorGuard,
} from '@/lib/manuscript-editor-guard'
import { usePendingMemorySyncMap } from '@/lib/use-pending-memory-sync'
import type { NovelArtifact } from '@shared/types/novel'
import type { ManuscriptDraftState } from '@shared/types/manuscript-draft'

/**
 * 章节正文视图（ADR-0031）：阅读态（ChapterPreview）+ 沉浸整章编辑态 + 保存后分诊浮出
 * ImpactEvaluationDock + 「记忆待同步」横条。保存永远先落盘；dock/横条只是同步记忆入口。
 *
 * 编辑入口 / 保存 / 取消 / 同步本章记忆均不在内容区放按钮，统一收进 titlebar 动作区
 * （见 WorkbenchStage）；本组件只把可执行的回调注册进 manuscript-editor-guard store，
 * 由 WorkbenchStage 的 handleClientAction 分派调用。
 */
export function ChapterManuscriptView({
  artifact,
  projectPath,
  chapter,
  agentBusy,
  selectionHandoff,
  leadingContent,
  onChanged,
  onEvaluateManuscriptImpact,
}: {
  artifact?: NovelArtifact
  projectPath: string
  chapter: number
  agentBusy: boolean
  selectionHandoff?: MarkdownSelectionHandoff | null
  leadingContent?: ReactNode
  onChanged?: () => void
  onEvaluateManuscriptImpact?: (input: { prompt: string; chapter: number }) => void
}) {
  const [baseText, setBaseText] = useState('')
  const [draft, setDraft] = useState('')
  const [impactReasons, setImpactReasons] = useState<string[] | null>(null)
  const [draftConflict, setDraftConflict] = useState<Extract<ManuscriptDraftState, { status: 'conflict' }> | null>(
    null,
  )
  const [saveCount, setSaveCount] = useState(0)
  const [revisionHistoryOpen, setRevisionHistoryOpen] = useState(false)
  const draftRef = useRef(draft)
  const baseTextRef = useRef(baseText)
  const hydratedDraftKeyRef = useRef('')
  const editing = useManuscriptEditorGuard((state) => state.editing)
  const saving = useManuscriptEditorGuard((state) => state.saving)
  const setEditing = useManuscriptEditorGuard((state) => state.setEditing)
  const setSaving = useManuscriptEditorGuard((state) => state.setSaving)
  const setDirty = useManuscriptEditorGuard((state) => state.setDirty)
  const bumpSaveVersion = useManuscriptEditorGuard((state) => state.bumpSaveVersion)
  const bumpDraftVersion = useManuscriptEditorGuard((state) => state.bumpDraftVersion)
  const registerHandlers = useManuscriptEditorGuard((state) => state.registerHandlers)
  const clearHandlers = useManuscriptEditorGuard((state) => state.clearHandlers)
  const leaveDialogOpen = useManuscriptEditorGuard((state) => state.leaveDialogOpen)
  const leaveResolving = useManuscriptEditorGuard((state) => state.leaveResolving)

  const pendingMap = usePendingMemorySyncMap(projectPath, `${agentBusy}:${saveCount}`)
  const pending = pendingMap[String(chapter)]

  const visibleText = extractChapterMetadata(artifact?.content ?? '').content
  const dirty = editing && draft !== baseText
  draftRef.current = draft
  baseTextRef.current = baseText

  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  useEffect(() => {
    if (!artifact) return
    const hydrationKey = `${projectPath}\u0000${chapter}\u0000${artifact.path}`
    if (hydratedDraftKeyRef.current === hydrationKey) return
    hydratedDraftKeyRef.current = hydrationKey
    let cancelled = false

    getManuscriptDraft({ projectPath, chapter })
      .then((state) => {
        if (cancelled) return
        if (state.status === 'recoverable') {
          setBaseText(state.diskText)
          setDraft(state.draftText)
          setDraftConflict(null)
          setImpactReasons(null)
          setEditing(true)
          toast.info('已恢复未保存的正文草稿')
          return
        }
        if (state.status === 'conflict') {
          setDraftConflict(state)
          return
        }
        if (state.status === 'corrupt') {
          toast.error(`正文恢复草稿已损坏，已隔离（错误编号：${state.errorId}）`)
          bumpDraftVersion()
          return
        }
        bumpDraftVersion()
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) toast.error('读取正文恢复草稿失败')
      })

    return () => {
      cancelled = true
    }
  }, [artifact, projectPath, chapter, visibleText, setEditing, bumpDraftVersion])

  async function persistDraft(): Promise<boolean> {
    try {
      await saveManuscriptDraft({
        projectPath,
        chapter,
        baseVisibleText: baseTextRef.current,
        draftText: draftRef.current,
      })
      bumpDraftVersion()
      return true
    } catch (error) {
      console.error(error)
      toast.error('恢复草稿保存失败，请重试')
      return false
    }
  }

  async function discardDraft(): Promise<boolean> {
    try {
      await discardManuscriptDraft({ projectPath, chapter })
      bumpDraftVersion()
      return true
    } catch (error) {
      console.error(error)
      toast.error('放弃恢复草稿失败，请重试')
      return false
    }
  }

  useEffect(() => {
    if (!dirty) return
    const timeout = window.setTimeout(() => {
      void persistDraft()
    }, 800)
    return () => window.clearTimeout(timeout)
    // persistDraft 始终通过 ref 读取最新文本；避免函数引用令 debounce 失效。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, draft, baseText, projectPath, chapter])

  function startEdit() {
    // staging 只读预览（刀 3 §4.6）：写作中断的草稿不进正文编辑器，即便某条入口漏了门也在
    // 这里兜底——与 workbench-actions.ts 的 hasReadyManuscript 口径对齐（exists && !isDraft）。
    if (artifact?.isDraft) return
    setBaseText(visibleText)
    setDraft(visibleText)
    setImpactReasons(null)
    setEditing(true)
  }

  async function cancelEdit() {
    if (dirty && !(await confirmLeaveManuscriptEditor())) return
    setEditing(false)
    setDirty(false)
  }

  async function save() {
    if (!draft.trim()) {
      toast.error('正文不能为空')
      return
    }
    if (draft === baseText) return
    setSaving(true)
    try {
      const result = await saveChapterManuscript({
        projectPath,
        chapter,
        expectedVisibleText: baseText,
        newVisibleText: draft,
      })
      if (result.ok) {
        toast.success('已保存')
        setEditing(false)
        setDirty(false)
        setSaveCount((count) => count + 1)
        bumpSaveVersion()
        bumpDraftVersion()
        if (result.triage.tier === 'impact') setImpactReasons(result.triage.reasons)
        onChanged?.()
      } else {
        toast.error(result.message)
      }
    } catch (error) {
      console.error(error)
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  function evaluate(reasons: string[]) {
    onEvaluateManuscriptImpact?.({ prompt: buildSyncChapterMemoryPrompt({ chapter, reasons }), chapter })
    setImpactReasons(null)
  }

  function handleRevisionRestored() {
    setSaveCount((count) => count + 1)
    bumpSaveVersion()
    bumpDraftVersion()
    onChanged?.()
  }

  // titlebar 上的编辑/保存/取消/同步本章记忆按钮经 WorkbenchStage 分派到这里注册的回调；
  // 用 ref 持有最新闭包，注册函数本身保持稳定引用，避免每次渲染都重新写 store。
  const latestRef = useRef({
    startEdit,
    save,
    cancelEdit,
    evaluate: () => evaluate(pending?.reasons ?? []),
    openHistory: () => setRevisionHistoryOpen(true),
  })
  latestRef.current = {
    startEdit,
    save,
    cancelEdit,
    evaluate: () => evaluate(pending?.reasons ?? []),
    openHistory: () => setRevisionHistoryOpen(true),
  }

  useEffect(() => {
    registerHandlers({
      startEdit: () => latestRef.current.startEdit(),
      save: () => latestRef.current.save(),
      cancel: () => latestRef.current.cancelEdit(),
      syncMemory: () => latestRef.current.evaluate(),
      openHistory: () => latestRef.current.openHistory(),
      keepDraftBeforeLeave: () => persistDraft(),
      discardDraftBeforeLeave: () => discardDraft(),
    })
    return () => clearHandlers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerHandlers, clearHandlers])

  // 卸载（切章 / 切视图）时整体复位，避免下一个挂载的实例继承上一章残留的编辑态。
  useEffect(() => {
    return () => {
      setEditing(false)
      setSaving(false)
      setDirty(false)
      cancelPendingManuscriptLeave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (editing) {
    return (
      <>
        <section className={WORKBENCH_READING_CANVAS_CLASS} data-manuscript-editing="true">
          <ManuscriptEditorView value={draft} onChange={setDraft} disabled={saving} />
        </section>
        <ManuscriptLeaveDialog open={leaveDialogOpen} resolving={leaveResolving} />
      </>
    )
  }

  if (draftConflict) {
    return (
      <>
        <section className={WORKBENCH_READING_CANVAS_CLASS} data-manuscript-draft-conflict="true">
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">发现两份不同的正文</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                恢复草稿创建后，磁盘正文又发生了变化。NarraCat 不会自动合并，请先比较再选择。
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <DraftConflictPane title="当前正文" text={draftConflict.diskText} />
              <DraftConflictPane title="恢复草稿" text={draftConflict.draftText} />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void discardDraft().then((discarded) => {
                    if (discarded) setDraftConflict(null)
                  })
                }}
              >
                放弃草稿，使用当前正文
              </Button>
              {/* staging 只读预览（刀 3 §4.6）：写作中断的草稿没有进入编辑态的动作，只留「放弃草稿」。 */}
              {!artifact?.isDraft && (
                <Button
                  type="button"
                  onClick={() => {
                    setBaseText(draftConflict.diskText)
                    setDraft(draftConflict.draftText)
                    setDraftConflict(null)
                    setEditing(true)
                  }}
                >
                  以草稿继续编辑
                </Button>
              )}
            </div>
          </div>
        </section>
        <ManuscriptRevisionSheet
          open={revisionHistoryOpen}
          onOpenChange={setRevisionHistoryOpen}
          projectPath={projectPath}
          chapter={chapter}
          currentVisibleText={draftConflict.diskText}
          agentBusy={agentBusy}
          draftBlocked
          onRestored={handleRevisionRestored}
        />
      </>
    )
  }

  return (
    <div className="relative" data-chapter-manuscript-view="true">
      {pending && (
        <div
          className="mb-3 flex items-center justify-between gap-3 rounded-row border border-border bg-surface px-3 py-2"
          data-pending-memory-sync-banner="true"
        >
          <p className="min-w-0 text-sm text-muted-foreground">本章正文改动后，记忆尚未同步。</p>
          <Button type="button" size="sm" variant="secondary" disabled={agentBusy} onClick={() => evaluate(pending.reasons)}>
            评估影响并同步记忆
          </Button>
        </div>
      )}
      <ChapterPreview artifact={artifact} selectionHandoff={selectionHandoff} leadingContent={leadingContent} />
      {impactReasons && (
        <ImpactEvaluationDock
          title="记忆待同步"
          message="这次正文改动可能影响已入库的记忆与后续章节，建议评估并同步。"
          actionLabel="评估影响并同步记忆"
          disabled={agentBusy}
          onEvaluate={() => evaluate(impactReasons)}
        />
      )}
      <ManuscriptRevisionSheet
        open={revisionHistoryOpen}
        onOpenChange={setRevisionHistoryOpen}
        projectPath={projectPath}
        chapter={chapter}
        currentVisibleText={visibleText}
        agentBusy={agentBusy}
        draftBlocked={false}
        onRestored={handleRevisionRestored}
      />
    </div>
  )
}

function ManuscriptLeaveDialog({ open, resolving }: { open: boolean; resolving: boolean }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !resolving) void resolveManuscriptLeave('continue-editing')
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md" data-manuscript-leave-dialog="true">
        <DialogHeader>
          <DialogTitle>正文还没有保存</DialogTitle>
          <DialogDescription>
            恢复草稿不会改动正式正文。你可以保留草稿后离开、继续编辑，或明确放弃草稿。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={resolving}
            onClick={() => void resolveManuscriptLeave('discard-draft')}
          >
            放弃草稿并离开
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={resolving}
            onClick={() => void resolveManuscriptLeave('continue-editing')}
          >
            继续编辑
          </Button>
          <Button
            type="button"
            autoFocus
            disabled={resolving}
            onClick={() => void resolveManuscriptLeave('keep-draft')}
          >
            {resolving ? '正在保留…' : '保留草稿并离开'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DraftConflictPane({ title, text }: { title: string; text: string }) {
  return (
    <div className="min-w-0 rounded-row border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(
              () => toast.success(`已复制${title}`),
              () => toast.error('复制失败'),
            )
          }}
        >
          复制
        </Button>
      </div>
      <pre className="max-h-[48vh] overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-body-foreground">
        {text || '（当前正文为空或不可读取）'}
      </pre>
    </div>
  )
}
