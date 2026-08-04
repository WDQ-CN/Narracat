import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

describe('WorkbenchRoute', () => {
  test('does not render the checkpoint resume banner above the workbench stage', () => {
    const source = readFileSync(fileURLToPath(new URL('./workbench.tsx', import.meta.url)), 'utf-8')

    expect(source).not.toContain('CheckpointResumeBanner')
    expect(source).not.toContain('<CheckpointResumeBanner')
  })

  test('uses one pixel-based resizable workbench grid for sidebar content and Agent widths', () => {
    const source = readFileSync(fileURLToPath(new URL('./workbench.tsx', import.meta.url)), 'utf-8')

    expect(source).not.toContain('react-resizable-panels')
    expect(source).toContain('useWorkbenchPanelLayout')
    expect(source).toContain('workbenchPanelGridTemplates(layout)')
    expect(source).toContain('createWorkbenchPanelDragSession')
    expect(source).toContain('applyWorkbenchPanelLayoutToDom(container, nextLayout)')
    expect(source).toContain('gridTemplateRows: WORKBENCH_GRID_TEMPLATE_ROWS')
    expect(source).toContain('data-workbench-layout-grid="true"')
    expect(source).toContain('data-workbench-sidebar-panel="true"')
    expect(source).toContain('data-workbench-sidebar-resize-handle="true"')
    expect(source).toContain('data-workbench-content-panel="true"')
    expect(source).toContain('agentWidth={layout.agent}')
    expect(source).toContain('onAgentResizeStart={startAgentResize}')
  })

  test('does not let resize sync restore the Agent columns for character chat', () => {
    const source = readFileSync(fileURLToPath(new URL('./workbench.tsx', import.meta.url)), 'utf-8')

    expect(source).toContain("stage?.dataset.sectionId === 'chat'")
    expect(source).toContain('WORKBENCH_STAGE_SINGLE_COLUMN_TEMPLATE')
    expect(source).toContain('isCharacterChatSection ? WORKBENCH_STAGE_SINGLE_COLUMN_TEMPLATE : templates.stage')
  })

  test('persists the resolved work location and routes chapter subviews through the URL', () => {
    const source = readFileSync(fileURLToPath(new URL('./workbench.tsx', import.meta.url)), 'utf-8')

    expect(source).toContain('readWorkbenchChapterView(searchParams)')
    expect(source).toContain('createWorkbenchLocation({')
    expect(source).toContain('writeWorkLocation(')
    expect(source).toContain("next.set('view', view)")
    expect(source).toContain('selectedChapterView={resolvedChapterView}')
  })
})
