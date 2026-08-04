import { describe, expect, test } from 'bun:test'
import {
  APP_CANVAS_CLASS,
  ASIDE_PANEL_CLASS,
  CARD_CLASS,
  CONTENT_HEADER_CLASS,
  DOCUMENT_PANEL_CLASS,
  FLOATING_PANEL_CLASS,
  GROUP_CLASS,
  INTERACTIVE_CARD_CLASS,
  METRIC_TILE_CLASS,
  ROW_CLASS,
  SIDEBAR_ROW_CLASS,
  TOOLBAR_BUTTON_CLASS,
  WORKBENCH_GUIDE_ACTION_CLASS,
  WORKBENCH_READING_CANVAS_CLASS,
  WORKBENCH_RESIZE_HANDLE_CLASS,
  WORKBENCH_RESIZE_HANDLE_LINE_CLASS,
  WORKSPACE_SHELL_CLASS,
} from './surfaces'

const contracts = [
  APP_CANVAS_CLASS,
  WORKSPACE_SHELL_CLASS,
  FLOATING_PANEL_CLASS,
  ASIDE_PANEL_CLASS,
  CONTENT_HEADER_CLASS,
  CARD_CLASS,
  INTERACTIVE_CARD_CLASS,
  METRIC_TILE_CLASS,
  DOCUMENT_PANEL_CLASS,
  GROUP_CLASS,
  ROW_CLASS,
  SIDEBAR_ROW_CLASS,
  WORKBENCH_GUIDE_ACTION_CLASS,
  WORKBENCH_READING_CANVAS_CLASS,
  WORKBENCH_RESIZE_HANDLE_CLASS,
  WORKBENCH_RESIZE_HANDLE_LINE_CLASS,
  TOOLBAR_BUTTON_CLASS,
]

describe('design-system surface contracts', () => {
  test('uses semantic product tokens', () => {
    expect(APP_CANVAS_CLASS).toContain('bg-canvas')
    expect(WORKSPACE_SHELL_CLASS).toContain('bg-workspace')
    expect(FLOATING_PANEL_CLASS).toContain('bg-floating')
    expect(ASIDE_PANEL_CLASS).toContain('bg-glass-aside')
    expect(CONTENT_HEADER_CLASS).toContain('border-b')
    expect(CARD_CLASS).toContain('hover:bg-hover')
    expect(INTERACTIVE_CARD_CLASS).toContain('active:scale-[0.98]')
    expect(METRIC_TILE_CLASS).toContain('bg-glass')
    expect(DOCUMENT_PANEL_CLASS).toContain('bg-surface')
    expect(GROUP_CLASS).toContain('divide-y')
    expect(ROW_CLASS).toContain('data-[active=true]:hover:bg-active')
    expect(WORKBENCH_RESIZE_HANDLE_CLASS).toContain('cursor-col-resize')
    expect(WORKBENCH_RESIZE_HANDLE_LINE_CLASS).toContain('group-hover:bg-border')
    expect(TOOLBAR_BUTTON_CLASS).toContain('active:scale-[0.95]')
    expect(WORKBENCH_GUIDE_ACTION_CLASS).toContain('min-w-40')
    expect(WORKBENCH_GUIDE_ACTION_CLASS).toContain('rounded-row')
    expect(WORKBENCH_READING_CANVAS_CLASS).toContain('max-w-[820px]')
    expect(WORKBENCH_READING_CANVAS_CLASS).toContain('[content-visibility:auto]')
    expect(WORKBENCH_READING_CANVAS_CLASS).toContain('[contain-intrinsic-size:1px_900px]')
    expect(WORKBENCH_READING_CANVAS_CLASS).not.toContain('border')
  })

  test('does not reintroduce forbidden broad visual patterns', () => {
    for (const className of contracts) {
      expect(className).not.toMatch(/bg-background|bg-accent|bg-muted/)
      expect(className).not.toMatch(/shadow-(sm|md|lg|xl|2xl)/)
      expect(className).not.toMatch(/rounded-(2xl|3xl)/)
      expect(className).not.toMatch(/text-(blue|purple|green|orange|red)-/)
      expect(className).not.toMatch(/bg-(blue|purple|green|orange|red)-/)
    }
  })
})
