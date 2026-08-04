import { motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'

// 连续性审修 Agent 插图：评估改动对已写章节的级联影响 = 连续性/一致性核查，语义最贴该 Agent。
const continuityEditorImageUrl = new URL(
  '../../assets/illustrations/agents/continuity-editor.webp',
  import.meta.url,
).href

/**
 * 通用「保存并评估影响」浮动 dock：用于任何需要 Agent 评估一处改动级联影响的场景
 * （立项卡第二档，将来大纲 / 角色等同理）。**刻意不显示具体改动内容**——保持通用，
 * 具体改动随提交动作（onEvaluate 内构造的 prompt）发给 Agent，不在 dock 上呈现。
 *
 * 表现：sticky 贴内容面板底部上提、浮于正文之上（高 z + 深阴影提升视觉重心）；framer 弹出动画；
 * 左侧 Agent 插图破形高出 dock 顶部。宽度独立于阅读列、居中铺开，避免被阅读列宽度剪切。
 */
export function ImpactEvaluationDock({
  title = '审校编辑提醒',
  message = '这处改动可能影响已写的章节，需要 Agent 评估后才生效。',
  actionLabel = '保存并评估影响',
  disabled,
  onEvaluate,
}: {
  title?: string
  message?: string
  actionLabel?: string
  disabled?: boolean
  onEvaluate: () => void
}) {
  const reduceMotion = useReducedMotion()

  return (
    <div
      className="pointer-events-none sticky bottom-6 z-30 mt-6 flex justify-center px-4"
      data-impact-evaluation-dock="true"
    >
      <motion.div
        className="
          pointer-events-auto relative flex w-full max-w-[960px] items-center gap-3 rounded-panel
          border border-border bg-surface py-4 pl-24 pr-4
          shadow-[var(--shadow-floating-strong)]
        "
        initial={reduceMotion ? false : { opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', duration: 0.42, bounce: 0.34 }}
      >
        {/* Agent 插图破形：放大 + 底对齐（人物脚踩 dock 下边缘，-bottom 微调抵消画面底部留白），上身高出 dock 上沿。 */}
        <img
          src={continuityEditorImageUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          loading="lazy"
          decoding="async"
          className="pointer-events-none absolute -bottom-1.5 left-3 h-32 w-20 object-contain [filter:drop-shadow(0_6px_10px_rgba(0,0,0,0.3))]"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-6 text-foreground">{title}</p>
          <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{message}</p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          data-impact-evaluate="true"
          disabled={disabled}
          onClick={onEvaluate}
        >
          {actionLabel}
        </Button>
      </motion.div>
    </div>
  )
}
