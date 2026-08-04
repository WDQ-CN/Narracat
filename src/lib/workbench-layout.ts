export type WorkbenchResizeEdge = 'sidebar' | 'agent'

export interface WorkbenchPanelLayout {
  sidebar: number
  agent: number
}

export interface WorkbenchPanelGridTemplates {
  workbench: string
  stage: string
}

type WorkbenchAnimationFrameCallback = (time: number) => void

export interface WorkbenchPanelDragSessionOptions {
  edge: WorkbenchResizeEdge
  startX: number
  startLayout: WorkbenchPanelLayout
  containerWidth: number
  applyLayout: (layout: WorkbenchPanelLayout) => void
  commitLayout: (layout: WorkbenchPanelLayout) => void
  requestFrame?: (callback: WorkbenchAnimationFrameCallback) => number
  cancelFrame?: (frameId: number) => void
}

export interface WorkbenchPanelDragSession {
  move: (clientX: number) => void
  end: () => void
}

export const WORKBENCH_LAYOUT_STORAGE_KEY = 'narracat:workbench-layout:v1'

export const WORKBENCH_PANEL_WIDTHS = {
  sidebar: { min: 200, default: 260, max: 360 },
  content: { min: 480 },
  agent: { min: 320, default: 460, max: 640 },
  handle: 6,
  agentHandle: 8,
  stageGutter: 12,
} as const

export const WORKBENCH_GRID_TEMPLATE_ROWS = 'minmax(0, 1fr)'
export const WORKBENCH_STAGE_SINGLE_COLUMN_TEMPLATE = 'minmax(0, 1fr)'

const TOTAL_FIXED_NONCONTENT_WIDTH =
  WORKBENCH_PANEL_WIDTHS.handle + WORKBENCH_PANEL_WIDTHS.agentHandle + WORKBENCH_PANEL_WIDTHS.stageGutter

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

export function defaultWorkbenchPanelLayout(): WorkbenchPanelLayout {
  return {
    sidebar: WORKBENCH_PANEL_WIDTHS.sidebar.default,
    agent: WORKBENCH_PANEL_WIDTHS.agent.default,
  }
}

export function clampWorkbenchPanelLayout(
  layout: WorkbenchPanelLayout,
  containerWidth: number,
): WorkbenchPanelLayout {
  const availableWidth = Math.max(0, containerWidth - TOTAL_FIXED_NONCONTENT_WIDTH)
  let sidebar = clamp(layout.sidebar, WORKBENCH_PANEL_WIDTHS.sidebar.min, WORKBENCH_PANEL_WIDTHS.sidebar.max)
  let agent = clamp(layout.agent, WORKBENCH_PANEL_WIDTHS.agent.min, WORKBENCH_PANEL_WIDTHS.agent.max)

  const agentMaxForContent = availableWidth - sidebar - WORKBENCH_PANEL_WIDTHS.content.min
  agent = clamp(agent, WORKBENCH_PANEL_WIDTHS.agent.min, Math.min(WORKBENCH_PANEL_WIDTHS.agent.max, agentMaxForContent))

  const sidebarMaxForContent = availableWidth - agent - WORKBENCH_PANEL_WIDTHS.content.min
  sidebar = clamp(
    sidebar,
    WORKBENCH_PANEL_WIDTHS.sidebar.min,
    Math.min(WORKBENCH_PANEL_WIDTHS.sidebar.max, sidebarMaxForContent),
  )

  const finalAgentMaxForContent = availableWidth - sidebar - WORKBENCH_PANEL_WIDTHS.content.min
  agent = clamp(
    agent,
    WORKBENCH_PANEL_WIDTHS.agent.min,
    Math.min(WORKBENCH_PANEL_WIDTHS.agent.max, finalAgentMaxForContent),
  )

  return {
    sidebar: Math.round(sidebar),
    agent: Math.round(agent),
  }
}

export function resizeWorkbenchPanelLayout(
  layout: WorkbenchPanelLayout,
  edge: WorkbenchResizeEdge,
  deltaX: number,
  containerWidth: number,
): WorkbenchPanelLayout {
  const availableWidth = Math.max(0, containerWidth - TOTAL_FIXED_NONCONTENT_WIDTH)

  if (edge === 'sidebar') {
    const agent = clamp(layout.agent, WORKBENCH_PANEL_WIDTHS.agent.min, WORKBENCH_PANEL_WIDTHS.agent.max)
    const sidebarMaxForContent = availableWidth - agent - WORKBENCH_PANEL_WIDTHS.content.min
    const sidebar = clamp(
      layout.sidebar + deltaX,
      WORKBENCH_PANEL_WIDTHS.sidebar.min,
      Math.min(WORKBENCH_PANEL_WIDTHS.sidebar.max, sidebarMaxForContent),
    )

    return {
      sidebar: Math.round(sidebar),
      agent: Math.round(agent),
    }
  }

  const sidebar = clamp(layout.sidebar, WORKBENCH_PANEL_WIDTHS.sidebar.min, WORKBENCH_PANEL_WIDTHS.sidebar.max)
  const agentMaxForContent = availableWidth - sidebar - WORKBENCH_PANEL_WIDTHS.content.min
  const agent = clamp(
    layout.agent - deltaX,
    WORKBENCH_PANEL_WIDTHS.agent.min,
    Math.min(WORKBENCH_PANEL_WIDTHS.agent.max, agentMaxForContent),
  )

  return {
    sidebar: Math.round(sidebar),
    agent: Math.round(agent),
  }
}

export function workbenchGridTemplateColumns(layout: WorkbenchPanelLayout): string {
  return `${layout.sidebar}px ${WORKBENCH_PANEL_WIDTHS.handle}px minmax(0, 1fr)`
}

export function workbenchStageGridTemplateColumns(agentWidth: number): string {
  return `minmax(0, 1fr) ${WORKBENCH_PANEL_WIDTHS.agentHandle}px ${agentWidth}px`
}

export function workbenchPanelGridTemplates(layout: WorkbenchPanelLayout): WorkbenchPanelGridTemplates {
  return {
    workbench: workbenchGridTemplateColumns(layout),
    stage: workbenchStageGridTemplateColumns(layout.agent),
  }
}

export function createWorkbenchPanelDragSession({
  edge,
  startX,
  startLayout,
  containerWidth,
  applyLayout,
  commitLayout,
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame,
}: WorkbenchPanelDragSessionOptions): WorkbenchPanelDragSession {
  let frameId = 0
  let latestLayout = startLayout

  function flushLayout() {
    frameId = 0
    applyLayout(latestLayout)
  }

  function move(clientX: number) {
    latestLayout = resizeWorkbenchPanelLayout(startLayout, edge, clientX - startX, containerWidth)

    if (frameId) cancelFrame(frameId)
    frameId = requestFrame(flushLayout)
  }

  function end() {
    if (frameId) {
      cancelFrame(frameId)
      flushLayout()
    }

    commitLayout(latestLayout)
  }

  return { move, end }
}
