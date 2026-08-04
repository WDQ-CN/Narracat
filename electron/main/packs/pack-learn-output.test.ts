import { describe, expect, test } from 'bun:test'
import { parseLearnOutput } from './pack-learn-output'

const VALID = JSON.stringify({
  cards: [
    { type: 'persona', name: '冷刃腔', one_line: '克制冷峻的叙述声', body: '你叙述时……\n[evidence]\n摘录', intent: '适合冷峻悬疑气质的书' },
    { type: 'craft', name: '留白收尾', one_line: '情绪顶点前停笔', body: '[runtime]\n机制名：留白收尾\n\n[evidence]\n摘录', intent: '高潮章用，过渡章不用' },
    { type: 'structure', name: '双线咬合', one_line: '两线交替推进', body: '机制……', intent: 'stage-1' },
  ],
  proper_nouns: ['聂风', '天霜城'],
})

describe('parseLearnOutput', () => {
  test('合法输出全量解析', () => {
    const r = parseLearnOutput(VALID)
    if (!r.ok) throw new Error(r.reason)
    expect(r.output.cards.length).toBe(3)
    expect(r.output.properNouns).toEqual(['聂风', '天霜城'])
    expect(r.output.droppedCount).toBe(0)
  })
  test('非法 JSON → 整体失败', () => {
    expect(parseLearnOutput('not json').ok).toBe(false)
  })
  test('structure 卡 intent 不在三值内 → 该卡丢弃，其余保留', () => {
    const bad = JSON.parse(VALID)
    bad.cards[2].intent = '随便写的'
    const r = parseLearnOutput(JSON.stringify(bad))
    if (!r.ok) throw new Error(r.reason)
    expect(r.output.cards.length).toBe(2)
    expect(r.output.droppedCount).toBe(1)
  })
  test('persona 多张只留第一张', () => {
    const dup = JSON.parse(VALID)
    dup.cards.push({ ...dup.cards[0], name: '第二腔' })
    const r = parseLearnOutput(JSON.stringify(dup))
    if (!r.ok) throw new Error(r.reason)
    expect(r.output.cards.filter((c: { type: string }) => c.type === 'persona').length).toBe(1)
    expect(r.output.cards.some((c: { name: string }) => c.name === '第二腔')).toBe(false)
    expect(r.output.droppedCount).toBe(1)
  })
  test('全部卡无效 → ok:false', () => {
    expect(parseLearnOutput(JSON.stringify({ cards: [{ type: 'unknown' }] })).ok).toBe(false)
  })
  test('pack_name：trim 后透出 packName（刀5 向导产出）', () => {
    const withName = JSON.parse(VALID)
    withName.pack_name = '  我的写法  '
    const r = parseLearnOutput(JSON.stringify(withName))
    if (!r.ok) throw new Error(r.reason)
    expect(r.output.packName).toBe('我的写法')
  })
  test('pack_name 缺省/空白/非字符串 → packName undefined，不影响解析（learn 路径零变化）', () => {
    const absent = parseLearnOutput(VALID)
    if (!absent.ok) throw new Error(absent.reason)
    expect(absent.output.packName).toBeUndefined()
    expect(absent.output.cards.length).toBe(3)

    const blank = JSON.parse(VALID)
    blank.pack_name = '   '
    const rBlank = parseLearnOutput(JSON.stringify(blank))
    if (!rBlank.ok) throw new Error(rBlank.reason)
    expect(rBlank.output.packName).toBeUndefined()

    const nonString = JSON.parse(VALID)
    nonString.pack_name = 123
    const rNonString = parseLearnOutput(JSON.stringify(nonString))
    if (!rNonString.ok) throw new Error(rNonString.reason)
    expect(rNonString.output.packName).toBeUndefined()
    expect(rNonString.output.cards.length).toBe(3)
  })
  test('proper_nouns 缺省容忍 → 空数组（向导输出契约无此字段）', () => {
    const noNouns = JSON.parse(VALID)
    delete noNouns.proper_nouns
    const r = parseLearnOutput(JSON.stringify(noNouns))
    if (!r.ok) throw new Error(r.reason)
    expect(r.output.properNouns).toEqual([])
    expect(r.output.cards.length).toBe(3)
  })
  test('cards 含 null 与字符串元素不抛异常，坏项被丢、合法卡保留', () => {
    const mixed = JSON.stringify({
      cards: [
        null,
        '字符串不是对象',
        { type: 'persona', name: '有效腔', one_line: '有效线', body: '有效正文', intent: '有效意图' },
      ],
      proper_nouns: [],
    })
    const r = parseLearnOutput(mixed)
    if (!r.ok) throw new Error(r.reason)
    expect(r.output.cards.length).toBe(1)
    expect(r.output.cards[0].name).toBe('有效腔')
    expect(r.output.droppedCount).toBe(2)
  })
})
