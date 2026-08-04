import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, FormEvent, KeyboardEvent, RefObject } from 'react'
import { Loader2, SendHorizontal, Square, X } from 'lucide-react'
import { BrandIllustration } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { EMPTY_PRIMARY_BODY_CLASS, EMPTY_PRIMARY_TITLE_CLASS, READING_BODY_FONT_CLASS } from '@/design-system'
import { cn } from '@/lib/cn'
import { hydratePackWizardOnEnter, isWizardTerminalPhase, usePackWizardStore } from '@/lib/pack-wizard-store'
import type { PackWizardMessage } from '@/lib/pack-wizard-store'
import { WIZARD_INPUT_MAX_CHARS, WIZARD_INPUT_TOO_LONG_MESSAGE } from '@shared/types/capability-pack'
import type { PackWizardCardSummary, PackWizardPhase } from '@shared/types/capability-pack'

/** 开场说明（spec §1 两句话分工文案的向导那句，入口与开场共用同一句，避免两处漂移）。 */
export const WIZARD_INTRO_LINE = '把你脑子里的写法聊出来炼成卡——不需要范本书。'

/** 成本预期大白话（spec §7 口径：无整书阅读，按聊天计费）。 */
export const WIZARD_COST_LINE = '访谈按聊天计费，比从书学便宜得多。'

/** 贴片段轻提示（确定性触发，不靠模型；spec §3 拍板 3：轻提示不阻断，导出侧权利勾选兜底）。 */
export const WIZARD_PASTE_HINT_TEXT = '请确认粘贴的是你自己的文字——导出分享时需要你确认拥有分享权利。'

/** 向导在对话流里的名签（克制：只在欢迎块标一次，不逐条气泡重复）。 */
export const WIZARD_GUIDE_NAME = '写法向导'

/**
 * 本地欢迎段（确定性，非 store 消息）：在场即显示、不进 transcript，天然随会话恢复。
 * 承担旅程地图 + 时长预期（把「进度卡」需求的合理内核用零机械信号的诚实方式满足）。
 */
export const WIZARD_WELCOME_TEXT =
  '你好，我是你的写法向导。接下来我们聊几轮天：先聊聊你喜欢的写法和感觉，聊到位了我会试写几段小样让你挑，最后把你认可的写法整理成你自己的能力卡。大概需要几分钟，随时可以停。'

/** 开场页三步旅程极简说明行。 */
export const WIZARD_JOURNEY_LINE = '聊想法 → 试写你挑 → 炼成你的卡'

/** 粘贴文本超过 200 字才算「贴片段」，触发一次性轻提示；短粘贴（改错字/贴个词）不打扰。 */
export const WIZARD_LARGE_PASTE_THRESHOLD = 200

export function isLargePaste(text: string): boolean {
  return text.length > WIZARD_LARGE_PASTE_THRESHOLD
}

/**
 * 发送前超限预检（T6 评审 Minor-1）：超限拒发不截断——截断腰斩作者文字更不诚实。与主进程
 * pack-wizard.send 的兜底同源自 WIZARD_INPUT_MAX_CHARS（单一来源），这里就地提示不发送。
 */
export function isOverWizardInputLimit(text: string): boolean {
  return text.length > WIZARD_INPUT_MAX_CHARS
}

/**
 * 「正在停止…」本地态该不该重置：phase 落到终态（cancelled 解除禁用；撞车成 done/error 也解除，
 * 刀4 `shouldResetCancelling` 同族教训——停止和真实失败可能撞车，只认 cancelled 会把禁用态卡死
 * 带进「再来一次」后的下一场访谈），或 store 被 reset 回 null。纯函数，独立于 DOM 单测。
 */
export function shouldResetStopping(phase: PackWizardPhase | null): boolean {
  return phase === null || isWizardTerminalPhase(phase)
}

/** 非终态进行中指示文案：awaiting_user 轮到作者说话，无指示。 */
export const WIZARD_STATUS_TEXT: Partial<Record<PackWizardPhase, string>> = {
  preparing: '正在准备…',
  thinking: '正在想…',
  saving: '正在整理成卡…',
}

