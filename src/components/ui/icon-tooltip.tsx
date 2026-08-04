import { cloneElement, type ReactElement } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

export function IconTooltip({
  align = 'center',
  children,
  description,
  label,
  onOpenChange,
  open,
  side = 'bottom',
}: {
  align?: 'start' | 'center' | 'end'
  children: ReactElement
  description?: string
  label: string
  onOpenChange?: (open: boolean) => void
  open?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    'data-icon-tooltip': label,
  })

  return (
    <Tooltip open={open} onOpenChange={onOpenChange}>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent align={align} side={side}>
        <span className="block text-[11px] font-medium leading-none">{label}</span>
        {description && description !== label ? (
          <span className="mt-1 block max-w-52 text-[11px] leading-4 text-background/70">{description}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}
