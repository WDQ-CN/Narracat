import { describe, expect, test } from 'bun:test'
import { collectProseBlockViolations } from './check-prose-blocks.mjs'
import { parseProseBlocks } from '../shared/lib/prose-blocks'

const OK_FILE = '<!-- narracat:prose id="a-one" title="甲" -->\n甲\n<!-- /narracat:prose -->'

// 评审复现：同文件里第一个块没写闭标记，紧接着第二个块正常开合。
// 未闭合的 a-one 不该借用 b-two 的闭标记蒙混过关。
const DANGLING_FIRST_BLOCK = [
  '<!-- narracat:prose id="a-one" title="甲" -->',
  'text-a',
  '<!-- narracat:prose id="b-two" title="乙" -->',
  'text-b',
  '<!-- /narracat:prose -->',
].join('\n')

describe('collectProseBlockViolations', () => {
  test('标记闭合、id 合法、与 lock 一致 → 无违规', () => {
    const violations = collectProseBlockViolations({
      files: [{ path: 'agents/x.md', content: OK_FILE }],
      lockIds: ['a-one'],
    })
    expect(violations).toEqual([])
  })

  test('未闭合的开标记要报出来', () => {
    const violations = collectProseBlockViolations({
      files: [{ path: 'agents/x.md', content: '<!-- narracat:prose id="a-one" title="甲" -->\n甲' }],
      lockIds: [],
    })
    expect(violations.some((v) => v.rule === 'unclosed')).toBe(true)
  })

  test('id 非 kebab-case 要报出来', () => {
    const violations = collectProseBlockViolations({
      files: [{ path: 'agents/x.md', content: '<!-- narracat:prose id="A_One" title="甲" -->\n甲\n<!-- /narracat:prose -->' }],
      lockIds: [],
    })
    expect(violations.some((v) => v.rule === 'bad-id')).toBe(true)
  })

  test('跨文件重复 id 要报出来', () => {
    const violations = collectProseBlockViolations({
      files: [
        { path: 'agents/x.md', content: OK_FILE },
        { path: 'agents/y.md', content: OK_FILE },
      ],
      lockIds: ['a-one'],
    })
    expect(violations.some((v) => v.rule === 'duplicate-id')).toBe(true)
  })

  test('新增 id 未写进 lock 要报出来', () => {
    const violations = collectProseBlockViolations({
      files: [{ path: 'agents/x.md', content: OK_FILE }],
      lockIds: [],
    })
    expect(violations.some((v) => v.rule === 'missing-from-lock')).toBe(true)
  })

  test('lock 里有、文件里没了（改名或删除）要报出来', () => {
    const violations = collectProseBlockViolations({
      files: [{ path: 'agents/x.md', content: OK_FILE }],
      lockIds: ['a-one', 'gone-block'],
    })
    const violation = violations.find((v) => v.rule === 'removed-without-lock-update')
    expect(violation).toBeDefined()
    expect(violation?.id).toBe('gone-block')
  })

  test('未闭合块后紧跟另一个块时，不能把后者的闭标记错配给它', () => {
    const violations = collectProseBlockViolations({
      files: [{ path: 'agents/x.md', content: DANGLING_FIRST_BLOCK }],
      lockIds: ['b-two'],
    })
    const aViolation = violations.find((v) => v.id === 'a-one')
    expect(aViolation?.rule).toBe('unclosed')
    expect(violations.some((v) => v.id === 'b-two' && v.rule === 'unclosed')).toBe(false)
  })

  test('守卫与运行时解析器对同一段畸形文本判断一致——守卫报 unclosed 的块，parseProseBlocks 也不会返回它', () => {
    const violations = collectProseBlockViolations({
      files: [{ path: 'agents/x.md', content: DANGLING_FIRST_BLOCK }],
      lockIds: ['a-one', 'b-two'],
    })
    const unclosedIds = violations.filter((v) => v.rule === 'unclosed').map((v) => v.id)
    expect(unclosedIds).toEqual(['a-one'])

    const parsedIds = parseProseBlocks(DANGLING_FIRST_BLOCK).map((block) => block.id)
    for (const id of unclosedIds) {
      expect(parsedIds).not.toContain(id)
    }
    expect(parsedIds).toContain('b-two')
  })
})
