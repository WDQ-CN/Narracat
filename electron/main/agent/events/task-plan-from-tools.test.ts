import { describe, expect, test } from 'bun:test'
import { applyTaskToolCall } from './task-plan-from-tools'

describe('applyTaskToolCall', () => {
  test('TaskCreate 追加 pending 项，id 从 1 递增', () => {
    const items = applyTaskToolCall([], 'TaskCreate', { subject: '上下文聚合', description: '第一步' })
    expect(items).toEqual([{ id: '1', title: '上下文聚合', status: 'pending', detail: '第一步' }])
    const more = applyTaskToolCall(items!, 'TaskCreate', { subject: '正文生成' })
    expect(more![1]).toEqual({ id: '2', title: '正文生成', status: 'pending' })
  })

  test('TaskUpdate 按 taskId 改状态（in_progress→running / completed→complete），容忍 "#1" 与数字形态', () => {
    const base = applyTaskToolCall([], 'TaskCreate', { subject: 'A' })!
    expect(applyTaskToolCall(base, 'TaskUpdate', { taskId: '1', status: 'in_progress' })![0].status).toBe('running')
    expect(applyTaskToolCall(base, 'TaskUpdate', { taskId: '#1', status: 'completed' })![0].status).toBe('complete')
    expect(applyTaskToolCall(base, 'TaskUpdate', { taskId: 1, status: 'completed' })![0].status).toBe('complete')
  })

  test('TaskUpdate status=deleted 移除该项', () => {
    const base = applyTaskToolCall([], 'TaskCreate', { subject: 'A' })!
    expect(applyTaskToolCall(base, 'TaskUpdate', { taskId: '1', status: 'deleted' })).toEqual([])
  })

  test('未知 taskId / 缺 subject / 非任务工具 → null（列表不动）', () => {
    expect(applyTaskToolCall([], 'TaskUpdate', { taskId: '9', status: 'completed' })).toBeNull()
    expect(applyTaskToolCall([], 'TaskCreate', {})).toBeNull()
    expect(applyTaskToolCall([], 'Write', { subject: 'x' })).toBeNull()
  })

  test('Create A → Create B → Update(1, deleted) → Create C：新 id 不与存量重复，后续 Update 只改目标项', () => {
    let items = applyTaskToolCall([], 'TaskCreate', { subject: 'A' })!
    items = applyTaskToolCall(items, 'TaskCreate', { subject: 'B' })!
    expect(items).toEqual([
      { id: '1', title: 'A', status: 'pending' },
      { id: '2', title: 'B', status: 'pending' },
    ])
    items = applyTaskToolCall(items, 'TaskUpdate', { taskId: '1', status: 'deleted' })!
    expect(items).toEqual([{ id: '2', title: 'B', status: 'pending' }])
    items = applyTaskToolCall(items, 'TaskCreate', { subject: 'C' })!
    // 新建的 C 不应复用已删除的 id '1'，也不应撞上存量的 id '2'
    const ids = items.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(items).toEqual([
      { id: '2', title: 'B', status: 'pending' },
      { id: '3', title: 'C', status: 'pending' },
    ])

    // 之后对 taskId '2' 的 Update 只应改写 B，不应连带影响 C
    items = applyTaskToolCall(items, 'TaskUpdate', { taskId: '2', status: 'completed' })!
    expect(items).toEqual([
      { id: '2', title: 'B', status: 'complete' },
      { id: '3', title: 'C', status: 'pending' },
    ])
  })
})
