import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Download, FolderPlus, PenTool, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { EMPTY_PRIMARY_BODY_CLASS, EMPTY_PRIMARY_TITLE_CLASS } from '@/design-system'
import type { PackDraftMeta } from '@shared/types/capability-pack'

function formatUpdatedAt(updatedAt: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(updatedAt))
}

/**
 * 设置页「我的创作」子视图（B2 刀3，造包中心第一件）：列出本地能力包草稿（`PackDraftMeta`），
 * 顶部「新建能力包」（行内输入名称）与「导入」（`.narracatproj` 创作备份文件）；
 * 行内「打开」进编辑器、「导出备份」、「删除」（二次确认）。
 * 「从书学写法」（刀4）与「作家向导」（刀5）两个进料器入口同构并列，各配 spec §1 那句分工文案
 * ——只讲清楚各自产出什么，不展开教程（教程在各自向导内部逐步给）；和工作台「参考作品」的边界
 * 单独一句放在入口区下方。
 * 返回入口在设置页 titlebar 面包屑（导航规范 §9.8），本视图不放返回按钮。
 */
export function WorkshopListView({
  onOpenDraft,
  onOpenLearn,
  onOpenWizard,
}: {
  onOpenDraft: (draftId: string) => void
  onOpenLearn: () => void
  onOpenWizard: () => void
}) {
  const [drafts, setDrafts] = useState<PackDraftMeta[]>([])
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  // 删除二次确认：首次点「删除」进入确认态（不直接执行），同一时刻只有一行能处于确认态
  const [confirmingDraftId, setConfirmingDraftId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setDrafts(await window.electron.listPackDrafts())
    setLoaded(true)
  }, [])

  useEffect(() => {
    refresh().catch(() => setMessage('加载我的创作失败，请重试。'))
  }, [refresh])

  const startCreating = useCallback(() => {
    setMessage(null)
    setDraftName('')
    setCreating(true)
  }, [])

  const cancelCreating = useCallback(() => {
    setCreating(false)
    setDraftName('')
  }, [])

  const confirmCreate = useCallback(async () => {
    const name = draftName.trim()
    if (!name || busyKey) return
    setBusyKey('create')
    try {
      const meta = await window.electron.createPackDraft({ name })
      setCreating(false)
      setDraftName('')
      onOpenDraft(meta.draftId)
    } catch {
      setMessage('新建能力包失败，请重试。')
    } finally {
      setBusyKey(null)
    }
  }, [draftName, busyKey, onOpenDraft])

  const handleImport = useCallback(async () => {
    if (busyKey) return
    setBusyKey('import')
    try {
      const result = await window.electron.importPackDraftProject()
      if (result.status === 'ok') {
        setMessage(null)
        await refresh()
      } else if (result.status !== 'canceled') {
        setMessage(result.message)
      }
    } catch {
      setMessage('导入失败，请重试。')
    } finally {
      setBusyKey(null)
    }
  }, [busyKey, refresh])

  const handleExport = useCallback(async (draftId: string) => {
    const key = `export:${draftId}`
    if (busyKey) return
    setBusyKey(key)
    try {
      const result = await window.electron.exportPackDraftProject({ draftId })
      if (result.status === 'ok') setMessage(`已导出创作备份文件：${result.filePath}`)
      else if (result.status !== 'canceled') setMessage(result.message)
    } catch {
      setMessage('导出失败，请重试。')
    } finally {
      setBusyKey(null)
    }
  }, [busyKey])

  const handleDelete = useCallback(async (draftId: string) => {
    const key = `delete:${draftId}`
    if (busyKey) return
    setBusyKey(key)
    try {
      await window.electron.deletePackDraft({ draftId })
      setDrafts((prev) => prev.filter((draft) => draft.draftId !== draftId))
      setConfirmingDraftId(null)
      setMessage(null)
    } catch {
      setMessage('删除失败，请重试。')
    } finally {
      setBusyKey(null)
    }
  }, [busyKey])

  return (
    <section className="space-y-3" data-workshop-list-view="true">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs leading-5 text-muted-foreground">你正在制作的能力包，随时接着编辑或导出备份。</p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busyKey === 'import'}
            data-workshop-import-trigger="true"
            onClick={() => void handleImport()}
          >
            <FolderPlus className="size-4" />
            导入
          </Button>
          {creating ? null : (
            <Button
              type="button"
              size="sm"
              data-workshop-create-trigger="true"
              onClick={startCreating}
            >
              <PenTool className="size-4" />
              新建能力包
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2" data-workshop-feeder-entries="true">
        <div className="space-y-2 rounded-row border border-border bg-surface px-4 py-3.5" data-workshop-learn-entry="true">
          <Button type="button" size="sm" data-workshop-learn-trigger="true" onClick={onOpenLearn}>
            <BookOpen className="size-4" />
            从书学写法
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">把一本书的写法炼成你的能力卡。</p>
        </div>
        <div className="space-y-2 rounded-row border border-border bg-surface px-4 py-3.5" data-workshop-wizard-entry="true">
          <Button type="button" size="sm" data-workshop-wizard-trigger="true" onClick={onOpenWizard}>
            <Wand2 className="size-4" />
            作家向导
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">把你脑子里的写法聊出来炼成卡——不需要范本书。</p>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        要给某一本书定调找灵感？用工作台里的「参考作品」——它隐形注入、不产资产。
      </p>

      {creating ? (
        <div
          className="flex items-center gap-2 rounded-row border border-border bg-surface px-3 py-2.5"
          data-workshop-create-row="true"
        >
          <Input
            autoFocus
            placeholder="给能力包起个名字"
            value={draftName}
            disabled={busyKey === 'create'}
            data-workshop-create-name-input="true"
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void confirmCreate()
              if (event.key === 'Escape') cancelCreating()
            }}
          />
          <Button type="button" variant="ghost" size="sm" disabled={busyKey === 'create'} onClick={cancelCreating}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busyKey === 'create' || !draftName.trim()}
            data-workshop-create-confirm="true"
            onClick={() => void confirmCreate()}
          >
            创建
          </Button>
        </div>
      ) : null}

      {message ? (
        <p className="text-xs leading-5 text-muted-foreground" data-workshop-list-message="true">
          {message}
        </p>
      ) : null}

      <div className="space-y-2">
        {drafts.map((draft) => (
          <WorkshopDraftRow
            key={draft.draftId}
            draft={draft}
            busy={busyKey === `export:${draft.draftId}` || busyKey === `delete:${draft.draftId}`}
            confirming={confirmingDraftId === draft.draftId}
            onOpen={() => onOpenDraft(draft.draftId)}
            onExport={() => void handleExport(draft.draftId)}
            onRequestDelete={() => setConfirmingDraftId(draft.draftId)}
            onCancelDelete={() => setConfirmingDraftId(null)}
            onConfirmDelete={() => void handleDelete(draft.draftId)}
          />
        ))}

        {loaded && drafts.length === 0 && !creating ? (
          <div
            className="flex min-h-[240px] flex-col items-center justify-center rounded-row border border-dashed border-border px-4 text-center"
            data-workshop-list-empty="true"
          >
            <h2 className={EMPTY_PRIMARY_TITLE_CLASS}>还没有你的能力包</h2>
            <p className={`mt-2 max-w-sm ${EMPTY_PRIMARY_BODY_CLASS}`}>
              新建一个能力包，把你的文风、手法沉淀下来，随时用在自己的小说里。
            </p>
            <div className="mt-5">
              <Button type="button" onClick={startCreating}>
                <PenTool className="size-4" />
                新建能力包
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/**
 * 单条创作草稿行：包名 + 更新时间 + 已发布版本（未发布过则不展示徽标）；
 * 打开为行内主热区，导出/删除为行尾 icon 操作，删除走行内二次确认（替换操作区，不弹独立弹窗）。
 */
function WorkshopDraftRow({
  draft,
  busy,
  confirming,
  onOpen,
  onExport,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  draft: PackDraftMeta
  busy: boolean
  confirming: boolean
  onOpen: () => void
  onExport: () => void
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-row border border-border bg-surface px-3 py-2.5"
      data-workshop-draft-row={draft.draftId}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        data-workshop-draft-open={draft.draftId}
        onClick={onOpen}
      >
        <div className="truncate text-sm font-medium leading-tight text-foreground">{draft.name}</div>
        <div className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">
          更新于 {formatUpdatedAt(draft.updatedAt)}
          {draft.lastPublishedVersion ? ` · 已发布 v${draft.lastPublishedVersion}` : ' · 未发布'}
        </div>
      </button>

      {confirming ? (
        <div className="flex shrink-0 items-center gap-2" data-workshop-draft-delete-confirm={draft.draftId}>
          <p className="text-xs leading-5 text-muted-foreground">删除后无法恢复，确定删除「{draft.name}」？</p>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancelDelete}>
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            data-workshop-draft-delete-confirm-trigger={draft.draftId}
            onClick={onConfirmDelete}
          >
            确认删除
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          {/* learned-external（从外部书学得）永久锁不可导出（渲染端提示层；ADR-0034 权利元数据合规
              硬约束）：禁用备份导出入口，避免把仅本机使用的内容打包成 .narracatproj 带出去。 */}
          <IconTooltip label={draft.localSource === 'learned-external' ? '仅本机使用，不可导出' : '导出备份'}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy || draft.localSource === 'learned-external'}
              aria-label={draft.localSource === 'learned-external' ? '仅本机使用，不可导出' : '导出备份'}
              data-workshop-draft-export={draft.draftId}
              onClick={onExport}
            >
              <Download className="size-4" />
            </Button>
          </IconTooltip>
          <IconTooltip label="删除">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label="删除"
              data-workshop-draft-delete={draft.draftId}
              onClick={onRequestDelete}
            >
              <Trash2 className="size-4" />
            </Button>
          </IconTooltip>
        </div>
      )}
    </div>
  )
}
