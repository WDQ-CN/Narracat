import { describe, expect, test } from 'bun:test'
import { parsePremiseToolResult } from './premise-client.ts'

function textResult(payload: unknown, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError }
}

describe('parsePremiseToolResult', () => {
  test('成功响应（ok:true）取 message', () => {
    const raw = textResult({ ok: true, cards: 3, message: '立项卡已入库：3 张卡' })
    expect(parsePremiseToolResult(raw)).toEqual({ ok: true, message: '立项卡已入库：3 张卡' })
  })

  test('校验失败（handler 正常 return ok:false + errors）保留 errors', () => {
    const errors = [
      { field: 'cards.0.fields.0.certainty', expected: 'canon|tentative|open', actual: 'draft', hint: '改用合法枚举' },
    ]
    const result = parsePremiseToolResult(textResult({ ok: false, errors }))
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(errors)
  })

  test('server 层异常（isError + error 文本）→ message', () => {
    const result = parsePremiseToolResult(textResult({ error: '工具执行异常' }, true))
    expect(result.ok).toBe(false)
    expect(result.message).toBe('工具执行异常')
  })

  test('text 非 JSON → 原文作 message', () => {
    const raw = { content: [{ type: 'text', text: 'Internal error: boom' }] }
    expect(parsePremiseToolResult(raw)).toEqual({ ok: false, message: 'Internal error: boom' })
  })

  test('无 content / 无 text part → 降级 ok:false', () => {
    expect(parsePremiseToolResult({}).ok).toBe(false)
    expect(parsePremiseToolResult({ content: [{ type: 'image' }] }).ok).toBe(false)
  })

  test('ok 缺失但有 errors → ok:false', () => {
    const raw = textResult({ errors: [{ hint: 'x' }] })
    expect(parsePremiseToolResult(raw).ok).toBe(false)
  })
})
