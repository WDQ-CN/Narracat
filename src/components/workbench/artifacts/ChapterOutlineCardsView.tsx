import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ArtifactDocumentShell } from './ArtifactDocumentShell'
import { StateChangesLedger } from './StateChangesLedger'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { GROUP_CLASS, READING_BODY_FONT_CLASS } from '@/design-system'
import { cn } from '@/lib/cn'
import { submitChapterOutlineFieldEdit } from '@/lib/ipc'
import { isFirstTierChapterArrayField, isFirstTierChapterField } from '@shared/lib/chapter-outline-field-tier'
import { renderChapterOutlineMarkdown, type ChapterOutlineData } from '@shared/lib/outline-structure'
import {
  getForeshadowingActionLabel,
  getHumanOrdinalLabel,
  getPayoffBeatLabel,
  getPayoffIntensityLabel,
  isMachinePrimaryKey,
} from '@shared/lib/schema-field-labels'
import type { NovelArtifact } from '@shared/types/novel'

/**
 * 章纲结构化字段视图（ADR-0029 B2a）：替代纯 markdown 阅读。第一档纯描述字段（章标题/价值转换/
 * 情感赌注/戏剧焦点/章末收尾）行内可编辑，直写 ch-NNN.json + 写回机械重渲的 ch-NNN.md；
 * 其余字段（爽点/故事线/视角/场景/伏笔）只读（第二档编辑 = B2b）。
 */

interface EditableField {
  key: string
  label: string
  value: string
}

