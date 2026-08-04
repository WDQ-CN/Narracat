import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownRenderer } from './MarkdownRenderer'

const markdown = [
  '# 标题',
  '',
  '正文包含 **重点**、*语气*、`inline-code` 和 [链接](https://example.com)。',
  '',
  '> 这是一段引用。',
  '',
  '1. 第一项',
  '2. 第二项',
  '',
  '- 线索',
  '- 冲突',
  '',
  '| 字段 | 值 |',
  '|---|---|',
  '| 长路径 | `/Users/writer/Documents/NarraCat/a-very-long-path-that-should-stay-inside-the-panel.md` |',
  '',
  '```ts',
  'const title = "星舰驶出港口"',
  '```',
].join('\n')

describe('MarkdownRenderer', () => {
  test('renders document markdown with GFM structure and bounded rich blocks', () => {
    const html = renderToStaticMarkup(<MarkdownRenderer text={markdown} variant="document" />)

    expect(html).toContain('data-markdown-renderer="document"')
    expect(html).toContain('<h1')
    expect(html).toContain('<strong')
    expect(html).toContain('<em')
    expect(html).toContain('<code')
    expect(html).toContain('<a')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer"')
    expect(html).toContain('<blockquote')
    expect(html).toContain('<ol')
    expect(html).toContain('<ul')
    expect(html).toContain('<table')
    expect(html).toContain('<pre')
    expect(html).toContain('max-w-full overflow-x-auto')
    expect(html).toContain('[content-visibility:auto]')
    expect(html).toContain('[contain-intrinsic-size:1px_32px]')
    expect(html).toContain('[contain-intrinsic-size:1px_220px]')
    expect(html).toContain('星舰驶出港口')
  })

  test('renders conversation markdown at the agent body scale with safe overflow', () => {
    const html = renderToStaticMarkup(<MarkdownRenderer text={markdown} variant="conversation" />)

    expect(html).toContain('data-markdown-renderer="conversation"')
    expect(html).toContain('min-w-0 w-full max-w-full overflow-hidden')
    expect(html).toContain('text-[15px] leading-7')
    expect(html).toContain('min-w-0 w-full max-w-full overflow-x-auto')
    expect(html).toContain('w-max min-w-full')
    expect(html).toContain('whitespace-pre-wrap break-words')
    expect(html).toContain('[overflow-wrap:anywhere]')
    expect(html).toContain('/Users/writer/Documents/NarraCat')
    // 会话消息不塌缩：流式期间占位/真实高度切换会抖动（本断言锁死回归）
    expect(html).not.toContain('content-visibility')
    expect(html).not.toContain('contain-intrinsic-size')
  })

  test('can render inline NarraCat command labels as custom pills, including command code spans', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        text={[
          '运行 /narracat:write，或选择 `/narracat:review 审修当前章`。',
          '',
          '```text',
          '/narracat:world',
          '```',
        ].join('\n')}
        variant="conversation"
        commandPillRenderer={(commandLabel, action) => (
          <button
            type="button"
            data-test-command-pill={commandLabel}
            data-test-command-action={action}
          >
            {commandLabel}
          </button>
        )}
      />,
    )

    expect(html).toContain('data-test-command-pill="/narracat:write"')
    expect(html).toContain('data-test-command-action="write-next"')
    expect(html).toContain('data-test-command-pill="/narracat:review"')
    expect(html).toContain('data-test-command-action="review"')
    expect(html).toContain('<code')
    expect(html).toContain('/narracat:world')
    expect(html).not.toContain('data-test-command-pill="/narracat:world"')
  })

  test('markdown 图片语法不产生 img 标签（离线应用不加载远程图片）', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer text={'说明 ![示意图](https://evil.example/track.png) 结尾'} variant="document" />,
    )

    expect(html).not.toContain('<img')
    expect(html).toContain('[图片：示意图]')
  })
})
