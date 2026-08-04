import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { ScrollBar } from './scroll-area'

describe('ScrollArea', () => {
  test('uses the same transparent track and token thumb language as native workbench scrollbars', () => {
    const element = ScrollBar({}) as ReactElement<{
      className?: string
      children: ReactElement<{ className?: string }>
      orientation?: string
    }>

    expect(element.props.className).toContain('w-2.5')
    expect(element.props.className).toContain('border-l-transparent')
    expect(element.props.children.props.className).toContain('bg-border')
    expect(element.props.children.props.className).toContain('hover:bg-border-strong')
  })
})
