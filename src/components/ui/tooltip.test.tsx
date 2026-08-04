import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { IconTooltip } from './icon-tooltip'
import { TooltipContent, TooltipProvider } from './tooltip'

describe('Tooltip', () => {
  test('uses a short hover delay for icon tooltips', () => {
    const element = TooltipProvider({ children: null }) as ReactElement<{
      delayDuration?: number
      skipDelayDuration?: number
    }>

    expect(element.props.delayDuration).toBe(120)
    expect(element.props.skipDelayDuration).toBe(80)
  })

  test('uses the elevated floating tooltip surface and motion language', () => {
    const element = TooltipContent({ children: '提示' }) as ReactElement<{
      children: ReactElement<{
        className?: string
        sideOffset?: number
      }>
    }>
    const content = element.props.children
    const className = content.props.className ?? ''

    expect(content.props.sideOffset).toBe(8)
    expect(className).toContain('backdrop-blur-md')
    expect(className).toContain('bg-foreground/90')
    expect(className).toContain('text-background')
    expect(className).toContain('duration-150')
    expect(className).toContain('data-[state=delayed-open]:fade-in-0')
    expect(className).not.toContain('bg-popover')
  })

  test('allows icon tooltips to be controlled by composed floating surfaces', () => {
    const element = IconTooltip({
      label: '更多操作',
      open: false,
      onOpenChange: () => {},
      children: <button type="button">更多</button>,
    }) as ReactElement<{
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }>

    expect(element.props.open).toBe(false)
    expect(element.props.onOpenChange).toBeTypeOf('function')
  })
})
