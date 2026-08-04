import { describe, expect, test } from 'bun:test'

import { consumeCharacterChatStream, createBubbleSplitter, extractTextDelta, stripStageDirections } from './character-chat-stream'

async function* fromArray(items: unknown[]): AsyncIterable<unknown> {
  for (const item of items) yield item
}

/** Anthropic SDK 流事件：content_block_delta + text_delta。 */
function textDelta(text: string) {
  return { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
}

describe('extractTextDelta', () => {
  test('提取 content_block_delta 的 text_delta', () => {
    expect(extractTextDelta(textDelta('你'))).toBe('你')
  })

  test('忽略非文本 delta 与其它事件', () => {
    // input_json_delta（工具入参流）不外露
    expect(
      extractTextDelta({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{' } }),
    ).toBeNull()
    // thinking_delta 不外露
    expect(
      extractTextDelta({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '...' } }),
    ).toBeNull()
    // content_block_start / message_* 等忽略
    expect(extractTextDelta({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })).toBeNull()
    expect(extractTextDelta({ type: 'message_stop' })).toBeNull()
    expect(extractTextDelta(null)).toBeNull()
    // 空文本 delta 视为无增量
    expect(extractTextDelta(textDelta(''))).toBeNull()
  })
})

describe('consumeCharacterChatStream', () => {
  test('累加文本 delta 并逐条回调，返回这一段文本', async () => {
    const deltas: string[] = []
    const result = await consumeCharacterChatStream(
      fromArray([textDelta('你'), textDelta('好'), textDelta('呀')]),
      (text) => deltas.push(text),
    )

    expect(deltas).toEqual(['你', '好', '呀'])
    expect(result.text).toBe('你好呀')
  })

  test('忽略工具往返事件，UI 只收到角色文本增量', async () => {
    const deltas: string[] = []
    await consumeCharacterChatStream(
      fromArray([
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'novel_character_state', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"character_uid"' } },
        textDelta('嗯'),
      ]),
      (text) => deltas.push(text),
    )
    expect(deltas).toEqual(['嗯'])
  })
})

describe('stripStageDirections', () => {
  test('删除整段全角括号旁白', () => {
    expect(stripStageDirections('（愣了一下）你怎么知道的')).toBe('你怎么知道的')
  })

  test('删除句中括号旁白并规整空白', () => {
    expect(stripStageDirections('我捏着药草（沉默了几秒）半天没说话')).toBe('我捏着药草半天没说话')
  })

  test('删除半角括号旁白', () => {
    expect(stripStageDirections('(冷笑)随便你')).toBe('随便你')
  })

  test('保留正常文本与气泡内单换行', () => {
    expect(stripStageDirections('第一行\n第二行')).toBe('第一行\n第二行')
  })

  test('整条都是旁白时清理后为空串', () => {
    expect(stripStageDirections('（只是站着没动）')).toBe('')
  })
})

describe('createBubbleSplitter', () => {
  test('按空行切分，最后一条不完整的留待 flush', () => {
    const splitter = createBubbleSplitter()
    expect(splitter.push('第一条\n\n第二条')).toEqual(['第一条'])
    expect(splitter.flush()).toEqual(['第二条'])
  })

  test('逐字喂入也能在空行处切分（跨 chunk 边界）', () => {
    const splitter = createBubbleSplitter()
    const out: string[] = []
    for (const ch of 'A\n\nB') out.push(...splitter.push(ch))
    expect(out).toEqual(['A'])
    expect(splitter.flush()).toEqual(['B'])
  })

  test('多个连续空行视为一个边界', () => {
    const splitter = createBubbleSplitter()
    expect(splitter.push('甲\n\n\n乙\n\n')).toEqual(['甲', '乙'])
    expect(splitter.flush()).toEqual([])
  })

  test('无空行时全部留到 flush', () => {
    const splitter = createBubbleSplitter()
    expect(splitter.push('整段没有空行')).toEqual([])
    expect(splitter.flush()).toEqual(['整段没有空行'])
  })

  test('气泡内单换行保留', () => {
    const splitter = createBubbleSplitter()
    expect(splitter.push('上句\n下句\n\n')).toEqual(['上句\n下句'])
  })
})
