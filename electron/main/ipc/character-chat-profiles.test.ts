import { describe, expect, it } from 'vitest'
import { normalizeSaveProfileInput } from './character-chat-profiles.ts'

describe('normalizeSaveProfileInput', () => {
  it('合法 author/impression 通过', () => {
    expect(normalizeSaveProfileInput({ scope: 'author', content: 'x', projectPath: '/p', characterUid: 'c' }))
      .toEqual({ scope: 'author', content: 'x', projectPath: '/p', characterUid: 'c' })
  })
  it('非法 scope 抛错', () => {
    expect(() => normalizeSaveProfileInput({ scope: 'bad', content: 'x', projectPath: '/p', characterUid: 'c' })).toThrow()
  })
  it('缺 projectPath 抛错', () => {
    expect(() => normalizeSaveProfileInput({ scope: 'author', content: 'x', characterUid: 'c' })).toThrow()
  })
})
