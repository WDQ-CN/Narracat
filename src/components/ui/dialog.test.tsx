import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { DialogContent, DialogOverlay } from './dialog'

function dialogContentParts() {
  const portal = DialogContent({ children: <div /> }) as ReactElement<{
    children: ReactElement | ReactElement[]
  }>
  const children = Array.isArray(portal.props.children) ? portal.props.children : [portal.props.children]
  const content = children[1] as ReactElement<{
    className?: string
    children: ReactElement | ReactElement[]
  }>
  const contentChildren = Array.isArray(content.props.children) ? content.props.children : [content.props.children]
  const close = contentChildren[1] as ReactElement<{ className?: string }>

  return { close, content }
}

describe('Dialog', () => {
  test('keeps modal surfaces out of the frameless window drag region', () => {
    const overlay = DialogOverlay({}) as ReactElement<{ className?: string }>
    const { close, content } = dialogContentParts()

    expect(overlay.props.className).toContain('[-webkit-app-region:no-drag]')
    expect(content.props.className).toContain('[-webkit-app-region:no-drag]')
    expect(close.props.className).toContain('[-webkit-app-region:no-drag]')
  })
})
