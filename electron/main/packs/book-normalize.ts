/**
 * 外部 txt 书源 normalize（刀4）：编码探测（U+FFFD 计数评分，不依赖外部 iconv）、
 * 广告水印行清洗、章节切分（策略参照 scripts/corpus-factory/normalize.mjs，纯函数重实现）。
 */
export interface BookChapter {
  title: string
  body: string
}

// 标题容忍半角空格/tab/全角空格（原文常见「第 1 章」排版），数字统一在切分前做全角→半角归一。
const CHAPTER_HEADER_RE = /^\s*第[ \t　]*[0-9零一二三四五六七八九十百千两]+[ \t　]*[章回节][^\n]*$/gm
// 只保留强广告信号：裸「首发」「书吧」「笔趣」等词会命中「他在书吧打工」「买下首发限量款」等正文，
// 误伤正文比漏删广告糟——学习是抽样的，多一行广告没事，删一句正文是失真。
const AD_LINE_RE = /(https?:\/\/|www\.|最快更新|无弹窗|txt下载|笔趣阁|本书首发)/i
const FALLBACK_CHUNK = 3000
const FULLWIDTH_DIGIT_RE = /[０-９]/g

function fullwidthDigitsToHalf(text: string): string {
  return text.replace(FULLWIDTH_DIGIT_RE, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

export function decodeBookBuffer(buf: Uint8Array): { text: string; encoding: 'utf8' | 'gb18030' } {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  const utf8Bad = (utf8.match(/�/g) ?? []).length
  if (utf8Bad === 0) return { text: utf8, encoding: 'utf8' }
  const gbk = new TextDecoder('gb18030').decode(buf)
  const gbkBad = (gbk.match(/�/g) ?? []).length
  return gbkBad < utf8Bad ? { text: gbk, encoding: 'gb18030' } : { text: utf8, encoding: 'utf8' }
}

export function cleanBookLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !AD_LINE_RE.test(line))
    .join('\n')
}

export function splitBookChapters(rawText: string): BookChapter[] {
  // 正文里全角数字变半角是可接受的 normalize 语义（不影响可读性，换来章节标题可靠命中）。
  const text = fullwidthDigitsToHalf(rawText)
  const headers = [...text.matchAll(CHAPTER_HEADER_RE)]
  if (headers.length >= 3) {
    const chapters: BookChapter[] = []
    for (let i = 0; i < headers.length; i++) {
      const start = headers[i].index ?? 0
      const end = i + 1 < headers.length ? (headers[i + 1].index ?? text.length) : text.length
      const block = text.slice(start, end)
      const newline = block.indexOf('\n')
      chapters.push({
        title: (newline === -1 ? block : block.slice(0, newline)).trim(),
        body: (newline === -1 ? '' : block.slice(newline + 1)).trim(),
      })
    }
    return chapters.filter((c) => c.body.length > 0)
  }
  // 降级：无可靠章节标记，按 ~3000 字分块
  const chapters: BookChapter[] = []
  for (let i = 0, n = 1; i < text.length; i += FALLBACK_CHUNK, n++) {
    const body = text.slice(i, i + FALLBACK_CHUNK).trim()
    if (body) chapters.push({ title: `片段 ${n}`, body })
  }
  return chapters
}
