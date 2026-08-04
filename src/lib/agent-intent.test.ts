import { describe, expect, test } from 'bun:test'
import { detectSideEffectIntent } from './agent-intent'

describe('agent intent detection', () => {
  test('suggests write-next only for direct write requests', () => {
    expect(detectSideEffectIntent('继续写下一章')).toBe('write-next')
    expect(detectSideEffectIntent('开始生成第 1 章正文')).toBe('write-next')
  })

  test('suggests NarraCat setup world and plan commands for direct project operations', () => {
    expect(detectSideEffectIntent('开始设定引导')).toBe('setup')
    expect(detectSideEffectIntent('创建主角林舟和反派许镜')).toBe('world')
    expect(detectSideEffectIntent('补充宗门体系和世界规则')).toBe('world')
    expect(detectSideEffectIntent('规划第一卷 30 章大纲')).toBe('plan')
  })

  test('keeps brainstorming and questions as freeform chat', () => {
    expect(detectSideEffectIntent('帮我想想下一章怎么写')).toBeNull()
    expect(detectSideEffectIntent('我们聊一下角色动机')).toBeNull()
    expect(detectSideEffectIntent('为什么这一章节奏不对？')).toBeNull()
    expect(detectSideEffectIntent('帮我建立风格指南')).toBeNull()
  })
})
