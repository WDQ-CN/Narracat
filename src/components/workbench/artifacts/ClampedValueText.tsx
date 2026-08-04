import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** 单条值超过该字符数即单行截断 + 悬停看全文（spec 2026-08-03 §4.4 防线②） */
export const VALUE_CLAMP_THRESHOLD = 24

export function ClampedValueText({ text }: { text: string }) {
  if (text.length <= VALUE_CLAMP_THRESHOLD) return <span>{text}</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* 宽度交给容器：吃满可用行宽、顶到边缘才截断（写死 max-w 会在行还有大片空白时提前砍字） */}
        <span className="inline-block min-w-0 max-w-full truncate align-bottom" data-clamped-value="true">
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 break-words">{text}</TooltipContent>
    </Tooltip>
  )
}
