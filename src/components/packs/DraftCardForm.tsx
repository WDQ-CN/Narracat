import { useState } from 'react'
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { METADATA_TEXT_CLASS, MUTED_PILL_CLASS, SUCCESS_PILL_CLASS } from '@/design-system'
import { cn } from '@/lib/cn'
import { STRUCTURE_STAGE_LABELS, type DraftCard, type StructureStage } from '@shared/types/capability-pack'
import type { CompileDraftCardResult, PreviewDraftCardResult } from '@shared/types/ipc'
import { CARD_TYPE_LABELS } from './pack-card-labels'

/** 展示序（叙事时间线）：开局→全书→逐章，与 `STRUCTURE_STAGES`（数据声明序）不同。 */
const STAGE_DISPLAY_ORDER: StructureStage[] = ['stage-opening', 'stage-1', 'stage-2']

/**
 * 剧作卡选中阶段后的即时说明——本地映射秒出，不走 LLM「理解中」loading（那一闪是用户反馈的闪烁源）。
 * 比旧文案「X 阶段的编排方法」多告诉一句「什么时候会用到」，对作者更有信息量。
 */
const STRUCTURE_ECHO_BY_STAGE: Record<StructureStage, string> = {
  'stage-opening': '规划全书开局时，这张卡会进入架构师的编排清单。',
  'stage-1': '规划书级主线与卷纲时，这张卡会进入架构师的编排清单。',
  'stage-2': '规划每章细纲时，这张卡会进入架构师的编排清单。',
}

/** 意图输入的场景引导语，按真实消费链分语义（spec §5.2）——不为三类卡伪造统一措辞。 */
const INTENT_LABEL_BY_TYPE: Record<'persona' | 'craft', string> = {
  persona: '适合什么样的叙述风格、什么气质的书',
  craft: '适合什么场景、不适合什么场景',
}

/**
 * 每类卡的占位示例——小白第一次进来照着例子就知道每格填什么（用户 dogfood 反馈：空表单不知填什么）。
 * 全部用「例：…」真实样例，覆盖卡名/一句话/正文/意图四格；structure 无意图输入框（分段控件）。
 */
const CARD_PLACEHOLDERS: Record<
  DraftCard['type'],
  { name: string; oneLine: string; body: string; intent?: string }
> = {
  persona: {
    name: '例：毒舌吐槽',
    oneLine: '例：说书人视角、爱吐槽的接地气幽默腔',
    body: '把这个「声音」讲清楚：说话什么语气、什么节奏、爱用什么词、回避什么。\n\n例：以说书人的姿态讲故事，时不时跳出来吐槽两句。句子短促明快，爱用接地气的比喻；紧张处也不端着，用调侃消解沉重。忌书面腔、忌堆砌华丽辞藻。',
    intent: '例：轻松诙谐的都市、搞笑向玄幻，节奏明快的书',
  },
  craft: {
    name: '例：打脸三段式',
    oneLine: '例：让打脸更爽的三段铺垫法',
    body: '把这个写法讲给另一位作者听：什么情况下怎么做、为什么有效。\n\n例：打脸前先让对手把话说满、气焰拉到顶，主角再用一句话戳破，不解释、不还嘴，让反差自己说话。',
    intent: '例：打脸、爽点兑现的场景用；过渡日常章不用',
  },
  structure: {
    name: '例：黄金开局三章',
    oneLine: '例：开头三章怎么留住读者',
    body: '把这条章法讲清楚：在哪个阶段、要达成什么。\n\n例：开头三章必须完成三件事——抛出一个钩子、亮出主角的独特之处、埋一个让人想追下去的悬念。',
  },
}

const FIELD_LABEL_CLASS = 'text-xs font-medium leading-5 text-muted-foreground'

const SEGMENTED_OPTION_CLASS =
  'flex h-8 items-center justify-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-hover hover:text-foreground active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-workspace data-[active=true]:text-foreground data-[active=true]:shadow-[var(--shadow-workspace)] data-[active=true]:hover:bg-workspace'

/**
 * 三类卡分语义写卡表单（B2 刀3 spec §5.2）：共用「卡名+一句话/正文/意图」骨架，但意图输入与预览
 * 按真实消费链分语义——腔调卡（persona）配文本意图+让系统理解；写法卡（craft）同款但预览语义是
 * 场景竞争；剧作卡（structure）零 LLM，三选一分段控件选中即写 intent 并本地触发编译。
 *
 * 编译（「让系统理解」）/预演（「看看出场」）结果是本组件内的临时展示态：父层用 `key={card.cardId}`
 * 挂载，切换选中卡即天然重置，不额外持久化到 DraftCard。持久化字段变更经 `onChange` 冒泡给父层
 * 防抖保存；`onBlur` 触发失焦立即保存（同 PremiseCardsView 的 draft state 先例）。
 */
