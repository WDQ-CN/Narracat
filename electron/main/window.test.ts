import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, mock, test } from 'bun:test'

// mock.module 是全进程注册表，先注册的那份决定 'electron' 在整轮 bun test 里的形状。
// 所以这份 mock 不能只放 window.ts 用得到的两个——本文件之后加载的任何主进程模块，
// 只要静态 import 了这里没列出的具名导出，就会在解析期直接报「Export named X not found」，
// 而文件顺序在本机和 CI 上并不一致（同款事故：本机全绿、Linux CI 红）。
// 新增主进程模块用到别的 electron API 时，同步补进这份 mock。
mock.module('electron', () => ({
  app: {
    emit: () => undefined,
  },
  BrowserWindow: class BrowserWindow {
    static getAllWindows() {
      return []
    }
  },
  Notification: class Notification {
    static isSupported() {
      return true
    }
  },
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
