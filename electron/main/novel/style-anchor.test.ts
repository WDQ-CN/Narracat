import { describe, expect, test } from 'bun:test'
import { parseSubmitStyleAnchorInput } from './style-anchor.ts'

describe('parseSubmitStyleAnchorInput', () => {
  test('add 合法入参解析', () => {
    expect(
      parseSubmitStyleAnchorInput({ projectPath: '/p', action: 'add', chapter: 3, excerpt: '  一段正文  ' }),
    ).toEqual({ projectPath: '/p', action: 'add', chapter: 3, excerpt: '一段正文' })
  })

  test('remove 合法入参解析', () => {
    expect(parseSubmitStyleAnchorInput({ projectPath: '/p', action: 'remove', anchorId: 'ch001-abcd1234' })).toEqual({
      projectPath: '/p',
      action: 'remove',
      anchorId: 'ch001-abcd1234',
    })
  })

  test('缺项目路径拒绝', () => {
    expect(() => parseSubmitStyleAnchorInput({ action: 'add', chapter: 1, excerpt: 'x' })).toThrow('缺少项目路径')
    expect(() => parseSubmitStyleAnchorInput({ projectPath: '  ', action: 'add', chapter: 1, excerpt: 'x' })).toThrow(
      '缺少项目路径',
    )
  })

  test('action 非法拒绝', () => {
    expect(() => parseSubmitStyleAnchorInput({ projectPath: '/p', action: 'delete' })).toThrow('操作类型不合法')
    expect(() => parseSubmitStyleAnchorInput({ projectPath: '/p' })).toThrow('操作类型不合法')
  })

  test('remove 缺 anchorId 拒绝', () => {
    expect(() => parseSubmitStyleAnchorInput({ projectPath: '/p', action: 'remove' })).toThrow('缺少要删除的样章标识')
    expect(() => parseSubmitStyleAnchorInput({ projectPath: '/p', action: 'remove', anchorId: '  ' })).toThrow(
      '缺少要删除的样章标识',
    )
  })

  test('add 缺章号或章号非法拒绝', () => {
    expect(() => parseSubmitStyleAnchorInput({ projectPath: '/p', action: 'add', excerpt: 'x' })).toThrow('缺少章号')
    expect(() =>
      parseSubmitStyleAnchorInput({ projectPath: '/p', action: 'add', chapter: 0, excerpt: 'x' }),
    ).toThrow('缺少章号')
    expect(() =>
      parseSubmitStyleAnchorInput({ projectPath: '/p', action: 'add', chapter: 1.5, excerpt: 'x' }),
    ).toThrow('缺少章号')
  })

  test('add 缺选中文字拒绝', () => {
    expect(() => parseSubmitStyleAnchorInput({ projectPath: '/p', action: 'add', chapter: 1 })).toThrow(
      '请先选中一段正文',
    )
    expect(() =>
      parseSubmitStyleAnchorInput({ projectPath: '/p', action: 'add', chapter: 1, excerpt: '   ' }),
    ).toThrow('请先选中一段正文')
  })
})