/**
 * 造包中心「作家向导」访谈视图（B2 刀5 Task 6）：把作者脑子里的写法聊出来，炼成能力卡草稿。
 *
 * 状态全读 `usePackWizardStore`（模块级会话，pack-learn-store 同款提升先例）：访谈是分钟级多轮
 * 会话，切去别的子视图再回来，消息流与进行到哪一步都必须还在。组件本地只管三样临时 UI 态——
 * 「正在停止…」禁用（T5 上游留言：store 无此标志，组件自管）、贴片段轻提示（每场访谈至多一次）、
 * composer 草稿文本。返回入口在设置页 titlebar 面包屑（导航规范 §9.8），本视图不放返回按钮。
 *
 * 取消出口两处（T5 评审 Minor-1 硬要求：全非终态可达取消，逃生链不许断）：composer 右侧按钮
 * 是单一插槽双态——awaiting_user 为发送箭头，preparing/thinking/saving 为停止方块；awaiting_user
 * 时插槽被发送占用，由会话头部常驻的「结束访谈」低调文字出口兜底（仅非终态渲染）。两处都直通
 * cancelWizard（store 侧无 phase 门，主进程 cancel 无条件可达终态）。若主进程 send invoke 永不
 * settle（模型流卡死），store 停在 thinking，此时插槽+头部两处均可停。
 */
