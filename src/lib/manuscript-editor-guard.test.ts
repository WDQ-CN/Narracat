import { beforeEach, describe, expect, test } from 'bun:test'
import {
  cancelPendingManuscriptLeave,
  confirmLeaveManuscriptEditor,
  resolveManuscriptLeave,
  useManuscriptEditorGuard,
} from './manuscript-editor-guard'

beforeEach(() => {
  cancelPendingManuscriptLeave()
  useManuscriptEditorGuard.setState({
    dirty: false,
    editing: false,
    saving: false,
    handlers: null,
    leaveDialogOpen: false,
    leaveResolving: false,
  })
})

describe('manuscript editor guard', () => {
  test('无脏草稿直接放行', async () => {
    await expect(confirmLeaveManuscriptEditor()).resolves.toBe(true)
  })

  test('有脏草稿时打开三选一对话框；继续编辑会拦下', async () => {
    useManuscriptEditorGuard.getState().setDirty(true)
    const pending = confirmLeaveManuscriptEditor()

    expect(useManuscriptEditorGuard.getState().leaveDialogOpen).toBe(true)
    await resolveManuscriptLeave('continue-editing')

    await expect(pending).resolves.toBe(false)
    expect(useManuscriptEditorGuard.getState().dirty).toBe(true)
    expect(useManuscriptEditorGuard.getState().leaveDialogOpen).toBe(false)
  })

  test('保留草稿成功后放行并复位 dirty', async () => {
    let keepCalled = 0
    useManuscriptEditorGuard.getState().setDirty(true)
    useManuscriptEditorGuard.getState().registerHandlers({
      keepDraftBeforeLeave: async () => {
        keepCalled += 1
        return true
      },
    })
    const pending = confirmLeaveManuscriptEditor()

    await resolveManuscriptLeave('keep-draft')

    await expect(pending).resolves.toBe(true)
    expect(keepCalled).toBe(1)
    expect(useManuscriptEditorGuard.getState().dirty).toBe(false)
  })

  test('草稿持久化失败时保持对话框和编辑态，可继续选择', async () => {
    useManuscriptEditorGuard.getState().setDirty(true)
    useManuscriptEditorGuard.getState().registerHandlers({
      keepDraftBeforeLeave: async () => false,
    })
    const pending = confirmLeaveManuscriptEditor()

    await resolveManuscriptLeave('keep-draft')

    expect(useManuscriptEditorGuard.getState().leaveDialogOpen).toBe(true)
    expect(useManuscriptEditorGuard.getState().leaveResolving).toBe(false)
    await resolveManuscriptLeave('continue-editing')
    await expect(pending).resolves.toBe(false)
  })

  test('明确放弃草稿成功后放行', async () => {
    let discardCalled = 0
    useManuscriptEditorGuard.getState().setDirty(true)
    useManuscriptEditorGuard.getState().registerHandlers({
      discardDraftBeforeLeave: async () => {
        discardCalled += 1
        return true
      },
    })
    const pending = confirmLeaveManuscriptEditor()

    await resolveManuscriptLeave('discard-draft')

    await expect(pending).resolves.toBe(true)
    expect(discardCalled).toBe(1)
  })
})

describe('编辑态桥（editing / saving / handlers）', () => {
  test('setEditing / setSaving 读写', () => {
    expect(useManuscriptEditorGuard.getState().editing).toBe(false)
    expect(useManuscriptEditorGuard.getState().saving).toBe(false)

    useManuscriptEditorGuard.getState().setEditing(true)
    useManuscriptEditorGuard.getState().setSaving(true)

    expect(useManuscriptEditorGuard.getState().editing).toBe(true)
    expect(useManuscriptEditorGuard.getState().saving).toBe(true)
  })

  test('registerHandlers 注册后可经 getState().handlers 分派调用；clearHandlers 复位为 null', () => {
    let saveCalled = false
    useManuscriptEditorGuard.getState().registerHandlers({
      save: () => {
        saveCalled = true
      },
    })

    useManuscriptEditorGuard.getState().handlers?.save?.()
    expect(saveCalled).toBe(true)

    useManuscriptEditorGuard.getState().clearHandlers()
    expect(useManuscriptEditorGuard.getState().handlers).toBeNull()
  })
})
