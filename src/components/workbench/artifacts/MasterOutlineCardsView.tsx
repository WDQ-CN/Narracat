import { useState } from 'react'
import { Layers, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { ArtifactDocumentBody, ArtifactDocumentShell } from './ArtifactDocumentShell'
import { ImpactEvaluationDock } from '../ImpactEvaluationDock'
import { WorkbenchEmptyState } from '../WorkbenchEmptyState'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { GROUP_CLASS, READING_BODY_FONT_CLASS } from '@/design-system'
import { cn } from '@/lib/cn'
import { submitMasterOutlineFieldEdit } from '@/lib/ipc'
import {
  MASTER_OUTLINE_ENGINE_FIELD_LABELS,
  getMasterOutlineEnginePremiseAnchor,
  buildMasterOutlineEngineFieldPrompt,
  buildStakesProgressionEvaluationPrompt,
} from '@/lib/master-outline-editing'
import {
  renderOutlineStructureMarkdown,
  renderOutlineVolumesMarkdown,
  type OutlineForeshadowingData,
  type OutlineStorylineData,
  type OutlineStructureData,
} from '@shared/lib/outline-structure'
import { getForeshadowingTypeLabel, getHumanOrdinalLabel, getStorylineTypeLabel } from '@shared/lib/schema-field-labels'
import type { NovelArtifact } from '@shared/types/novel'

/**
 * 书级大纲结构化视图（spec 2026-07-12，PR1+PR2）。分档：
 * - 四个立项卡映射字段（中心戏剧问题/主角核心欲望/主角核心缺失/对抗力量）：第二档，编辑捕获意图 →
 *   底部 dock →「保存并评估影响」交给同一条 /revise-premise 评估管道（与立项卡侧同一份信息同一档位，
 *   避免宪法分裂）；
 * - stakes_progression（赌注递增）：无立项卡锚点，第二档独立走 freeform 评估 + novel_update_outline_book_field
 *   引擎机械工具落盘（PR2）；UI 标签展示统一走 MASTER_OUTLINE_ENGINE_FIELD_LABELS（不裸露引擎字段名）；
 * - 故事线名/伏笔描述：第一档行内直存（submitMasterOutlineFieldEdit），条目缺 id（老数据）不出编辑入口（PR2）；
 * - 卷章结构（id/章号/卷 arc）：只读，属书级结构大重排（A6/将来）。
 */
export function MasterOutlineCardsView({
  artifact,
  onChanged,
  onEvaluateImpact,
  onEvaluateOutlineImpact,
  projectPath,
}: {
  artifact: NovelArtifact
  /** 第一档保存成功后触发刷新（沿章纲同名参数）。 */
  onChanged?: () => void
  onEvaluateImpact?: (prompt: string) => void
  /** stakes_progression 独立评估通路（freeform，无立项卡锚点）。 */
  onEvaluateOutlineImpact?: (prompt: string) => void
  /** 第一档写回所需项目路径；缺失则故事线名/伏笔描述回退只读。 */
  projectPath?: string
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)

  const data =
    artifact.data && typeof artifact.data === 'object' ? (artifact.data as OutlineStructureData) : null

  if (!data) {
    return (
      <WorkbenchEmptyState icon={Layers} title="缺少全局大纲">
        大纲数据契约缺失或为空。
      </WorkbenchEmptyState>
    )
  }

  const engineFields = Object.entries(MASTER_OUTLINE_ENGINE_FIELD_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      value: (((data as Record<string, unknown>)[key] as string | undefined) ?? '').trim(),
    }))
    .filter((field) => field.value.length > 0)

  // stakes 无立项卡锚点，走独立 onEvaluateOutlineImpact 通路；四映射字段走 onEvaluateImpact/revise-premise。
  // 两条通路互不依赖对方是否传入——分流正确性是这个视图的核心宪法约束。
  function canEditEngineField(key: string): boolean {
    if (key === 'stakes_progression') return Boolean(onEvaluateOutlineImpact)
    return Boolean(onEvaluateImpact) && getMasterOutlineEnginePremiseAnchor(key) !== null
  }

  const editingField = engineFields.find((field) => field.key === editingKey) ?? null
  const draftValue = draft.trim()
  // dock 出现条件照抄 PremiseCardsView：有编辑接线 + 草稿非空且有改动才浮出。
  const showImpactBar =
    editingField !== null &&
    draftValue.length > 0 &&
    draftValue !== editingField.value &&
    canEditEngineField(editingField.key)

  function evaluateImpact() {
    if (!editingField) return
    if (editingField.key === 'stakes_progression') {
      if (!onEvaluateOutlineImpact) return
      onEvaluateOutlineImpact(
        buildStakesProgressionEvaluationPrompt({ oldValue: editingField.value, newValue: draftValue }),
      )
    } else {
      if (!onEvaluateImpact) return
      onEvaluateImpact(
        buildMasterOutlineEngineFieldPrompt({
          fieldKey: editingField.key,
          oldValue: editingField.value,
          newValue: draftValue,
        }),
      )
    }
    setEditingKey(null)
    setDraft('')
  }

  const canEditTierOne = Boolean(projectPath)

  async function saveTierOneEntry(input: {
    target: 'storyline_name' | 'foreshadowing_description'
    id: string
    currentValue: string
  }) {
    if (!projectPath) return
    setPending(true)
    try {
      const result = await submitMasterOutlineFieldEdit({
        projectPath,
        target: input.target,
        id: input.id,
        newValue: draft.trim(),
        expectedOldValue: input.currentValue,
      })
      if (result.ok) {
        toast.success('已保存')
        setEditingKey(null)
        onChanged?.()
      } else {
        toast.error(result.message ?? '保存失败')
      }
    } catch (error) {
      console.error(error)
      toast.error('保存失败')
    } finally {
      setPending(false)
    }
  }

  const storylines = data.storylines ?? []
  const foreshadowing = data.foreshadowing_registry ?? []
  // Task 2 落定：尾部有空行，拼进只读段前 trim。
  const volumesMarkdown = renderOutlineVolumesMarkdown(data).trim()
  // 字数按渲染正文计（对齐 OutlineView）：全量结构化 markdown 只喂给壳层做统计，不直接渲染进画布
  // （画布下方用结构化 JSX + 一段只读 markdown 呈现，避免与下方内容重复）。
  const displayArtifact: NovelArtifact = {
    ...artifact,
    content: renderOutlineStructureMarkdown(data),
    data: undefined,
  }

  return (
    <>
      <ArtifactDocumentShell artifact={displayArtifact} title={artifact.title}>
        <div data-master-outline-view="true">
          <h1 className="mb-6 text-xl font-semibold leading-tight text-foreground">{artifact.title}</h1>

          <section className="space-y-2" data-master-outline-section="engine">
            <h3 className="px-1 text-sm font-semibold text-foreground">故事引擎</h3>
            <dl className={GROUP_CLASS}>
              {engineFields.map((field) => {
                const canEdit = canEditEngineField(field.key)
                const isEditing = canEdit && editingKey === field.key
                return (
                  <div
                    key={field.key}
                    className="flex items-start justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-hover"
                    data-master-outline-field={field.key}
                  >
                    <div className="min-w-0 flex-1">
                      <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
                      {isEditing ? (
                        <div className="mt-1 flex flex-col gap-2">
                          <Textarea
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            autoFocus
                            rows={4}
                            className={`${READING_BODY_FONT_CLASS} leading-6`}
                          />
                          <div className="flex gap-2">
                            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingKey(null)}>
                              取消
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <dd
                          className={cn(
                            `mt-1 ${READING_BODY_FONT_CLASS} leading-6 [overflow-wrap:anywhere] text-foreground`,
                          )}
                        >
                          {field.value}
                        </dd>
                      )}
                    </div>
                    {!isEditing && canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0"
                        aria-label={`编辑${field.label}`}
                        data-master-outline-edit={field.key}
                        onClick={() => {
                          setEditingKey(field.key)
                          setDraft(field.value)
                        }}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                )
              })}
            </dl>
          </section>

          {storylines.length > 0 && (
            <section className="mt-6 space-y-2" data-master-outline-section="storylines">
              <h3 className="px-1 text-sm font-semibold text-foreground">故事线</h3>
              <dl className={GROUP_CLASS}>
                {storylines.map((storyline: OutlineStorylineData, index) => {
                  // 老数据兜底：条目缺 id 不出第一档编辑入口（不臆造主键）。
                  // key 用序号而非机器主键拼装，机器主键不进 DOM（ADR-0016）。
                  const itemKey = storyline.id ? `storyline:${index}` : null
                  const isEditing = canEditTierOne && itemKey !== null && editingKey === itemKey
                  const label = `${getHumanOrdinalLabel('storyline', index + 1)}${
                    storyline.type ? `（${getStorylineTypeLabel(storyline.type)}）` : ''
                  }`
                  const storylineName = storyline.name ?? ''
                  return (
                    <div
                      key={storyline.id ?? index}
                      className="flex items-start justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-hover"
                      data-master-outline-field={`storyline:${index}`}
                    >
                      <div className="min-w-0 flex-1">
                        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                        {isEditing ? (
                          <div className="mt-1 flex flex-col gap-2">
                            <Textarea
                              value={draft}
                              onChange={(event) => setDraft(event.target.value)}
                              autoFocus
                              rows={2}
                              className={`${READING_BODY_FONT_CLASS} leading-6`}
                            />
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                disabled={pending || !draft.trim()}
                                onClick={() =>
                                  saveTierOneEntry({
                                    target: 'storyline_name',
                                    id: storyline.id as string,
                                    currentValue: storylineName,
                                  })
                                }
                              >
                                {pending && <Loader2 className="size-3.5 animate-spin" />}
                                保存
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => setEditingKey(null)}
                              >
                                取消
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <dd
                            className={`mt-1 ${READING_BODY_FONT_CLASS} leading-6 [overflow-wrap:anywhere] text-foreground`}
                          >
                            {storylineName}
                          </dd>
                        )}
                      </div>
                      {!isEditing && canEditTierOne && itemKey !== null && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0"
                          aria-label={`编辑${label}`}
                          data-master-outline-tier1-edit={itemKey}
                          onClick={() => {
                            setEditingKey(itemKey)
                            setDraft(storylineName)
                          }}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </dl>
            </section>
          )}

          {foreshadowing.length > 0 && (
            <section className="mt-6 space-y-2" data-master-outline-section="foreshadowing">
              <h3 className="px-1 text-sm font-semibold text-foreground">伏笔注册表</h3>
              <dl className={GROUP_CLASS}>
                {foreshadowing.map((entry: OutlineForeshadowingData, index) => {
                  // 老数据兜底：条目缺 id 不出第一档编辑入口（不臆造主键）。
                  // key 用序号而非机器主键拼装，机器主键不进 DOM（ADR-0016）。
                  const itemKey = entry.id ? `foreshadowing:${index}` : null
                  const isEditing = canEditTierOne && itemKey !== null && editingKey === itemKey
                  const label = `${getHumanOrdinalLabel('foreshadowing', index + 1)}${
                    entry.type ? `（${getForeshadowingTypeLabel(entry.type)}）` : ''
                  }`
                  const description = entry.description ?? ''
                  return (
                    <div
                      key={entry.id ?? index}
                      className="flex items-start justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-hover"
                      data-master-outline-field={`foreshadowing:${index}`}
                    >
                      <div className="min-w-0 flex-1">
                        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                        {isEditing ? (
                          <div className="mt-1 flex flex-col gap-2">
                            <Textarea
                              value={draft}
                              onChange={(event) => setDraft(event.target.value)}
                              autoFocus
                              rows={2}
                              className={`${READING_BODY_FONT_CLASS} leading-6`}
                            />
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                disabled={pending || !draft.trim()}
                                onClick={() =>
                                  saveTierOneEntry({
                                    target: 'foreshadowing_description',
                                    id: entry.id as string,
                                    currentValue: description,
                                  })
                                }
                              >
                                {pending && <Loader2 className="size-3.5 animate-spin" />}
                                保存
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => setEditingKey(null)}
                              >
                                取消
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <dd
                            className={`mt-1 ${READING_BODY_FONT_CLASS} leading-6 [overflow-wrap:anywhere] text-foreground`}
                          >
                            {description}
                          </dd>
                        )}
                      </div>
                      {!isEditing && canEditTierOne && itemKey !== null && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0"
                          aria-label={`编辑${label}`}
                          data-master-outline-tier1-edit={itemKey}
                          onClick={() => {
                            setEditingKey(itemKey)
                            setDraft(description)
                          }}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </dl>
            </section>
          )}
        </div>

        {volumesMarkdown && (
          <div className="mt-6" data-master-outline-section="volumes">
            <ArtifactDocumentBody>{volumesMarkdown}</ArtifactDocumentBody>
          </div>
        )}
      </ArtifactDocumentShell>
      {/* 第二档评估 dock 放在阅读画布之外（照抄 PremiseCardsView：避免被阅读列宽度剪切）。 */}
      {showImpactBar && <ImpactEvaluationDock onEvaluate={evaluateImpact} />}
    </>
  )
}
