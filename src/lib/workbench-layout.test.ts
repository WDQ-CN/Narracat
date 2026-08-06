import { describe, expect, test } from 'bun:test'
import {
  clampWorkbenchPanelLayout,
  createWorkbenchPanelDragSession,
  isFullWidthWorkbenchSection,
  resizeWorkbenchPanelLayout,
  workbenchPanelGridTemplates,
  workbenchGridTemplateColumns,
  WORKBENCH_GRID_TEMPLATE_ROWS,
  WORKBENCH_PANEL_WIDTHS,
  WORKBENCH_STAGE_SINGLE_COLUMN_TEMPLATE,
  type WorkbenchPanelLayout,
} from './workbench-layout'

describe('workbench panel layout', () => {
  test('uses fixed pixel rails for sidebar and Agent while content stays fluid', () => {
    expect(WORKBENCH_PANEL_WIDTHS.sidebar).toEqual({ min: 200, default: 260, max: 360 })
    expect(WORKBENCH_PANEL_WIDTHS.content).toEqual({ min: 480 })
    expect(WORKBENCH_PANEL_WIDTHS.agent).toEqual({ min: 320, default: 460, max: 640 })
    expect(WORKBENCH_PANEL_WIDTHS.handle).toBe(6)
    expect(WORKBENCH_PANEL_WIDTHS.agentHandle).toBe(8)
    expect(WORKBENCH_PANEL_WIDTHS.stageGutter).toBe(12)
  })

  test('clamps side panels before the content area is squeezed below its minimum', () => {
    const layout = clampWorkbenchPanelLayout({ sidebar: 999, agent: 999 }, 1280)

    expect(layout).toEqual({ sidebar: 360, agent: 414 })
  })

  test('resizes the sidebar and Agent with the same pixel delta rules', () => {
    const start: WorkbenchPanelLayout = { sidebar: 260, agent: 460 }

    expect(resizeWorkbenchPanelLayout(start, 'sidebar', 400, 1280)).toEqual({
      sidebar: 314,
      agent: 460,
    })
    expect(resizeWorkbenchPanelLayout(start, 'agent', -400, 1440)).toEqual({
      sidebar: 260,
      agent: 640,
    })
  })

  test('formats the app grid from pixel widths instead of percentage panel sizes', () => {
    expect(workbenchGridTemplateColumns({ sidebar: 260, agent: 460 })).toBe('260px 6px minmax(0, 1fr)')
    expect(WORKBENCH_GRID_TEMPLATE_ROWS).toBe('minmax(0, 1fr)')
    expect(WORKBENCH_STAGE_SINGLE_COLUMN_TEMPLATE).toBe('minmax(0, 1fr)')
  })

  test('formats both resize grids from a single layout snapshot', () => {
    expect(workbenchPanelGridTemplates({ sidebar: 280, agent: 520 })).toEqual({
      workbench: '280px 6px minmax(0, 1fr)',
      stage: 'minmax(0, 1fr) 8px 520px',
    })
  })

  test('keeps pointer-drag updates out of React state until the drag ends', () => {
    const applied: WorkbenchPanelLayout[] = []
    const committed: WorkbenchPanelLayout[] = []
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    const flushFrames = () => {
      const scheduled = Array.from(callbacks.values())
      callbacks.clear()
      scheduled.forEach((callback) => callback(0))
    }

    const session = createWorkbenchPanelDragSession({
      edge: 'agent',
      startX: 800,
      startLayout: { sidebar: 260, agent: 460 },
      containerWidth: 1440,
      applyLayout: (layout) => applied.push(layout),
      commitLayout: (layout) => committed.push(layout),
      requestFrame: (callback) => {
        const frameId = nextFrameId
        nextFrameId += 1
        callbacks.set(frameId, callback)
        return frameId
      },
      cancelFrame: (frameId) => {
        callbacks.delete(frameId)
      },
    })

    session.move(720)
    session.move(650)

    expect(applied).toEqual([])
    expect(committed).toEqual([])
    expect(callbacks.size).toBe(1)

    flushFrames()

    expect(applied).toEqual([{ sidebar: 260, agent: 610 }])
    expect(committed).toEqual([])

    session.move(600)
    session.end()

    expect(applied).toEqual([
      { sidebar: 260, agent: 610 },
      { sidebar: 260, agent: 640 },
    ])
    expect(committed).toEqual([{ sidebar: 260, agent: 640 }])
    expect(callbacks.size).toBe(0)
  })
})

describe('isFullWidthWorkbenchSection', () => {
  test('gives the whole stage to 唠个嗑 and 记忆星图', () => {
    // 这两块都要横向空间：一个是沉浸式对话，一个是全景图形，右侧再挤一栏对话既没用也压缩主体
    expect(isFullWidthWorkbenchSection('chat')).toBe(true)
    expect(isFullWidthWorkbenchSection('memory-graph')).toBe(true)
  })

  test('keeps the Agent column for every other section', () => {
    for (const sectionId of ['status', 'reference-works', 'settings', 'blueprint', 'packs']) {
      expect(isFullWidthWorkbenchSection(sectionId)).toBe(false)
    }
  })

  test('treats a missing section id as not full width', () => {
    // 路由那条路径读的是 dataset，可能拿不到值——不能因此误判成满宽把 Agent 栏吞掉
    expect(isFullWidthWorkbenchSection(undefined)).toBe(false)
  })
})
