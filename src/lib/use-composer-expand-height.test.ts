import { describe, expect, test } from 'bun:test'
import {
  COMPOSER_EXPAND_MIN_PX,
  COMPOSER_EXPAND_RESERVE_PX,
  resolveComposerExpandHeight,
} from './use-composer-expand-height'

describe('resolveComposerExpandHeight', () => {
  test('房间充足时填满 section 减去预留的 chrome 高度', () => {
    expect(resolveComposerExpandHeight(800)).toBe(800 - COMPOSER_EXPAND_RESERVE_PX)
  })

  test('section 很矮时 clamp 到下限', () => {
    expect(resolveComposerExpandHeight(200)).toBe(COMPOSER_EXPAND_MIN_PX)
  })

  test('零高度 section 也不会低于下限', () => {
    expect(resolveComposerExpandHeight(0)).toBe(COMPOSER_EXPAND_MIN_PX)
  })
})
