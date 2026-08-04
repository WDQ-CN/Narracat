import { ArrowDown, Loader2 } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useRef, useState, type UIEvent } from 'react'
import { BrandIllustration } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EMPTY_PRIMARY_BODY_CLASS, EMPTY_PRIMARY_TITLE_CLASS } from '@/design-system'
import { AgentMessageItem } from './AgentMessageItem'
import { useAgentStore } from '@/lib/agent-store'
import { getAgentThreadSnapshot } from '@/lib/ipc'
import type { AgentMessage } from '@shared/types/agent'

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64

export function AgentThreadView({ threadId }: { threadId?: string } = {}) {
  const activeThreadId = useAgentStore((state) => state.activeThreadId)
  const scopedThreadId = threadId ?? activeThreadId
  const thread = useAgentStore((state) => state.threadsById[scopedThreadId])
  const messages = thread?.messages ?? []
  const deferredMessages = useDeferredValue(messages)

  return <AgentThreadContent messages={deferredMessages} threadId={scopedThreadId} />
}

export function AgentThreadContent({ messages, threadId }: { messages: AgentMessage[]; threadId?: string }) {
  const threadEndRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottomRef = useRef(true)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const activeThreadId = useAgentStore((state) => state.activeThreadId)
  const scopedThreadId = threadId ?? activeThreadId
  const focusedQuestionRequestId = useAgentStore((state) => state.focusedQuestionRequestIdsByThreadId[scopedThreadId])
  const clearFocusedQuestionRequest = useAgentStore((state) => state.clearFocusedQuestionRequest)
  const previousSegmentId = useAgentStore((state) => state.previousSegmentIdByThreadId[scopedThreadId])
  const hasUnreadableHistory = useAgentStore((state) => state.unreadableHistoryByThreadId[scopedThreadId])
  const prependHistorySnapshot = useAgentStore((state) => state.prependHistorySnapshot)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const loadPreviousConversation = useCallback(() => {
    if (!previousSegmentId || loadingHistory) return
    setLoadingHistory(true)
    void getAgentThreadSnapshot(scopedThreadId, previousSegmentId)
      .then((snapshot) => prependHistorySnapshot(snapshot))
      .catch((error) => console.error(error))
      .finally(() => setLoadingHistory(false))
  }, [loadingHistory, prependHistorySnapshot, previousSegmentId, scopedThreadId])

  const updateStickyScrollState = useCallback((viewport: HTMLElement | null) => {
    if (!viewport) return

    const isNearBottom = isAgentThreadNearBottom(viewport)
    shouldStickToBottomRef.current = isNearBottom
    setShowJumpToLatest(!isNearBottom)
  }, [])

  const handleViewportScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      updateStickyScrollState(event.currentTarget)
    },
    [updateStickyScrollState],
  )

  const scrollToLatest = useCallback(() => {
    shouldStickToBottomRef.current = true
    setShowJumpToLatest(false)
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [])

  useEffect(() => {
    shouldStickToBottomRef.current = true
    setShowJumpToLatest(false)
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [scopedThreadId])

  // 唯一钉底司机：流式增长、消息新增、过程块折叠、占位还原……全部表现为内容高度变化。
  // 贴底时直接钉 scrollTop（不用 scrollIntoView，避免连带滚动祖先容器）；
  // 用户上滑后 shouldStickToBottomRef=false，只亮「最新」按钮，不打扰。
  // 依赖 hasMessages：空线程 mount 时走空状态分支，contentRef 为 null，observer 挂不上；
  // 首条消息出现（空→非空）后必须重跑一次才能真正 observe（dogfood #1：对话流完全不跟随的断点）。
  const hasMessages = messages.length > 0
  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      const viewport = viewportRef.current
      if (!viewport) return
      if (shouldStickToBottomRef.current) {
        viewport.scrollTop = viewport.scrollHeight
        return
      }
      if (!isAgentThreadNearBottom(viewport)) setShowJumpToLatest(true)
    })
    observer.observe(content)

    return () => observer.disconnect()
  }, [hasMessages])

  useEffect(() => {
    if (!focusedQuestionRequestId) return

    const questionCard = findAgentQuestionCard(focusedQuestionRequestId)
    if (!questionCard) return

    questionCard.scrollIntoView({ block: 'center', inline: 'nearest' })
    questionCard.focus({ preventScroll: true })
    clearFocusedQuestionRequest(scopedThreadId)
  }, [clearFocusedQuestionRequest, focusedQuestionRequestId, scopedThreadId, messages])

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10 text-center">
        <div className="mx-auto flex max-w-[280px] flex-col items-center">
          <BrandIllustration purpose="agent-ready" size="lg" decorative className="mb-4" />
          <div className={EMPTY_PRIMARY_TITLE_CLASS}>准备开始创作</div>
          <p className={`mt-2 ${EMPTY_PRIMARY_BODY_CLASS}`}>
            选择一个指令，或直接描述你想推进的章节，Agent 会在这里整理思路并持续输出。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-0 min-w-0 max-w-full flex-1">
      <ScrollArea
        className="h-full min-h-0 min-w-0 max-w-full flex-1 overflow-hidden"
        viewportRef={viewportRef}
        onViewportScroll={handleViewportScroll}
      >
        <div ref={contentRef} className="min-w-0 w-full max-w-full overflow-x-hidden [overflow-anchor:none] space-y-8 p-5 pb-6">
          {(previousSegmentId || hasUnreadableHistory) && (
            <div className="flex flex-col items-center gap-2 text-center">
              {previousSegmentId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loadingHistory}
                  onClick={loadPreviousConversation}
                >
                  {loadingHistory && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                  查看之前的对话
                </Button>
              )}
              {hasUnreadableHistory && (
                <p className="text-xs text-muted-foreground">有一段历史记录损坏，已隔离；其它对话仍可继续使用。</p>
              )}
            </div>
          )}
          {messages.map((message) => (
            <AgentMessageItem key={message.id} message={message} threadId={scopedThreadId} />
          ))}
          <div ref={threadEndRef} data-agent-thread-end="true" aria-hidden="true" />
        </div>
      </ScrollArea>
      {showJumpToLatest && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-surface/95 px-3 shadow-panel backdrop-blur"
          data-agent-jump-to-latest="true"
          onClick={scrollToLatest}
        >
          <ArrowDown className="size-3.5" />
          最新
        </Button>
      )}
    </div>
  )
}

function findAgentQuestionCard(questionRequestId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null

  const cards = document.querySelectorAll<HTMLElement>('[data-agent-question-card]')
  for (const card of cards) {
    if (card.dataset.agentQuestionCard === questionRequestId) return card
  }

  return null
}

export function isAgentThreadNearBottom(
  viewport: Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>,
  thresholdPx = AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= thresholdPx
}
