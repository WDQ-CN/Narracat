export const APP_CANVAS_CLASS = 'min-h-full bg-canvas text-foreground'

export const APP_HEADER_CLASS = 'bg-canvas text-foreground'

export const WORKSPACE_SHELL_CLASS =
  'rounded-workspace border border-border bg-workspace shadow-[var(--shadow-workspace)]'

export const WORKSPACE_STATE_CLASS =
  'rounded-workspace border border-border bg-workspace shadow-[var(--shadow-workspace)]'

export const FLOATING_PANEL_CLASS =
  'rounded-panel border border-border bg-floating shadow-[var(--shadow-floating)] backdrop-blur-2xl'

export const ASIDE_PANEL_CLASS =
  'border-border bg-glass-aside backdrop-blur-2xl'

export const CONTENT_HEADER_CLASS =
  'border-b border-border px-5 py-4 sm:px-6'

export const CARD_CLASS =
  'rounded-card border border-border bg-surface transition-all duration-200 hover:border-border-strong hover:bg-hover'

export const INTERACTIVE_CARD_CLASS =
  'rounded-panel border border-border bg-surface transition-all duration-200 hover:border-border-strong hover:bg-hover active:scale-[0.98]'

export const METRIC_TILE_CLASS =
  'rounded-panel border border-border bg-glass px-3 py-2 backdrop-blur-xl'

export const DOCUMENT_PANEL_CLASS =
  'rounded-panel border border-border bg-surface'

export const WORKBENCH_READING_CANVAS_CLASS =
  'mx-auto flex min-h-full w-full max-w-[820px] flex-col py-2 sm:py-4 [content-visibility:auto] [contain-intrinsic-size:1px_900px]'

export const GROUP_CLASS =
  'overflow-hidden rounded-row border border-border bg-surface divide-y divide-border'

export const SECTION_CLASS = 'border-b border-border pb-5 last:border-b-0'

export const REGION_CLASS = 'bg-transparent'

export const ROW_CLASS =
  'transition-all duration-200 hover:bg-hover active:scale-[0.98] data-[active=true]:bg-active data-[active=true]:font-semibold data-[active=true]:text-foreground data-[active=true]:hover:bg-active data-[selected=true]:bg-active data-[selected=true]:font-semibold data-[selected=true]:text-foreground data-[selected=true]:hover:bg-active'

export const SIDEBAR_ROW_CLASS =
  'flex h-8 w-full items-center gap-2 rounded-row px-2 text-left text-sm transition-all duration-200 active:scale-[0.98]'

export const WORKBENCH_GUIDE_ACTION_CLASS = 'min-w-40 rounded-row'

export const WORKBENCH_RESIZE_HANDLE_CLASS =
  'group relative z-10 flex w-1.5 shrink-0 cursor-col-resize touch-none select-none items-stretch justify-center focus-visible:outline-none'

export const WORKBENCH_RESIZE_HANDLE_LINE_CLASS =
  'h-full w-px bg-transparent transition-colors duration-150 group-hover:bg-border group-focus-visible:bg-ring'

export const TOOLBAR_BUTTON_CLASS =
  'text-muted-foreground transition-all duration-200 hover:bg-hover hover:text-foreground active:scale-[0.95] data-[state=open]:bg-active data-[state=open]:text-foreground data-[pressed=true]:bg-active data-[pressed=true]:text-foreground'

export const MUTED_PILL_CLASS =
  'rounded-full bg-active px-1.5 py-0.5 text-xs font-medium text-muted-foreground'

/** 「待确认」类小徽标（extracted 状态值等诚实标注场景）；可作 span 或可点按钮的底座 */
export const PENDING_PILL_CLASS =
  'inline-flex shrink-0 items-center rounded-full border border-border bg-surface px-1.5 py-0 text-[11px] leading-4 text-muted-foreground'

/** 「待确认」琥珀描边小徽标（extracted 待作者确认）；结构与 PENDING_PILL_CLASS 同构、色族用 warning */
export const WARNING_OUTLINE_PILL_CLASS =
  'inline-flex shrink-0 items-center rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0 text-[11px] leading-4 text-warning'

export const SUCCESS_PILL_CLASS =
  'rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success'

export const WARNING_PILL_CLASS =
  'rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning'

export const DESTRUCTIVE_INLINE_CLASS =
  'rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'
