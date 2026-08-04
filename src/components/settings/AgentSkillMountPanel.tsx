import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, ChevronRight, FolderPlus, Package, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { MarkdownRenderer } from '@/components/workbench/MarkdownRenderer'
import { MUTED_PILL_CLASS } from '@/design-system'
import {
  commitUserSkillImport,
  listSkillMounts,
  listUserSkills,
  previewUserSkillImport,
  readUserSkillBody,
  resetAgentSkillMounts,
  uninstallUserSkill,
} from '@/lib/ipc'
import { computePreloadBudget } from '@shared/lib/skill-budget'
import { resolveEffectiveMounts, resolveEffectiveMountViews } from '@shared/lib/skill-mounts'
import { cn } from '@/lib/cn'
import type { AgentSkillMount, ResolvedSkillMountView, UserSkill } from '@shared/types/skill-mount'
import { AGENT_MOUNT_GUIDANCE, getOfficialSkillDisplay, isMountEnabledAgent } from './skill-mount-copy'

// 方型圆角图标容器：官方统一品牌图标 / 用户统一默认图标。纯展示，配可访问名称由父级提供。
const SKILL_ICON_TILE_CLASS = 'flex size-10 shrink-0 items-center justify-center rounded-row'

interface AgentSkillMountPanelProps {
  agentId: string
  /** 该 Agent 的 Agent Core 默认 skills（diagnostics.agentSkills[agentId]） */
  defaultSkills: string[]
  /** 该 Agent 的可挂载 Skill 集（diagnostics.mountableSkillsByAgent[agentId]）；本期官方 c 类为空 */
  mountableSkills: string[]
  /** 各 Skill 的 SKILL.md token 体量估算（diagnostics.skillTokenEstimates），预算护栏用 */
  skillTokenEstimates?: Record<string, number>
  /** 各 Skill 声明的触发点（diagnostics.skillTriggers）；保留供后续按需挂载用，本切片官方侧不消费 */
  skillTriggers?: Record<string, string[]>
}

/**
 * 单个 Agent 的 Skill 挂载面板（ADR-0020 四类模型，#291 官方侧 UI）。
 *
 * 本切片只落地官方侧：有效挂载列表（含官方默认锁定行）+ 标题行「+」入口 + 挂载弹窗壳。
 * 弹窗含引导文案 + 官方可挂载列表（本期空，空状态壳）+「选本地文件夹挂载」入口占位。
 * 用户 skill 行 / 详情弹窗 / 导入逻辑见 #292、#293，本切片不实现。
 */
