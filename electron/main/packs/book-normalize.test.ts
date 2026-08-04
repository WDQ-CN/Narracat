import { describe, expect, test } from 'bun:test'
import { decodeBookBuffer, cleanBookLines, splitBookChapters } from './book-normalize'

describe('decodeBookBuffer', () => {
  test('utf8 文本判 utf8', () => {
    const buf = new TextEncoder().encode('第一章 风起\n他来了。')
    expect(decodeBookBuffer(buf).encoding).toBe('utf8')
  })
  test('gb18030 字节判 gb18030 且解出中文', () => {
    // '第一章' 的 GBK 编码字节（GB18030 兼容 GBK）
    const gbk = new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2])
    const out = decodeBookBuffer(gbk)
    expect(out.encoding).toBe('gb18030')
    expect(out.text).toBe('第一章')
  })
})

describe('cleanBookLines', () => {
  test('剔除广告行，保留正文', () => {
    const dirty = '正文第一行\n本书首发 www.example.com 最快更新\n正文第二行'
    const out = cleanBookLines(dirty)
    expect(out).not.toContain('www.example.com')
    expect(out).toContain('正文第一行')
    expect(out).toContain('正文第二行')
  })

  test('正文含裸「首发/书吧」关键词不被误删', () => {
    const text = '他在书吧打工\n她买下首发限量款球鞋'
    const out = cleanBookLines(text)
    expect(out).toContain('他在书吧打工')
    expect(out).toContain('她买下首发限量款球鞋')
  })

  test('强广告信号（本书首发/最快更新/无弹窗/笔趣阁）仍被剔除', () => {
    const text = '正文第一行\n本书首发于笔趣阁\n最快更新无弹窗\n正文第二行'
    const out = cleanBookLines(text)
    expect(out).not.toContain('本书首发于笔趣阁')
    expect(out).not.toContain('最快更新无弹窗')
    expect(out).toContain('正文第一行')
    expect(out).toContain('正文第二行')
  })
})

describe('splitBookChapters', () => {
  test('「第N章」标题切分（阿拉伯+中文数字）', () => {
    const text = '第1章 风起\n正文一\n第2章 云涌\n正文二\n第三章 雨落\n正文三'
    const chapters = splitBookChapters(text)
    expect(chapters.length).toBe(3)
    expect(chapters[0].title).toContain('风起')
    expect(chapters[2].body).toContain('正文三')
  })
  test('切不出 ≥3 章时按字数分块降级', () => {
    const text = '没有章节标记的长文。'.repeat(1000) // 1万字
    const chapters = splitBookChapters(text)
    expect(chapters.length).toBeGreaterThanOrEqual(3)
    expect(chapters[0].title).toBe('片段 1')
  })

  test('标题带空格「第 1 章」也能切分', () => {
    const text = '第 1 章 风起\n正文一\n第2 章 云涌\n正文二\n第 3章 雨落\n正文三'
    const chapters = splitBookChapters(text)
    expect(chapters.length).toBe(3)
    expect(chapters[0].title).toContain('风起')
    expect(chapters[2].body).toContain('正文三')
  })

  test('全角数字标题「第１章」也能切分', () => {
    const text = '第１章 风起\n正文一\n第２章 云涌\n正文二\n第３章 雨落\n正文三'
    const chapters = splitBookChapters(text)
    expect(chapters.length).toBe(3)
    expect(chapters[0].title).toContain('风起')
    expect(chapters[2].body).toContain('正文三')
  })
})
