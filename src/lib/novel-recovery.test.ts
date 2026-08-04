import { describe, expect, test } from 'bun:test'
import { getCheckpointSummary, getWritePrerequisiteGuidance } from './novel-recovery'
import type { NovelProjectDetail, NovelProjectSummary } from '@shared/types/novel'

function project(status: NovelProjectSummary['status']): NovelProjectDetail {
  return {
    id: 'novel-1',
    title: '星辰大海',
    path: '/novels/stars',
    status,
    chapterProgress: '0 / 1 章',
    wordCountLabel: '0 字',
    tocItems: [],
    treeItems: [],
    checkpoint: null,
  }
}

describe('novel recovery helpers', () => {
  test('summarizes checkpoint state for recovery prompts', () => {
    expect(
      getCheckpointSummary({
        ...project('in-progress'),
        checkpoint: {
          lastCommand: '/narracat:write 1',
          lastStep: 3,
          timestamp: '2026-05-03T10:00:00.000Z',
        },
      }),
    ).toMatchObject({
      hasCheckpoint: true,
      commandLabel: '/narracat:write 1',
      stepLabel: '步骤 3',
      timeLabel: expect.stringContaining('2026'),
    })
  })

  test('returns empty checkpoint summary when no checkpoint is active', () => {
    expect(getCheckpointSummary(project('ready'))).toEqual({
      hasCheckpoint: false,
      commandLabel: '无未完成命令',
      stepLabel: '无步骤',
      timeLabel: '无时间记录',
    })
  })

  test('guides write-next prerequisites without blocking freeform chat', () => {
    expect(getWritePrerequisiteGuidance(project('needs-setup'))).toMatchObject({
      blocked: true,
      title: '先完成小说设定',
    })
    expect(getWritePrerequisiteGuidance(project('needs-outline'))).toMatchObject({
      blocked: true,
      title: '先完成大纲规划',
    })
    expect(getWritePrerequisiteGuidance(project('invalid'))).toMatchObject({
      blocked: true,
      title: '项目结构需要检查',
    })
    expect(getWritePrerequisiteGuidance(project('ready'))).toMatchObject({
      blocked: false,
    })
  })
})