export function ChapterOutlineCardsView({
  artifact,
  projectPath,
  chapter,
  chapterWritten,
  deferTargets,
  onChanged,
}: {
  artifact?: NovelArtifact
  /** 写回所需项目路径；缺失则只读 */
  projectPath?: string
  /** 章号（写回定位用） */
  chapter: number
  /** 该章正文是否已完成写作（决定「本章状态变更」账本区可编辑 vs 只读，Task 6） */
  chapterWritten?: boolean
  /** 未兑现行「移到后续章」候选章号（WorkbenchObjectView 按 tocItems 算，Task 7），透传进账本区 */
  deferTargets?: number[]
  /** 保存成功后触发刷新 */
  onChanged?: () => void
}) {
  const data = (artifact?.data ?? {}) as ChapterOutlineData
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const canEdit = Boolean(projectPath)

  const chapterLabel = typeof data.chapter === 'number' ? `第 ${data.chapter} 章` : '章节'
  const displayArtifact: NovelArtifact = {
    kind: 'outline',
    title: artifact?.title ?? chapterLabel,
    path: artifact?.path ?? '',
    exists: true,
    content: renderChapterOutlineMarkdown(data),
  }

  // 第一档可编辑字段（仅渲染有值的：required 字段恒有值；ending_note 可选，缺则不显示）
  const editable: EditableField[] = (
    [
      { key: 'title', label: '章标题', value: data.title ?? '' },
      { key: 'value_shift', label: '价值转换', value: data.value_shift ?? '' },
      { key: 'emotional_stakes', label: '情感赌注', value: data.emotional_stakes ?? '' },
      { key: 'dramatic_focus', label: '戏剧焦点', value: data.dramatic_focus ?? '' },
      { key: 'ending_note', label: '章末收尾', value: data.ending_note ?? '' },
      { key: 'positioning', label: '本章定位', value: data.positioning ?? '' },
    ] satisfies EditableField[]
  ).filter((f) => f.value.trim().length > 0)

  // 第二档只读字段
  const readonlyCore: Array<[string, string]> = []
  if (data.payoff_beat) {
    const beatLabel = getPayoffBeatLabel(data.payoff_beat)
    const intensityLabel = data.payoff_intensity ? getPayoffIntensityLabel(data.payoff_intensity) : undefined
    readonlyCore.push(['本章爽点', intensityLabel ? `${beatLabel} · 强度：${intensityLabel}` : beatLabel])
  }
  const focusNames = (data.storyline_focus ?? [])
    .map((id, index) => {
      const name = data.storylineNames?.[id]
      if (name && name.trim()) return name.trim()
      // 缺书级映射时机器主键降级为人读序号，不裸露 SL-*（#243，与 renderChapterOutlineMarkdown 一致）
      return isMachinePrimaryKey(id) ? getHumanOrdinalLabel('storyline', index + 1) : id
    })
    .filter((s) => s && s.trim())
  if (focusNames.length > 0) readonlyCore.push(['聚焦故事线', focusNames.join('、')])
  if (data.pov_character?.name) readonlyCore.push(['视角人物', data.pov_character.name])

  async function save(field: { key: string; value: string; itemIndex?: number }) {
    if (!projectPath) return
    setPending(true)
    try {
      // md 改由主进程按「读盘最新 json + 本次编辑」重渲（P1-3），渲染进程不再算 renderedMd 传入。
      const result = await submitChapterOutlineFieldEdit({
        projectPath,
        chapter,
        fieldKey: field.key,
        newValue: draft.trim(),
        expectedOldValue: field.value,
        itemIndex: field.itemIndex,
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

  /** 新格式（beat 骨架）数组字段（beats/must_deliver）单条行内编辑，结构复用上方 editable 行 JSX。 */
  function renderArrayItemRow(fieldKey: string, label: string, value: string, index: number) {
    const itemKey = `${fieldKey}:${index}`
    const isEditing = canEdit && isFirstTierChapterArrayField(fieldKey) && editingKey === itemKey
    return (
      <div
        key={itemKey}
        className="flex items-start justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-hover"
        data-chapter-outline-field={itemKey}
        data-chapter-outline-field-editable={canEdit && isFirstTierChapterArrayField(fieldKey) ? 'true' : undefined}
      >
        <div className="min-w-0 flex-1">
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          {isEditing ? (
            <div className="mt-1 flex flex-col gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                rows={3}
                className={`${READING_BODY_FONT_CLASS} leading-6`}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => save({ key: fieldKey, value, itemIndex: index })}
                  disabled={pending || !draft.trim()}
                >
                  {pending && <Loader2 className="size-3.5 animate-spin" />}
                  保存
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingKey(null)} disabled={pending}>
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <dd className={cn(`mt-1 ${READING_BODY_FONT_CLASS} leading-6 [overflow-wrap:anywhere] text-foreground`)}>
              {value}
            </dd>
          )}
        </div>
        {!isEditing && canEdit && isFirstTierChapterArrayField(fieldKey) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            data-chapter-outline-action="edit"
            onClick={() => {
              setEditingKey(itemKey)
              setDraft(value)
            }}
          >
            编辑
          </Button>
        )}
      </div>
    )
  }

  return (
    <ArtifactDocumentShell artifact={displayArtifact} title={displayArtifact.title}>
      <div data-chapter-outline-view="true">
        <h1 className="mb-6 text-xl font-semibold leading-tight text-foreground">
          {chapterLabel}
          {data.title ? `：${data.title}` : '细纲'}
        </h1>

        <dl className={GROUP_CLASS}>
          {editable.map((field) => {
            const isEditing = canEdit && isFirstTierChapterField(field.key) && editingKey === field.key
            return (
              <div
                key={field.key}
                className="flex items-start justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-hover"
                data-chapter-outline-field={field.key}
                data-chapter-outline-field-editable={canEdit && isFirstTierChapterField(field.key) ? 'true' : undefined}
              >
                <div className="min-w-0 flex-1">
                  <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
                  {isEditing ? (
                    <div className="mt-1 flex flex-col gap-2">
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        autoFocus
                        rows={3}
                        className={`${READING_BODY_FONT_CLASS} leading-6`}
                      />
                      <div className="flex gap-2">
                        <Button type="button" variant="default" size="sm" onClick={() => save(field)} disabled={pending || !draft.trim()}>
                          {pending && <Loader2 className="size-3.5 animate-spin" />}
                          保存
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditingKey(null)} disabled={pending}>
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <dd className={cn(`mt-1 ${READING_BODY_FONT_CLASS} leading-6 [overflow-wrap:anywhere] text-foreground`)}>
                      {field.value}
                    </dd>
                  )}
                </div>
                {!isEditing && canEdit && isFirstTierChapterField(field.key) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    data-chapter-outline-action="edit"
                    onClick={() => {
                      setEditingKey(field.key)
                      setDraft(field.value)
                    }}
                  >
                    编辑
                  </Button>
                )}
              </div>
            )
          })}
        </dl>

        {(data.beats ?? []).length > 0 && (
          <section className="mt-6 space-y-2" data-chapter-outline-beats="true">
            <h3 className="px-1 text-sm font-semibold text-foreground">节拍</h3>
            <dl className={GROUP_CLASS}>
              {(data.beats ?? []).map((beat, index) => renderArrayItemRow('beats', `节拍 ${index + 1}`, beat, index))}
            </dl>
          </section>
        )}
        {(data.must_deliver ?? []).length > 0 && (
          <section className="mt-6 space-y-2" data-chapter-outline-must-deliver="true">
            <h3 className="px-1 text-sm font-semibold text-foreground">必须交付</h3>
            <dl className={GROUP_CLASS}>
              {(data.must_deliver ?? []).map((item, index) => renderArrayItemRow('must_deliver', `第 ${index + 1} 条`, item, index))}
            </dl>
          </section>
        )}

        {projectPath && (
          <StateChangesLedger
            projectPath={projectPath}
            chapter={chapter}
            chapterWritten={Boolean(chapterWritten)}
            deferTargets={deferTargets}
            onChanged={onChanged}
          />
        )}

        {readonlyCore.length > 0 && (
          <dl className={cn(GROUP_CLASS, 'mt-4')}>
            {readonlyCore.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3 px-3 py-2.5" data-chapter-outline-readonly={label}>
                <div className="min-w-0 flex-1">
                  <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                  <dd className={`mt-1 ${READING_BODY_FONT_CLASS} leading-6 [overflow-wrap:anywhere] text-foreground`}>{value}</dd>
                </div>
              </div>
            ))}
          </dl>
        )}

        {(data.scenes ?? []).length > 0 && (
          <section className="mt-6 space-y-2" data-chapter-outline-scenes="true">
            <h3 className="px-1 text-sm font-semibold text-foreground">场景</h3>
            <div className="flex flex-col gap-3">
              {(data.scenes ?? []).map((scene, index) => (
                <div key={index} className="rounded-row border border-border bg-surface px-3 py-3">
                  <div className="text-sm font-medium text-foreground">
                    场景 {index + 1}
                    {scene.location ? ` · ${scene.location}` : ''}
                  </div>
                  {(scene.characters ?? []).some((c) => c.name) && (
                    <div className="mt-1 text-sm text-muted-foreground">
                      出场角色：{(scene.characters ?? []).map((c) => c.name).filter(Boolean).join('、')}
                    </div>
                  )}
                  {scene.pressure_point && <div className="mt-1 text-sm text-muted-foreground">压力点：{scene.pressure_point}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {(data.foreshadowing_touch ?? []).filter((t) => t.action?.trim()).length > 0 && (
          <section className="mt-6 space-y-2" data-chapter-outline-foreshadowing="true">
            <h3 className="px-1 text-sm font-semibold text-foreground">伏笔动作</h3>
            <dl className={cn(GROUP_CLASS)}>
              {(data.foreshadowing_touch ?? [])
                .filter((t) => t.action?.trim())
                .map((touch, index) => {
                  const actionLabel = getForeshadowingActionLabel(touch.action as string)
                  const desc = touch.id ? data.foreshadowingDescriptions?.[touch.id] : undefined
                  return (
                    <div key={index} className="px-3 py-2.5" data-chapter-outline-readonly="伏笔动作">
                      <dd className={`${READING_BODY_FONT_CLASS} leading-6 [overflow-wrap:anywhere] text-foreground`}>
                        {desc && desc.trim() ? `${actionLabel}：${desc.trim()}` : actionLabel}
                      </dd>
                    </div>
                  )
                })}
            </dl>
          </section>
        )}
      </div>
    </ArtifactDocumentShell>
  )
}
