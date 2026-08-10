import { describe, expect, test } from 'bun:test'
import { applyProseOverrides, parseProseBlocks, resolveBlockStatus } from './prose-blocks'
import type { ProseOverrideEntry } from '@shared/types/prose-block'

const SAMPLE = `你是写手。

<!-- narracat:prose id="writer-persona" title="写手的人设"
     hint="决定这个写手是什么性格的说书人" -->
你是专业的网络小说作家。
<!-- /narracat:prose -->

## 停下来的情况

- 读不到就停。
`

function entry(text: string, baseText = '你是专业的网络小说作家。'): ProseOverrideEntry {
  return { text, baseText, baseEngineVersion: '4.0.161', updatedAt: '2026-08-06T10:00:00+08:00' }
}

describe('parseProseBlocks', () => {
  test('解析出 id / title / hint / body', () => {
    const blocks = parseProseBlocks(SAMPLE)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].id).toBe('writer-persona')
    expect(blocks[0].title).toBe('写手的人设')
    expect(blocks[0].hint).toBe('决定这个写手是什么性格的说书人')
    expect(blocks[0].body).toBe('你是专业的网络小说作家。')
  })

  test('未闭合的标记整块丢弃，不抛错', () => {
    const blocks = parseProseBlocks('前言\n<!-- narracat:prose id="a" title="A" -->\n正文没有闭合')
    expect(blocks).toEqual([])
  })

  test('闭标记前又出现开标记：丢弃前一个，保留后一个', () => {
    const text =
      '<!-- narracat:prose id="a" title="A" -->\n甲\n' +
      '<!-- narracat:prose id="b" title="B" -->\n乙\n<!-- /narracat:prose -->'
    const blocks = parseProseBlocks(text)
    expect(blocks.map((b) => b.id)).toEqual(['b'])
    expect(blocks[0].body).toBe('乙')
  })

  test('重复 id 只保留第一个', () => {
    const text =
      '<!-- narracat:prose id="a" title="A1" -->\n甲\n<!-- /narracat:prose -->\n' +
      '<!-- narracat:prose id="a" title="A2" -->\n乙\n<!-- /narracat:prose -->'
    const blocks = parseProseBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].title).toBe('A1')
  })

  test('title 缺失回退为 id；id 非法则丢弃整块', () => {
    const okText = '<!-- narracat:prose id="a-b" -->\n甲\n<!-- /narracat:prose -->'
    expect(parseProseBlocks(okText)[0].title).toBe('a-b')

    const badText = '<!-- narracat:prose id="A_B" title="X" -->\n甲\n<!-- /narracat:prose -->'
    expect(parseProseBlocks(badText)).toEqual([])

    const noIdText = '<!-- narracat:prose title="X" -->\n甲\n<!-- /narracat:prose -->'
    expect(parseProseBlocks(noIdText)).toEqual([])
  })

  test('无标记的普通文本返回空数组', () => {
    expect(parseProseBlocks('# 标题\n\n正文。')).toEqual([])
  })
})

describe('applyProseOverrides', () => {
  test('无 override 也必须移除标记（模型不该看到注释）', () => {
    const result = applyProseOverrides(SAMPLE, {})
    expect(result.text).not.toContain('narracat:prose')
    expect(result.text).toContain('你是专业的网络小说作家。')
    expect(result.applied).toEqual([])
  })

  test('override 替换块正文并移除标记', () => {
    const result = applyProseOverrides(SAMPLE, { 'writer-persona': entry('你是毒舌说书人。') })
    expect(result.text).toContain('你是毒舌说书人。')
    expect(result.text).not.toContain('你是专业的网络小说作家。')
    expect(result.text).not.toContain('narracat:prose')
    expect(result.applied).toEqual(['writer-persona'])
    expect(result.skipped).toEqual([])
  })

  test('空串是合法 override，语义为删掉这条官方规则', () => {
    const result = applyProseOverrides(SAMPLE, { 'writer-persona': entry('') })
    expect(result.text).not.toContain('你是专业的网络小说作家。')
    expect(result.applied).toEqual(['writer-persona'])
    expect(result.skipped).toEqual([])
  })

  test('override 指向不存在的 id → skipped not-found，其余照常', () => {
    const result = applyProseOverrides(SAMPLE, { 'no-such-block': entry('x') })
    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual([{ id: 'no-such-block', reason: 'not-found' }])
    expect(result.text).not.toContain('narracat:prose')
  })

  test('块外的正文与锁死段落原样保留', () => {
    const result = applyProseOverrides(SAMPLE, { 'writer-persona': entry('新人设。') })
    expect(result.text).toContain('## 停下来的情况')
    expect(result.text).toContain('- 读不到就停。')
    expect(result.text.startsWith('你是写手。')).toBe(true)
  })
})

describe('resolveBlockStatus', () => {
  const block = parseProseBlocks(SAMPLE)[0]

  test('无 override → clean', () => {
    expect(resolveBlockStatus(block, undefined)).toBe('clean')
  })

  test('baseText 与当前原文一致 → clean', () => {
    expect(resolveBlockStatus(block, entry('我的版本'))).toBe('clean')
  })

  test('baseText 与当前原文不一致 → official-updated', () => {
    expect(resolveBlockStatus(block, entry('我的版本', '官方的旧文案'))).toBe('official-updated')
  })

  test('块已从引擎消失 → missing', () => {
    expect(resolveBlockStatus(undefined, entry('我的版本'))).toBe('missing')
  })

  test('块不存在且无 override → clean（无事发生）', () => {
    expect(resolveBlockStatus(undefined, undefined)).toBe('clean')
  })
})

describe('去除字符上限后（spec §5.2：只警告不阻断）', () => {
  test('超长 override 照常应用，不再被静默丢弃', () => {
    const text = '<!-- narracat:prose id="a" -->原文<!-- /narracat:prose -->'
    const long = '很'.repeat(5000)
    const result = applyProseOverrides(text, {
      a: { text: long, baseText: '原文', baseEngineVersion: '', updatedAt: '' },
    })
    expect(result.text).toBe(long)
    expect(result.applied).toEqual(['a'])
    expect(result.skipped).toEqual([])
  })
})
