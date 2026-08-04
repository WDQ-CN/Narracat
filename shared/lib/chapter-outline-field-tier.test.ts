import { describe, expect, test } from 'bun:test'
import { isFirstTierChapterArrayField, isFirstTierChapterField } from './chapter-outline-field-tier'

describe('isFirstTierChapterField · ADR-0029 章纲第一档白名单', () => {
  test('6 个纯描述字段判为第一档', () => {
    for (const key of ['title', 'value_shift', 'emotional_stakes', 'dramatic_focus', 'ending_note', 'positioning']) {
      expect(isFirstTierChapterField(key)).toBe(true)
    }
  })

  test('有下游依赖字段判为第二档（fail-safe）', () => {
    for (const key of ['payoff_beat', 'storyline_focus', 'pov_character', 'foreshadowing_touch', 'scenes', 'chapter', 'whatever']) {
      expect(isFirstTierChapterField(key)).toBe(false)
    }
  })
})

describe('isFirstTierChapterArrayField · 新格式（beat 骨架）数组字段白名单', () => {
  test('beats / must_deliver 判为第一档数组字段', () => {
    for (const key of ['beats', 'must_deliver']) {
      expect(isFirstTierChapterArrayField(key)).toBe(true)
    }
  })

  test('有下游依赖数组字段判为第二档（fail-safe）', () => {
    for (const key of ['storyline_focus', 'scenes', 'foreshadowing_touch', 'chapter', 'whatever']) {
      expect(isFirstTierChapterArrayField(key)).toBe(false)
    }
  })
})
