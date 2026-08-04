import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '@/components/ui/tooltip'

import { ClampedValueText, VALUE_CLAMP_THRESHOLD } from './ClampedValueText'

describe('ClampedValueText', () => {
  test('短文本渲染裸 span，无截断锚点', () => {
    const html = renderToStaticMarkup(<ClampedValueText text="青霜剑" />)
    expect(html).toContain('青霜剑')
    expect(html).not.toContain('data-clamped-value')
  })

  test('超长文本渲染截断 span + tooltip 全文', () => {
    const long = '一'.repeat(VALUE_CLAMP_THRESHOLD + 1)
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ClampedValueText text={long} />
      </TooltipProvider>,
    )
    expect(html).toContain('data-clamped-value="true"')
    expect(html).toContain('truncate')
    // 宽度交给容器（吃满行宽顶到边缘才截断）：锁定不回退到写死 max-w（走查回报：224px 提前砍字）
    expect(html).toContain('max-w-full')
    expect(html).not.toContain('max-w-56')
    expect(html).toContain(long)
  })
})