export function WizardView({ onOpenDraft }: { onOpenDraft: (draftId: string) => void }) {
  // 进入即恢复（提示不如恢复）：主进程是会话单一真相源——store 里已持有会话就直接续用；
  // 否则挂载时水合（订阅先行 + 快照整体重建），页面重载后进行中/终态会话都原样回来。
  // 水合是一次 IPC 往返（毫秒级），`entering` 罩住「首帧到快照落地」的窗口渲染空白——
  // 闪一帧 loading 菊花比闪一帧空白更扎眼，也防止先闪开场页再跳成对话的视觉跳变。
  const [entering, setEntering] = useState(() => !usePackWizardStore.getState().started)
  useEffect(() => {
    let alive = true
    void hydratePackWizardOnEnter().finally(() => {
      if (alive) setEntering(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const messages = usePackWizardStore((state) => state.messages)
  const phase = usePackWizardStore((state) => state.phase)
  const draftId = usePackWizardStore((state) => state.draftId)
  const cardCount = usePackWizardStore((state) => state.cardCount)
  const cards = usePackWizardStore((state) => state.cards)
  const droppedCount = usePackWizardStore((state) => state.droppedCount)
  const error = usePackWizardStore((state) => state.error)
  const started = usePackWizardStore((state) => state.started)

  // 点了停止到 cancelled 事件回来之间的秒级窗口：立刻转禁用 + 「正在停止…」，诚实反馈防连点。
  const [stopping, setStopping] = useState(false)
  useEffect(() => {
    if (shouldResetStopping(phase)) setStopping(false)
  }, [phase])

  // 贴片段轻提示：每场访谈至多提示一次（shownRef 记「本场已提示过」，关闭提示条不重开）。
  const [pasteHintVisible, setPasteHintVisible] = useState(false)
  const pasteHintShownRef = useRef(false)

  // 新消息/阶段变化时把视口带到最新内容（设置页内容区是外层滚动容器，锚点跟随即可）。
  const bottomRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length, phase])

  const handleStart = useCallback(() => {
    usePackWizardStore.getState().startWizard()
  }, [])

  const handleSend = useCallback((text: string) => {
    usePackWizardStore.getState().sendMessage(text)
  }, [])

  const handleCancel = useCallback(() => {
    if (stopping) return
    setStopping(true)
    usePackWizardStore.getState().cancelWizard()
  }, [stopping])

  const handleRestart = useCallback(() => {
    usePackWizardStore.getState().resetWizard()
    setStopping(false)
    setPasteHintVisible(false)
    pasteHintShownRef.current = false
  }, [])

  const handleOpenDraft = useCallback(() => {
    const currentDraftId = usePackWizardStore.getState().draftId
    if (!currentDraftId) return
    // 进草稿即本场访谈收尾：清空会话，下次回向导从开场开始（刀4 handleOpenDraft 清 session 同律）。
    usePackWizardStore.getState().resetWizard()
    onOpenDraft(currentDraftId)
  }, [onOpenDraft])

  const handleLargePaste = useCallback(() => {
    if (pasteHintShownRef.current) return
    pasteHintShownRef.current = true
    setPasteHintVisible(true)
  }, [])

  if (entering) return null

  if (!started || phase === null) {
    return <WizardIntroStep onStart={handleStart} />
  }

  return (
    <WizardSessionView
      messages={messages}
      phase={phase}
      draftId={draftId}
      cardCount={cardCount}
      cards={cards}
      droppedCount={droppedCount}
      error={error}
      stopping={stopping}
      pasteHintVisible={pasteHintVisible}
      bottomRef={bottomRef}
      onCancel={handleCancel}
      onSend={handleSend}
      onLargePaste={handleLargePaste}
      onDismissPasteHint={() => setPasteHintVisible(false)}
      onOpenDraft={handleOpenDraft}
      onRestart={handleRestart}
    />
  )
}

/**
 * 访谈会话布局（ChatBot 式钉底）：全高 flex 列——头部「结束访谈」出口 shrink-0，消息区
 * `flex-1 overflow-y-auto`（从上往下、最新在下，进行中指示随消息流在底部附近），composer/终态页
 * 固定在最下方。全高链路由宿主保证（settings 页容器与包库面板 section 在 wizard 态转 flex 列）。
 * 只吃 props 不读 store——容器级状态分支的 SSR 证据从这里出：zustand v5 的 `useStore` 在服务端
 * 渲染走 `getInitialState` 快照，测试里 `setState` 摆出的状态对 `renderToStaticMarkup` 不可见，
 * 直接 SSR 容器断言不了分支。
 */
export function WizardSessionView({
  messages,
  phase,
  draftId,
  cardCount,
  cards = null,
  droppedCount = null,
  error,
  stopping,
  pasteHintVisible,
  bottomRef,
  onCancel,
  onSend,
  onLargePaste,
  onDismissPasteHint,
  onOpenDraft,
  onRestart,
}: {
  messages: PackWizardMessage[]
  phase: PackWizardPhase
  draftId: string | null
  cardCount: number | null
  cards?: PackWizardCardSummary[] | null
  droppedCount?: number | null
  error: string | null
  stopping: boolean
  pasteHintVisible: boolean
  bottomRef?: RefObject<HTMLDivElement | null>
  onCancel: () => void
  onSend: (text: string) => void
  onLargePaste: () => void
  onDismissPasteHint: () => void
  onOpenDraft: () => void
  onRestart: () => void
}) {
  const terminal = isWizardTerminalPhase(phase)

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" data-wizard-view="true">
      {!terminal ? (
        <div className="flex shrink-0 items-center justify-end">
          <WizardEndButton stopping={stopping} onCancel={onCancel} />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" data-wizard-conversation="true">
        <WizardWelcomeBlock />
        {messages.map((message, index) => (
          <WizardMessageRow key={index} message={message} />
        ))}
        <WizardStatusBubble phase={phase} />
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      {terminal ? (
        <div className="shrink-0">
          <WizardTerminalStep
            phase={phase as 'done' | 'error' | 'cancelled'}
            draftId={draftId}
            cardCount={cardCount}
            cards={cards}
            droppedCount={droppedCount}
            error={error}
            onOpenDraft={onOpenDraft}
            onRestart={onRestart}
          />
        </div>
      ) : (
        <div className="flex shrink-0 flex-col gap-2">
          {pasteHintVisible ? <WizardPasteHint onDismiss={onDismissPasteHint} /> : null}
          <WizardComposer
            canSend={phase === 'awaiting_user'}
            stopping={stopping}
            onSend={onSend}
            onCancel={onCancel}
            onLargePaste={onLargePaste}
          />
        </div>
      )}
    </section>
  )
}

/**
 * 头部「结束访谈」低调文字出口：所有非终态渲染且可点（T5 评审 Minor-1 逃生链要求——awaiting_user
 * 时 composer 插槽被发送态占用，这里是唯一取消入口）；点击后本地 `stopping` 转禁用 + 「正在停止…」
 * （取消不是瞬时的，诚实反馈防连点），cancelled 终态到达后由容器解除。
 */
export function WizardEndButton({ stopping, onCancel }: { stopping: boolean; onCancel: () => void }) {
  return (
    <button
      type="button"
      disabled={stopping}
      className="text-xs leading-5 text-muted-foreground transition-colors duration-200 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      data-wizard-end-trigger="true"
      onClick={onCancel}
    >
      {stopping ? '正在停止…' : '结束访谈'}
    </button>
  )
}

/** 向导头像（角色聊天 ChatAvatar 同形态先例）：圆形 + 品牌插图，装饰性、语义由旁边文字承担。 */
export function WizardAvatar() {
  return (
    <span
      aria-hidden="true"
      className="-mt-1 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-brand/10"
      data-wizard-avatar="true"
    >
      <BrandIllustration purpose="wizard-guide" size="sm" className="size-7" decorative />
    </span>
  )
}

/**
 * 欢迎块：头像 + 「写法向导」名签 + 旅程说明（确定性本地渲染，非 store 消息）。永远是消息流
 * 第一块——在场即显示、不进 transcript，页面重载水合后天然还在，向导的自我介绍不吃模型 token。
 */
export function WizardWelcomeBlock() {
  return (
    <div className="flex w-full items-start justify-start gap-2.5" data-wizard-welcome="true">
      <WizardAvatar />
      <div className="flex min-w-0 max-w-[84%] flex-col items-start gap-1.5 sm:max-w-[620px]">
        <span className="px-1 text-xs font-medium text-foreground/80">{WIZARD_GUIDE_NAME}</span>
        <div
          className={`whitespace-pre-wrap break-words rounded-panel border border-border bg-workspace px-3.5 py-2.5 text-foreground ${READING_BODY_FONT_CLASS} leading-6`}
        >
          {WIZARD_WELCOME_TEXT}
        </div>
      </div>
    </div>
  )
}

/** 开场页（空状态规范：插图 + 标题 + 正文 + 一个主按钮）。纯展示，SSR 断言文案逐字。 */
export function WizardIntroStep({ onStart }: { onStart: () => void }) {
  return (
    <section
      className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-row border border-dashed border-border px-4 py-12 text-center"
      data-wizard-intro-step="true"
    >
      <BrandIllustration purpose="wizard-journey" size="md" decorative />
      <h2 className={EMPTY_PRIMARY_TITLE_CLASS}>作家向导</h2>
      <p className={cn(EMPTY_PRIMARY_BODY_CLASS, 'max-w-sm')}>{WIZARD_INTRO_LINE}</p>
      <p className="text-xs leading-5 text-muted-foreground">{WIZARD_JOURNEY_LINE}</p>
      <p className="text-xs leading-5 text-muted-foreground">{WIZARD_COST_LINE}</p>
      <div className="mt-3">
        <Button type="button" data-wizard-start-trigger="true" onClick={onStart}>
          开始
        </Button>
      </div>
    </section>
  )
}

/**
 * 消息行：作者右（实色气泡）/ 向导左（头像 + 描边气泡），视觉语言对齐角色聊天先例（不复用其
 * store）。名签不逐条标（克制）——「写法向导」只在欢迎块出现一次，头像已足够承担身份连续性。
 */
export function WizardMessageRow({ message }: { message: PackWizardMessage }) {
  const isUser = message.role === 'user'
  if (isUser) {
    return (
      <div className="flex w-full justify-end" data-wizard-message="user">
        <div
          className={`max-w-[84%] whitespace-pre-wrap break-words rounded-panel bg-foreground px-3.5 py-2.5 text-background sm:max-w-[620px] ${READING_BODY_FONT_CLASS} leading-6`}
        >
          {message.text}
        </div>
      </div>
    )
  }
  return (
    <div className="flex w-full items-start justify-start gap-2.5" data-wizard-message="assistant">
      <WizardAvatar />
      <div
        className={`min-w-0 max-w-[84%] whitespace-pre-wrap break-words rounded-panel border border-border bg-workspace px-3.5 py-2.5 text-foreground sm:max-w-[620px] ${READING_BODY_FONT_CLASS} leading-6`}
      >
        {message.text}
      </div>
    </div>
  )
}

/**
 * 进行中指示气泡：preparing/thinking/saving 各一句；awaiting_user（轮到作者）与终态不渲染。
 * 挂在头像旁——「对方正在输入」的心智（角色聊天 TypingBubble 同形态先例）。
 */
export function WizardStatusBubble({ phase }: { phase: PackWizardPhase | null }) {
  const text = phase ? WIZARD_STATUS_TEXT[phase] : undefined
  if (!text) return null
  return (
    <div className="flex w-full items-start justify-start gap-2.5" data-wizard-status={phase} role="status">
      <WizardAvatar />
      <div className="flex items-center gap-2 rounded-panel border border-border bg-workspace px-3.5 py-2.5 text-sm leading-6 text-muted-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        {text}
      </div>
    </div>
  )
}

/** 贴片段轻提示条：可关闭、不阻断（触发时机由容器管——每场访谈至多一次）。 */
export function WizardPasteHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="flex items-start justify-between gap-2 rounded-row border border-warning/30 bg-warning/10 px-3 py-2"
      data-wizard-paste-hint="true"
    >
      <p className="text-xs leading-5 text-warning">{WIZARD_PASTE_HINT_TEXT}</p>
      <button
        type="button"
        aria-label="知道了"
        className="shrink-0 text-warning transition-colors hover:text-foreground"
        data-wizard-paste-hint-dismiss="true"
        onClick={onDismiss}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * 输入区：Enter 发送 / Shift+Enter 换行（角色聊天 Composer 同惯例）。右侧按钮是单一插槽双态：
 * `canSend`（awaiting_user）为发送箭头；向导在准备/在想/在整理时同位同尺寸换成停止方块，点击
 * 直通 cancelWizard，`stopping` 时禁用转菊花（「正在停止…」由 aria-label 承载，icon 按钮不塞
 * 文字）。停止态下输入框保留可打字（先把话打好），Enter 不受理——发送门在 store 侧还有一道
 * phase 校验，这里只做诚实的禁用反馈。粘贴超过阈值回调 `onLargePaste`（确定性，不看内容）。
 */
export function WizardComposer({
  canSend,
  stopping,
  onSend,
  onCancel,
  onLargePaste,
}: {
  canSend: boolean
  stopping: boolean
  onSend: (text: string) => void
  onCancel: () => void
  onLargePaste: () => void
}) {
  const [value, setValue] = useState('')
  const overLimit = isOverWizardInputLimit(value)

  function submit() {
    const trimmed = value.trim()
    if (!trimmed || !canSend || overLimit) return
    onSend(trimmed)
    setValue('')
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing 守卫（T6 评审 Minor-3）：中文输入法组合期按 Enter 是确认候选词，不是发送。
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (isLargePaste(event.clipboardData.getData('text'))) onLargePaste()
  }

  return (
    <>
      {overLimit ? (
        <p className="px-1 text-xs leading-5 text-warning" data-wizard-input-too-long="true">
          {WIZARD_INPUT_TOO_LONG_MESSAGE}
        </p>
      ) : null}
      <form
        className="flex items-center gap-2 rounded-panel border border-border bg-workspace p-2"
        data-wizard-composer="true"
        onSubmit={handleSubmit}
      >
        <textarea
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="和向导聊你的写法…"
          aria-label="和向导聊你的写法"
          className="max-h-32 min-h-8 flex-1 resize-none border-0 bg-transparent px-2 py-1 text-sm leading-6 text-foreground outline-none placeholder:text-hint-foreground focus-visible:ring-0"
        />
        {canSend ? (
          <Button
            type="submit"
            size="icon-sm"
            className="self-center"
            disabled={value.trim().length === 0 || overLimit}
            aria-label="发送"
            data-wizard-send="true"
          >
            <SendHorizontal className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon-sm"
            className="self-center"
            disabled={stopping}
            aria-label={stopping ? '正在停止…' : '停止'}
            data-wizard-cancel-trigger="true"
            onClick={onCancel}
          >
            {stopping ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Square className="size-3.5 fill-current" aria-hidden="true" />
            )}
          </Button>
        )}
      </form>
    </>
  )
}

/** done 摘要里「典型场景零命中」的卡数（previewHits=null 是「没测出来」，不算零命中）。纯函数供 SSR 外单测。 */
export function countZeroHitCards(cards: PackWizardCardSummary[] | null | undefined): number {
  return (cards ?? []).filter((card) => card.previewHits === 0).length
}

/** done 摘要里没编译成功的卡数。纯函数供 SSR 外单测。 */
export function countUncompiledCards(cards: PackWizardCardSummary[] | null | undefined): number {
  return (cards ?? []).filter((card) => !card.compiled).length
}

/**
 * 终态页（终态无死路，刀4 完成页教训）：
 * - done + draftId：主按钮「查看草稿」进编辑器 + 次级「再来一次」；主口径「为你炼出 N 张卡」外，
 *   按卡级摘要如实追加（诚实完成页，对齐刀3 §5.3 无出场警示）：有典型场景零命中的卡 / 有没编译
 *   成功的卡 / 有因格式不完整被放弃的卡时各一行克制提示，全好则零多余文字；
 * - done + draftId=null（空卡，T5 上游契约：空卡判定 = done 且 draftId===null）：没聊出可炼的写法，
 *   原因向导在对话里已经说了，提示往上看最后一条消息 + 「再来一次」；
 * - error：人话原因 + 「再来一次」；cancelled：一句确认 + 「再来一次」。
 * 纯展示，SSR 按 props 断言四个分支。
 */
export function WizardTerminalStep({
  phase,
  draftId,
  cardCount,
  cards = null,
  droppedCount = null,
  error,
  onOpenDraft,
  onRestart,
}: {
  phase: 'done' | 'error' | 'cancelled'
  draftId: string | null
  cardCount: number | null
  cards?: PackWizardCardSummary[] | null
  droppedCount?: number | null
  error: string | null
  onOpenDraft: () => void
  onRestart: () => void
}) {
  if (phase === 'done' && draftId) {
    const zeroHitCount = countZeroHitCards(cards)
    const uncompiledCount = countUncompiledCards(cards)
    return (
      <section
        className="flex flex-col items-center justify-center gap-2 rounded-row border border-dashed border-border px-4 py-10 text-center"
        data-wizard-done-step="true"
      >
        <WizardAvatar />
        <h2 className={EMPTY_PRIMARY_TITLE_CLASS}>为你炼出 {cardCount ?? 0} 张卡</h2>
        <p className={EMPTY_PRIMARY_BODY_CLASS}>去草稿工程逐张看看，改到顺手了再发布。</p>
        {zeroHitCount > 0 && (
          <p className="max-w-sm text-xs leading-5 text-warning" data-wizard-zero-hit-warning="true">
            其中 {zeroHitCount} 张在典型场景里暂时不会出场——去草稿里把「什么时候用」说得更具体。
          </p>
        )}
        {uncompiledCount > 0 && (
          <p className="max-w-sm text-xs leading-5 text-warning" data-wizard-uncompiled-warning="true">
            {uncompiledCount} 张卡还没编译成功，发布前需要联网重试。
          </p>
        )}
        {(droppedCount ?? 0) > 0 && (
          <p className="max-w-sm text-xs leading-5 text-muted-foreground" data-wizard-dropped-note="true">
            有 {droppedCount} 张卡因格式不完整被放弃。
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button type="button" data-wizard-open-draft-trigger="true" onClick={onOpenDraft}>
            查看草稿
          </Button>
          <Button type="button" variant="secondary" data-wizard-restart-trigger="true" onClick={onRestart}>
            再来一次
          </Button>
        </div>
      </section>
    )
  }

  const message =
    phase === 'done'
      ? '这次没聊出可炼的写法——为什么没聊出来，向导在上面最后一条消息里说了。'
      : phase === 'error'
        ? (error ?? '访谈没跑完，请重试。')
        : '访谈已停止。'

  return (
    <section
      className="flex flex-col items-center justify-center gap-2 rounded-row border border-dashed border-border px-4 py-10 text-center"
      data-wizard-ended-step={phase}
    >
      <p className={EMPTY_PRIMARY_BODY_CLASS}>{message}</p>
      <div className="mt-3">
        <Button type="button" data-wizard-restart-trigger="true" onClick={onRestart}>
          再来一次
        </Button>
      </div>
    </section>
  )
}
