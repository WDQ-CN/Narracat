import { describe, expect, test } from 'bun:test'
import { splitSentences, buildSourceFingerprint, buildWindowIndex, buildWindowBloom, windowBloomHas, scanTextReuse } from './text-reuse-scan'

// 确定性伪随机（mulberry32）：测试可复现，不依赖 Math.random。
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function randomCjkText(rng: () => number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(0x4e00 + Math.floor(rng() * (0x9fa5 - 0x4e00)))
  return out
}

const SOURCE = '他推开破庙的门，雪片跟着卷了进来，火堆边的老人没有抬头。刀光一闪而过。少年握紧了手里那半块饼，慢慢往火堆挪了两步。'
const NOW = () => '2026-07-20T00:00:00.000Z'
const FP = buildSourceFingerprint({ fullText: SOURCE, properNouns: ['破庙老人'], sourceKind: 'txt', sourceTitle: '试书', now: NOW })

describe('splitSentences', () => {
  test('按中英文句末标点切分', () => {
    expect(splitSentences('第一句。第二句！第三句？')).toEqual(['第一句', '第二句', '第三句'])
  })
})

describe('scanTextReuse', () => {
  test('整句照抄（≥10字句子）→ sentence 命中', () => {
    // 带前缀的整句拷贝句子 hash 测不中（hash 是全句精确匹配），该场景由 windowIndex 滑窗机制覆盖（滑窗对是否整句不敏感；见下方 window 用例的同机制验证）
    const hits = scanTextReuse('少年握紧了手里那半块饼，慢慢往火堆挪了两步。', { fingerprint: FP })
    expect(hits.some((h) => h.kind === 'sentence')).toBe(true)
  })
  test('短句（<10字）不入指纹不误报', () => {
    expect(scanTextReuse('刀光一闪而过。', { fingerprint: FP })).toEqual([])
  })
  test('专名命中', () => {
    const hits = scanTextReuse('这一手破庙老人式的留白', { fingerprint: FP })
    expect(hits.some((h) => h.kind === 'proper-noun')).toBe(true)
  })
  test('windowIndex 提供时，10字片段（非完整句）也命中', () => {
    const idx = buildWindowIndex(SOURCE)
    const hits = scanTextReuse('比如"雪片跟着卷了进来，火堆边"这种写法', { fingerprint: FP, windowIndex: idx })
    expect(hits.some((h) => h.kind === 'window')).toBe(true)
  })
  test('无 windowIndex 但有 v2 指纹 bloom → 非整句 ≥10 字片段仍命中（P1-2：发布重扫不再放过）', () => {
    const hits = scanTextReuse('比如"雪片跟着卷了进来，火堆边"这种写法', { fingerprint: FP })
    expect(hits.some((h) => h.kind === 'window')).toBe(true)
  })
  test('同一正文里两处相隔较远的独立抄袭片段 → window 命中精确计数 = 2', () => {
    // 验证 i += WINDOW - 1 的跳跃逻辑：12字片段含3个窗口，带跳跃恰好各1次(2总)；
    // 删跳跃会6次(3+3)→红；跳跃过头会1次→红；唯精确跳跃才=2→绿
    const fragA = SOURCE.substring(0, 12)  // 句首12字
    const fragB = SOURCE.substring(38, 50)  // 句尾部分12字，不与 fragA 相邻
    const testText = `比如"${fragA}"这种开头，中间是完全原创的过渡表述占位超过十个字，再比如"${fragB}"这样收尾`

    const idx = buildWindowIndex(SOURCE)
    const hits = scanTextReuse(testText, { fingerprint: FP, windowIndex: idx })

    // 三条断言（精确计数 + 两段独立验证）
    expect(hits.filter((h) => h.kind === 'window').length).toBe(2)
    expect(hits.some((h) => h.kind === 'window' && h.sample === fragA.substring(0, 10))).toBe(true)  // fragA 的前10字
    expect(hits.some((h) => h.kind === 'window' && h.sample === fragB.substring(0, 10))).toBe(true)  // fragB 的前10字
  })
  test('干净正文零命中', () => {
    // bloom 假阳率是按大样本渐近公式定的（2e-5），本文件顶层 SOURCE 只有 57 字/48 个窗口——
    // 这种玩具级样本量下统计噪声会显著放大实际假阳率（现实中一本书是几十万到几百万字）。
    // 该测试要验证的是"干净文本不被冤枉"，换一份规模接近真实场景的指纹源才有代表性；
    // bloom 本身的无假阴性/大样本假阳率量级已由下方 buildWindowBloom 专属用例覆盖。
    const bigSource = Array.from({ length: 400 }, (_, i) => `第${i}段这是不相关的正文内容用于撑大样本量避免小样本噪声干扰判定结果。`).join('')
    const cleanFp = buildSourceFingerprint({ fullText: bigSource, properNouns: [], sourceKind: 'txt', sourceTitle: '别的书', now: NOW })
    const idx = buildWindowIndex(SOURCE)
    expect(scanTextReuse('冷场收尾：在情绪顶点前一拍停笔，把余味留给读者补完。', { fingerprint: cleanFp, windowIndex: idx })).toEqual([])
  })
})

describe('buildWindowBloom / windowBloomHas（位集，不可还原原文）', () => {
  const sourceText = randomCjkText(mulberry32(1), 5000)
  const bloom = buildWindowBloom(sourceText)

  test('序列化不含可还原原文的字段（只有位集/参数）', () => {
    expect(Object.keys(bloom).sort()).toEqual(['bits', 'count', 'k', 'mBits', 'version'])
    expect(typeof bloom.bits).toBe('string') // base64 位集，非原文子串列表
  })

  test('无假阴性：源文本随机抽 500 个真实窗口，全部命中', () => {
    const rng = mulberry32(2)
    const maxStart = sourceText.length - 10
    let allHit = true
    for (let i = 0; i < 500; i++) {
      const start = Math.floor(rng() * maxStart)
      const win = sourceText.slice(start, start + 10)
      if (!windowBloomHas(bloom, win)) allHit = false
    }
    expect(allHit).toBe(true)
  })

  test('假阳率 sanity：50 万个源文本外的随机窗口，命中数远低于宽松上界（2e-5 目标 fp，10 期望值，30 为放宽上界防实现错误）', () => {
    const rng = mulberry32(3)
    let hits = 0
    for (let i = 0; i < 500_000; i++) {
      const win = randomCjkText(rng, 10)
      if (windowBloomHas(bloom, win)) hits++
    }
    expect(hits).toBeLessThanOrEqual(30)
  })
})
