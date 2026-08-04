import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, mock, test } from 'bun:test'

mock.module('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  shell: {
    openExternal: () => undefined,
  },
}))

describe('window options', () => {
  test('does not rely on CommonJS dirname in the ESM main process', async () => {
    const source = await readFile(join(import.meta.dirname, 'window.ts'), 'utf-8')

    expect(source).not.toContain('__dirname')
  })

  test('resolves preload path in the ESM main process', async () => {
    const { getWindowOptions } = await import('./window')
    const options = getWindowOptions('darwin')

    expect(options.webPreferences?.preload).toBe(join(import.meta.dirname, '../preload/index.cjs'))
  })
})

// 社区能力包 README（不可信第三方 markdown）经 MarkdownRenderer 渲染的链接全流向 setWindowOpenHandler，
// 该白名单是唯一收口点：file:// / 自定义 scheme 是真实攻击面，必须静默拒绝而非弹窗（安全默认）。
describe('isSafeExternalUrl', () => {
  test('放行常规网页与邮件协议', async () => {
    const { isSafeExternalUrl } = await import('./window')

    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    expect(isSafeExternalUrl('https://example.com/path?x=1')).toBe(true)
    expect(isSafeExternalUrl('mailto:a@b.com')).toBe(true)
  })

  test('拒绝本地文件/脚本/自定义 scheme/非法字符串', async () => {
    const { isSafeExternalUrl } = await import('./window')

    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('myapp://x')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
  })
})