export function DraftCardForm({
  card,
  onChange,
  onBlur,
  onCompile,
  onPreview,
}: {
  card: DraftCard
  onChange: (patch: Partial<DraftCard>) => void
  onBlur: () => void
  onCompile: () => Promise<CompileDraftCardResult>
  onPreview: () => Promise<PreviewDraftCardResult>
}) {
  const [compileBusy, setCompileBusy] = useState(false)
  const [compileError, setCompileError] = useState<string | null>(null)
  // 「已编译意图」快照：与当前 card.intent 不一致即视为过期（灰态提示）。挂载时若已有编译产物，
  // 假定它对应当前意图（草稿多半是上次会话留下的现状，没有证据说明它已经过期）。
  const [compiledIntentSnapshot, setCompiledIntentSnapshot] = useState<string | null>(
    card.compiled ? card.intent : null,
  )
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<PreviewDraftCardResult | null>(null)

  const isStale = Boolean(card.compiled) && compiledIntentSnapshot !== null && compiledIntentSnapshot !== card.intent

  // silent：剧作卡选阶段是本地即时映射（结果立刻本地渲染），后台只需静默存 compiled，不闪 loading。
  async function runCompile(intentSnapshot: string, opts?: { silent?: boolean }) {
    if (!opts?.silent) setCompileBusy(true)
    setCompileError(null)
    try {
      const result = await onCompile()
      if (result.status === 'ok') setCompiledIntentSnapshot(intentSnapshot)
      else setCompileError(result.message)
    } catch {
      setCompileError('系统理解失败，请重试。')
    } finally {
      if (!opts?.silent) setCompileBusy(false)
    }
  }

  function handleSelectStage(stage: StructureStage) {
    if (card.intent === stage) return
    onChange({ intent: stage })
    void runCompile(stage, { silent: true })
  }

  async function handlePreviewClick() {
    if (previewBusy) return
    setPreviewBusy(true)
    setPreviewError(null)
    try {
      const result = await onPreview()
      if (result.status === 'ok') {
        setPreviewResult(result)
      } else {
        setPreviewResult(null)
        setPreviewError(result.message)
      }
    } catch {
      setPreviewError('看看出场失败，请重试。')
    } finally {
      setPreviewBusy(false)
    }
  }

  return (
    <div className="space-y-5" data-draft-card-form={card.cardId}>
      <span className={MUTED_PILL_CLASS}>{CARD_TYPE_LABELS[card.type]}</span>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className={FIELD_LABEL_CLASS} htmlFor={`draft-card-name-${card.cardId}`}>
            卡名
          </label>
          <Input
            id={`draft-card-name-${card.cardId}`}
            value={card.name}
            placeholder={CARD_PLACEHOLDERS[card.type].name}
            onChange={(event) => onChange({ name: event.target.value })}
            onBlur={onBlur}
          />
        </div>
        <div className="space-y-1.5">
          <label className={FIELD_LABEL_CLASS} htmlFor={`draft-card-oneline-${card.cardId}`}>
            一句话
          </label>
          <Input
            id={`draft-card-oneline-${card.cardId}`}
            value={card.oneLine}
            placeholder={CARD_PLACEHOLDERS[card.type].oneLine}
            onChange={(event) => onChange({ oneLine: event.target.value })}
            onBlur={onBlur}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className={FIELD_LABEL_CLASS} htmlFor={`draft-card-body-${card.cardId}`}>
          正文
        </label>
        <Textarea
          id={`draft-card-body-${card.cardId}`}
          value={card.body}
          placeholder={CARD_PLACEHOLDERS[card.type].body}
          rows={8}
          className="text-sm leading-6"
          onChange={(event) => onChange({ body: event.target.value })}
          onBlur={onBlur}
        />
      </div>

      <div className="space-y-1.5" data-draft-card-intent={card.type}>
        {card.type === 'structure' ? (
          <>
            <label className={FIELD_LABEL_CLASS}>用在哪个规划层面</label>
            <div className="grid grid-cols-3 gap-1 rounded-row bg-active p-1">
              {STAGE_DISPLAY_ORDER.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  data-active={card.intent === stage}
                  aria-pressed={card.intent === stage}
                  data-draft-stage-option={stage}
                  disabled={compileBusy}
                  className={SEGMENTED_OPTION_CLASS}
                  onClick={() => handleSelectStage(stage)}
                >
                  {STRUCTURE_STAGE_LABELS[stage]}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <label className={FIELD_LABEL_CLASS} htmlFor={`draft-card-intent-${card.cardId}`}>
              {INTENT_LABEL_BY_TYPE[card.type]}
            </label>
            <div className="flex items-center gap-2">
              <Input
                id={`draft-card-intent-${card.cardId}`}
                className="flex-1"
                value={card.intent}
                placeholder={CARD_PLACEHOLDERS[card.type].intent}
                onChange={(event) => onChange({ intent: event.target.value })}
                onBlur={onBlur}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={compileBusy || !card.intent.trim()}
                data-draft-compile-trigger={card.cardId}
                onClick={() => void runCompile(card.intent)}
              >
                {compileBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                让系统理解
              </Button>
            </div>
          </>
        )}

        {compileError && (
          <p className="text-xs leading-5 text-destructive" data-draft-compile-error="true">
            {compileError}
          </p>
        )}

        {card.type === 'structure'
          ? card.intent && (
              <div
                className="rounded-row border border-border bg-surface px-3 py-2.5 text-sm leading-6 text-foreground"
                data-draft-compiled-echo="fresh"
              >
                <p>
                  系统的理解：
                  {STRUCTURE_ECHO_BY_STAGE[card.intent as StructureStage] ??
                    `${STRUCTURE_STAGE_LABELS[card.intent as StructureStage] ?? card.intent}阶段的编排方法。`}
                </p>
              </div>
            )
          : card.compiled && (
              <div
                className={cn(
                  'rounded-row border px-3 py-2.5 text-sm leading-6',
                  isStale ? 'border-border bg-active text-muted-foreground' : 'border-border bg-surface text-foreground',
                )}
                data-draft-compiled-echo={isStale ? 'stale' : 'fresh'}
              >
                {isStale && <p className={cn(MUTED_PILL_CLASS, 'mb-1.5 inline-flex')}>已过期，重新让系统理解</p>}
                <p>{card.compiled.echo}</p>
              </div>
            )}
      </div>

      <div className="space-y-2 border-t border-border pt-4" data-draft-card-preview="true">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={previewBusy}
          data-draft-preview-trigger={card.cardId}
          onClick={() => void handlePreviewClick()}
        >
          {previewBusy && <Loader2 className="size-3.5 animate-spin" />}
          看看出场
        </Button>

        {previewError && (
          <p className="text-xs leading-5 text-destructive" data-draft-preview-error="true">
            {previewError}
          </p>
        )}

        {previewResult?.status === 'ok' && <PreviewResultView result={previewResult} />}

        <p className={METADATA_TEXT_CLASS}>以上是常见场景的预演；你的书实际用了哪些卡，以每章的能力回执为准。</p>
      </div>
    </div>
  )
}

function PreviewResultView({ result }: { result: Extract<PreviewDraftCardResult, { status: 'ok' }> }) {
  if (result.kind === 'structure') {
    const label = STRUCTURE_STAGE_LABELS[result.stage as StructureStage] ?? result.stage
    return (
      <p className="text-sm leading-6 text-foreground" data-draft-preview-result="structure">
        规划到「{label}」阶段时，系统的编排清单里会有这张卡。
      </p>
    )
  }

  const noAppearance = result.results.every((entry) => !entry.selected)

  return (
    <div className="space-y-2" data-draft-preview-result={result.kind}>
      {result.kind === 'craft' && <p className="text-sm leading-6 text-foreground">这些场景会带上它：</p>}
      {noAppearance && (
        <div
          className="flex items-start gap-2 rounded-row border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning"
          data-draft-preview-no-appearance="true"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>这张卡在常见场景都不会出场，试试把「什么时候用」说得更具体。</span>
        </div>
      )}
      <ul className="space-y-1.5">
        {result.results.map((entry) => (
          <li
            key={entry.id}
            className="flex items-start justify-between gap-3 rounded-row border border-border bg-surface px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm leading-6 text-foreground">{entry.name}</p>
              {entry.reason && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{entry.reason}</p>}
            </div>
            <span className={entry.selected ? SUCCESS_PILL_CLASS : MUTED_PILL_CLASS}>
              {entry.selected ? '会选中' : '不选'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
