import { describe, expect, it } from 'vitest'
import { CHAT_GAP_LABEL_THRESHOLD_MS, formatChatGap } from './relative-time.ts'

const H = 60 * 60 * 1000
const D = 24 * H

describe('formatChatGap', () => {
  it('阈值是 6 小时', () => {
    expect(CHAT_GAP_LABEL_THRESHOLD_MS).toBe(6 * H)
  })

  it('小于一天按「X 小时」/「一会儿」', () => {
    expect(formatChatGap(30 * 60 * 1000)).toBe('一会儿')
    expect(formatChatGap(7 * H)).toBe('7 小时')
    expect(formatChatGap(23 * H)).toBe('23 小时')
  })

  it('一天与多天', () => {
    expect(formatChatGap(D)).toBe('一天')
    expect(formatChatGap(3 * D)).toBe('3 天')
    expect(formatChatGap(6 * D)).toBe('6 天')
  })

  it('周 / 月 / 很久', () => {
    expect(formatChatGap(10 * D)).toBe('一周多')
    expect(formatChatGap(20 * D)).toBe('2 周')
    expect(formatChatGap(45 * D)).toBe('1 个月')
    expect(formatChatGap(400 * D)).toBe('很久')
  })

  it('负数 / 0 兜底为「一会儿」', () => {
    expect(formatChatGap(0)).toBe('一会儿')
    expect(formatChatGap(-100)).toBe('一会儿')
  })
})