export function AgentSkillMountPanel({
  agentId,
  defaultSkills,
  mountableSkills,
  skillTokenEstimates = {},
}: AgentSkillMountPanelProps) {
  const [mounts, setMounts] = useState<AgentSkillMount[]>([])
  const [userSkills, setUserSkills] = useState<UserSkill[]>([])
  const [busy, setBusy] = useState(false)
  const [mountDialogOpen, setMountDialogOpen] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirmDialog()
  // 当前打开详情弹窗的用户 Skill；null = 关闭。正文按需懒读（detailBody），加载中 detailBodyLoading。
  const [detailSkill, setDetailSkill] = useState<UserSkill | null>(null)
  const [detailBody, setDetailBody] = useState<string>('')
  const [detailBodyLoading, setDetailBodyLoading] = useState(false)

  const mountEnabled = isMountEnabledAgent(agentId)

  useEffect(() => {
    let cancelled = false
    void Promise.all([listSkillMounts(), listUserSkills()])
      .then(([nextMounts, nextUserSkills]) => {
        if (cancelled) return
        setMounts(nextMounts)
        setUserSkills(nextUserSkills)
      })
      .catch(() => {
        if (cancelled) return
        setMounts([])
        setUserSkills([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const views = useMemo(
    () => resolveEffectiveMountViews({ agentId, defaultSkills, userMounts: mounts }),
    [agentId, defaultSkills, mounts],
  )

  // 该 Agent 绑定的用户 Skill（全局记录里按 agentId 过滤）
  const agentUserSkills = useMemo(
    () => userSkills.filter((skill) => skill.agentId === agentId),
    [userSkills, agentId],
  )

  const budget = useMemo(() => {
    // 预加载预算 = 官方有效预加载集 + 该 Agent 的用户 Skill（ADR-0020 §3：用户 Skill 一律预加载）。
    // 用户 Skill 的 token 用 store 按快照 SKILL.md 现算的 estimatedTokens；缺失（快照不可读）→ 未知占位降级。
    const { preload } = resolveEffectiveMounts({ agentId, defaultSkills, userMounts: mounts })
    const userTokenEstimates: Record<string, number> = {}
    for (const skill of agentUserSkills) {
      if (typeof skill.estimatedTokens === 'number') userTokenEstimates[skill.id] = skill.estimatedTokens
    }
    return computePreloadBudget({
      preloadSkills: [...preload, ...agentUserSkills.map((skill) => skill.id)],
      skillTokenEstimates: { ...skillTokenEstimates, ...userTokenEstimates },
    })
  }, [agentId, defaultSkills, mounts, skillTokenEstimates, agentUserSkills])

  const mountedSkillIds = useMemo(() => new Set(views.map((view) => view.skillId)), [views])
  // 弹窗内「可挂载」官方列表 = 该 Agent 可挂载集减去已挂的；本期 mountableSkills 空，列表为空状态壳。
  const addableSkills = useMemo(
    () => mountableSkills.filter((skillId) => !mountedSkillIds.has(skillId)),
    [mountableSkills, mountedSkillIds],
  )
  const hasUserOverlay = useMemo(() => mounts.some((mount) => mount.agentId === agentId), [mounts, agentId])

  // 详情弹窗打开时懒读快照正文：仅用户自定义 Skill 可看正文（ADR-0020 约束 1，官方走黑盒不经此路）。
  // 读失败主进程降级返回空串 → 弹窗内空状态提示，不阻断浏览。
  useEffect(() => {
    if (!detailSkill) return
    let cancelled = false
    setDetailBody('')
    setDetailBodyLoading(true)
    void readUserSkillBody({ id: detailSkill.id })
      .then((body) => {
        if (!cancelled) setDetailBody(body)
      })
      .catch(() => {
        if (!cancelled) setDetailBody('')
      })
      .finally(() => {
        if (!cancelled) setDetailBodyLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [detailSkill])

  async function withBusy(action: () => Promise<AgentSkillMount[]>) {
    if (busy) return
    setBusy(true)
    try {
      setMounts(await action())
    } catch {
      // 失败时静默保持原状态，避免破坏只读浏览
    } finally {
      setBusy(false)
    }
  }

  async function resetToDefault() {
    await withBusy(() => resetAgentSkillMounts({ agentId }))
  }

  // 选本地文件夹挂载用户 Skill（#294 两步流）：先预检（开选择器 + 校验 + scripts 探测 + 撞名判定，不复制），
  // 据预检结果分流——conflict 直接拒绝；含 scripts 弹一次确认（确认才 commit）；否则直接 commit 复制快照。
  // canceled 静默；invalid / conflict 在弹窗内提示；ok 刷新列表并关闭弹窗。
  async function importLocalSkill() {
    if (busy) return
    setBusy(true)
    setImportError(null)
    try {
      const preview = await previewUserSkillImport({ agentId })
      if (preview.status === 'canceled') return
      if (preview.status === 'invalid' || preview.status === 'conflict') {
        setImportError(preview.message)
        return
      }
      // status === 'ready'：含 scripts 先弹一次确认（挂载时一次，非每次 run），取消则不挂。
      // 阶段2切片④：脚本/references 从不随写作运行注入或执行——只有 SKILL.md 正文会 inline 进 prompt，
      // 此确认不再是「运行时可能执行代码」的风险提示，而是让作者知悉 scripts/references 不生效。
      if (
        preview.hasScripts &&
        !(await confirm({
          title: '这个技能带有 scripts 目录',
          description:
            'NarraCat 只会把 SKILL.md 正文注入写作运行，scripts 和 references 里的内容不会被注入或执行。挂载不影响其他功能，随时可以卸载。',
          confirmLabel: '仍要挂载',
        }))
      ) {
        return
      }
      const result = await commitUserSkillImport({ agentId, folderPath: preview.folderPath })
      if (result.status === 'ok') {
        setUserSkills(result.skills)
        setMountDialogOpen(false)
        toast.success(`已挂载技能「${preview.name}」`)
      } else {
        setImportError(result.message)
      }
    } catch {
      setImportError('挂载失败，请重试。')
      toast.error('挂载失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  // 卸载用户 Skill：移除记录 + 删快照，关闭详情弹窗，toast 反馈。二次确认在详情弹窗内（UserSkillDetailBody）。
  async function uninstallSkill(skill: UserSkill) {
    if (busy) return
    setBusy(true)
    try {
      setUserSkills(await uninstallUserSkill({ id: skill.id }))
      setDetailSkill((current) => (current?.id === skill.id ? null : current))
      toast.success(`已卸载技能「${skill.name}」`)
    } catch {
      toast.error('卸载失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3" data-agent-profile-skill-list="true" data-agent-skill-mount-panel={agentId}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold leading-tight text-foreground">挂载技能</h3>
        {mountEnabled ? (
          <IconTooltip label="挂载技能">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label="挂载技能"
              data-agent-skill-mount-add-trigger={agentId}
              onClick={() => setMountDialogOpen(true)}
            >
              <Plus className="size-4" />
            </Button>
          </IconTooltip>
        ) : null}
      </div>

      {views.length === 0 && agentUserSkills.length === 0 ? (
        <div
          className="flex min-h-[72px] items-center rounded-row border border-dashed border-border px-3 py-3 text-sm leading-6 text-muted-foreground"
          data-agent-skill-mount-empty="true"
        >
          该 Agent 暂无挂载 Skill，依靠工具与上下文完成工作。
        </div>
      ) : (
        <div className="space-y-2">
          {views.map((view) => (
            <SkillMountRow key={view.skillId} view={view} />
          ))}
          {agentUserSkills.map((skill) => (
            <SkillMountRow
              key={skill.id}
              view={{ skillId: skill.id, mode: 'preload', origin: 'user' }}
              name={skill.name}
              description={skill.description}
              onOpen={() => setDetailSkill(skill)}
            />
          ))}
        </div>
      )}

      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground"
        data-agent-skill-mount-budget="true"
        data-over-limit={budget.overLimit}
      >
        <span>
          预加载已占 ~{budget.totalTokens.toLocaleString()} token（上限 {budget.limit.toLocaleString()}）
        </span>
        {budget.overLimit ? (
          <span className="text-destructive" data-agent-skill-mount-budget-warning="true">
            已超安全上限，建议卸载部分挂载 Skill。
          </span>
        ) : null}
      </div>

      {hasUserOverlay ? (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={busy}
            data-agent-skill-mount-reset="true"
            className="rounded-row px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void resetToDefault()}
          >
            恢复默认挂载
          </button>
        </div>
      ) : null}

      {mountEnabled ? (
        <Dialog
          open={mountDialogOpen}
          onOpenChange={(open) => {
            setMountDialogOpen(open)
            if (!open) setImportError(null)
          }}
        >
          <DialogContent
            className="overflow-hidden bg-workspace p-0 sm:max-w-[560px]"
            data-agent-skill-mount-dialog={agentId}
          >
            <SkillMountDialogBody
              agentId={agentId}
              addableSkills={addableSkills}
              busy={busy}
              importError={importError}
              onSelectLocalFolder={() => void importLocalSkill()}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog open={detailSkill !== null} onOpenChange={(open) => (open ? undefined : setDetailSkill(null))}>
        <DialogContent
          className="overflow-hidden bg-workspace p-0 sm:max-w-[560px]"
          data-user-skill-detail-dialog={detailSkill?.id}
        >
          {detailSkill ? (
            <UserSkillDetailBody
              skill={detailSkill}
              body={detailBody}
              bodyLoading={detailBodyLoading}
              busy={busy}
              onUninstall={() => void uninstallSkill(detailSkill)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </section>
  )
}

/**
 * 单条有效挂载行（新样式）：左侧方型圆角图标 + 名字 + 简介 + 右侧 tag / 箭头。
 * 官方默认（锁定）：官方品牌图标 +「官方」「锁定」tag、无箭头（不可看正文、不可卸 → 非可点）。
 * 用户挂载：默认图标 + 无 tag + 右箭头，整行可点 / 键盘可达（Enter/Space）→ 打开详情弹窗（简介 + 正文 + 卸载）。
 */
export function SkillMountRow({
  view,
  onOpen,
  name: nameOverride,
  description: descriptionOverride,
}: {
  view: ResolvedSkillMountView
  /** 用户 Skill 行点击 / 键盘激活 → 打开详情弹窗。官方锁定行不传（非可点） */
  onOpen?: () => void
  /** 用户 Skill 行的展示名（SKILL.md name）；缺省回退到官方展示元数据 / skillId */
  name?: string
  /** 用户 Skill 行的展示简介（SKILL.md description）；官方行忽略此项（走黑盒元数据） */
  description?: string
}) {
  const isOfficial = view.origin === 'default'
  const display = getOfficialSkillDisplay(view.skillId)
  const name = isOfficial ? display.name : (nameOverride ?? view.skillId)
  const description = isOfficial ? display.description : (descriptionOverride ?? '')
  // 用户行可点：整行作 role=button + 键盘可达；官方锁定行保持纯展示 div。
  const interactive = !isOfficial && typeof onOpen === 'function'

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `查看 ${name} 详情` : undefined}
      className={cn(
        'flex items-center gap-3 rounded-row border border-border bg-surface px-3 py-2.5',
        interactive &&
          'cursor-pointer transition-colors hover:border-border-strong hover:bg-hover focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
      )}
      data-agent-skill-mount-row={view.skillId}
      data-agent-skill-mount-origin={view.origin}
      onClick={interactive ? onOpen : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpen?.()
              }
            }
          : undefined
      }
    >
      <div
        className={cn(
          SKILL_ICON_TILE_CLASS,
          isOfficial ? 'border border-brand-border bg-brand-soft text-brand' : 'border border-border bg-active text-muted-foreground',
        )}
        aria-hidden="true"
      >
        {isOfficial ? <BadgeCheck className="size-5" /> : <Package className="size-5" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-tight text-foreground">{name}</div>
        {description ? (
          <div className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">{description}</div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isOfficial ? (
          <>
            <span className={MUTED_PILL_CLASS}>官方</span>
            <span className={MUTED_PILL_CLASS} data-agent-skill-mount-locked={view.skillId}>
              锁定
            </span>
          </>
        ) : interactive ? (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
      </div>
    </div>
  )
}

/**
 * 用户 Skill 详情弹窗正文（与 Dialog 容器解耦，便于直接快照测试）：
 * 简介（description）+ 正文（快照 SKILL.md body，Markdown 渲染）+ 卸载。
 * 仅用户自定义 Skill 走此弹窗——官方 Skill 黑盒不展示正文（ADR-0020 约束 1）。
 * 操作只支持卸载（spec §4：不做「在对话中试用」）。
 */
export function UserSkillDetailBody({
  skill,
  body,
  bodyLoading = false,
  busy = false,
  onUninstall,
}: {
  skill: UserSkill
  /** 快照正文（SKILL.md frontmatter 之后部分）；空串 = 读失败 / 无正文 */
  body: string
  /** 正文懒读进行中 */
  bodyLoading?: boolean
  /** 卸载进行中：禁用卸载按钮 */
  busy?: boolean
  onUninstall: () => void
}) {
  // 卸载二次确认：首次点「卸载」进入确认态（不直接执行），避免误删快照。详情弹窗每次打开都是新挂载 → 重置。
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="min-w-0">
      <DialogHeader className="border-b border-border px-6 pb-5 pt-6 text-left">
        <DialogTitle className="text-lg leading-tight">{skill.name}</DialogTitle>
        <DialogDescription>{skill.description}</DialogDescription>
      </DialogHeader>

      <div className="min-w-0 px-6 py-5" data-user-skill-detail-body={skill.id}>
        <section
          className="max-h-[48vh] min-w-0 overflow-y-auto rounded-row border border-border bg-surface px-4 py-3"
          data-user-skill-detail-content="true"
        >
          {bodyLoading ? (
            <p className="text-sm leading-6 text-muted-foreground">正在载入正文…</p>
          ) : body ? (
            <MarkdownRenderer text={body} />
          ) : (
            <p className="text-sm leading-6 text-muted-foreground" data-user-skill-detail-empty="true">
              暂无正文内容。
            </p>
          )}
        </section>
      </div>

      <DialogFooter className="border-t border-border bg-active/40 px-6 py-4">
        {confirming ? (
          <div
            className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            data-user-skill-detail-confirm-row="true"
          >
            <p className="text-xs leading-5 text-muted-foreground">
              卸载会删除该 Skill 的本地快照，确定卸载「{skill.name}」？
            </p>
            <div className="flex shrink-0 justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                data-user-skill-detail-uninstall-confirm={skill.id}
                onClick={onUninstall}
              >
                确认卸载
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            data-user-skill-detail-uninstall={skill.id}
            onClick={() => setConfirming(true)}
          >
            卸载
          </Button>
        )}
      </DialogFooter>
    </div>
  )
}

/**
 * 挂载弹窗正文（与 Dialog 容器解耦，便于直接快照测试）：
 * 引导文案 + 官方可挂载列表（本期空，空状态壳）+「选本地文件夹挂载」（走目录选择器导入用户 Skill）。
 */
export function SkillMountDialogBody({
  agentId,
  addableSkills,
  onSelectLocalFolder,
  busy = false,
  importError = null,
}: {
  agentId: string
  addableSkills: string[]
  onSelectLocalFolder: () => void
  /** 导入进行中：禁用「选本地文件夹挂载」入口，避免并发开多个选择器 */
  busy?: boolean
  /** 上次导入失败提示（如「不是有效的 Skill 文件夹」）；null 时不展示 */
  importError?: string | null
}) {
  const guidance = AGENT_MOUNT_GUIDANCE[agentId]

  return (
    <div className="min-w-0">
      <DialogHeader className="border-b border-border px-6 pb-5 pt-6 text-left">
        <DialogTitle className="text-lg leading-tight">挂载技能</DialogTitle>
        {guidance ? (
          <DialogDescription>{guidance}</DialogDescription>
        ) : (
          <DialogDescription className="sr-only">为该 Agent 挂载技能。</DialogDescription>
        )}
      </DialogHeader>

      <div className="space-y-4 px-6 py-5" data-agent-skill-mount-dialog-body={agentId}>
        <section className="space-y-2" data-agent-skill-mount-official-list="true">
          <h4 className="text-xs font-medium leading-none text-hint-foreground">官方技能</h4>
          {addableSkills.length === 0 ? (
            <div
              className="flex min-h-[64px] items-center rounded-row border border-dashed border-border px-3 py-3 text-sm leading-6 text-muted-foreground"
              data-agent-skill-mount-official-empty="true"
            >
              暂无可挂载的官方技能。
            </div>
          ) : (
            <div className="space-y-2">
              {addableSkills.map((skillId) => {
                const display = getOfficialSkillDisplay(skillId)
                return (
                  <div
                    key={skillId}
                    className="rounded-row border border-border bg-surface px-3 py-2.5"
                    data-agent-skill-mount-official-skill={skillId}
                  >
                    <div className="text-sm font-medium leading-tight text-foreground">{display.name}</div>
                    {display.description ? (
                      <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{display.description}</div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {importError ? (
          <p className="text-xs leading-5 text-destructive" data-agent-skill-mount-import-error="true">
            {importError}
          </p>
        ) : null}
      </div>

      <DialogFooter className="border-t border-border bg-active/40 px-6 py-4">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          data-agent-skill-mount-pick-folder="true"
          onClick={onSelectLocalFolder}
        >
          <FolderPlus className="size-4" />
          选本地文件夹挂载
        </Button>
      </DialogFooter>
    </div>
  )
}
