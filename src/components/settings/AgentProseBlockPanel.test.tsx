import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Dialog } from '@/components/ui/dialog'
import { AgentProseBlockPanelView, ProseBlockDetailBody, resetAllConfirmCopy } from './AgentProseBlockPanel'
import type { ProseBlockView } from '@shared/types/prose-block'

const CLEAN: ProseBlockView = {
  id: 'writer-persona',
  title: '写手的人设',
  hint: '决定这位写手是什么性格的说书人',
  officialText: '你是专业的网络小说作家。',
  userText: null,
  baseText: null,
  status: 'clean',
}

describe('AgentProseBlockPanelView（行内=整行可点，正文改动全部挪进弹窗）', () => {
  test('无调整时行上显示标题与官方正文摘要，不出现"官方已更新"', () => {
    const html = renderToStaticMarkup(<AgentProseBlockPanelView views={[CLEAN]} />)
    expect(html).toContain('写手的人设')
    expect(html).toContain('你是专业的网络小说作家。')
    expect(html).not.toContain('官方已更新')
  })

  test('有调整时行上显示作者版本而非官方原文', () => {
    const html = renderToStaticMarkup(
      <AgentProseBlockPanelView views={[{ ...CLEAN, userText: '你是毒舌说书人。' }]} />,
    )
    expect(html).toContain('你是毒舌说书人。')
    expect(html).not.toContain('你是专业的网络小说作家。')
  })

  test('已调整的块行内标"已调整"', () => {
    const html = renderToStaticMarkup(
      <AgentProseBlockPanelView views={[{ ...CLEAN, userText: '你是毒舌说书人。' }]} />,
    )
    expect(html).toContain('已调整')
  })

  test('官方更新过 → 行内标"官方已更新"', () => {
    const html = renderToStaticMarkup(
      <AgentProseBlockPanelView
        views={[{ ...CLEAN, userText: '我的版本。', baseText: '官方旧文案。', status: 'official-updated' }]}
      />,
    )
    expect(html).toContain('官方已更新')
  })

  test('官方内容已不存在 → 行内标"已不存在"', () => {
    const html = renderToStaticMarkup(
      <AgentProseBlockPanelView
        views={[{ ...CLEAN, officialText: '', userText: '我的孤儿。', baseText: '早年文案。', status: 'missing' }]}
      />,
    )
    expect(html).toContain('已不存在')
  })

  test('整行可点 + 键盘可达：role=button / tabIndex / 可访问名（同 SkillMountRow 写法，不自创一套）', () => {
    const html = renderToStaticMarkup(<AgentProseBlockPanelView views={[CLEAN]} />)
    expect(html).toContain('role="button"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="查看「写手的人设」详情"')
  })

  test('文案不含开发黑话（行内）', () => {
    const html = renderToStaticMarkup(
      <AgentProseBlockPanelView
        views={[{ ...CLEAN, userText: '我的版本。', baseText: '官方旧文案。', status: 'official-updated' }]}
      />,
    )
    for (const jargon of ['prompt', 'Prompt', '提示词', '注入', 'override', '散文', '块', 'runtime', 'schema']) {
      expect(html).not.toContain(jargon)
    }
  })

  test('没有可调整内容时整个区域不渲染', () => {
    const html = renderToStaticMarkup(<AgentProseBlockPanelView views={[]} />)
    expect(html).toBe('')
  })

  test('selectedId 指向未知 id（弹窗已关闭/数据尚未刷新等边界情况）不崩溃，安全降级为不渲染弹窗内容', () => {
    // 注：Dialog/DialogContent 走 Radix Portal，renderToStaticMarkup 不会渲染 Portal 挂载的内容
    // （React SSR 的既有限制，非本组件设计选择，故弹窗正文拆出 ProseBlockDetailBody 单独测，
    // 不指望能在完整面板的 SSR 输出里读到弹窗正文）。这里只验证 selectedId 指向不存在的 id 时
    // 安全降级、不抛错；弹窗正文的实质断言（官方原文/编辑区/字数/三栏对照/孤儿无编辑区）都在
    // 下面 ProseBlockDetailBody 的用例里。
    expect(() =>
      renderToStaticMarkup(<AgentProseBlockPanelView views={[CLEAN]} selectedId="no-such-id" draft="" />),
    ).not.toThrow()
  })

  test('全部恢复入口的文案指名当前 Agent，不再是含糊的"全部"（修复曾经会误清其他 Agent 的缺陷）', () => {
    const html = renderToStaticMarkup(
      <AgentProseBlockPanelView views={[{ ...CLEAN, userText: '你是毒舌说书人。' }]} agentName="章节写手" />,
    )
    expect(html).toContain('章节写手')
    expect(html).not.toContain('全部恢复官方默认')
  })

  test('只有孤儿调整时不计入"恢复默认"的承诺范围：生效回执不出现，恢复入口按钮也不出现', () => {
    const html = renderToStaticMarkup(
      <AgentProseBlockPanelView
        views={[{ ...CLEAN, officialText: '', userText: '我的孤儿。', baseText: '早年文案。', status: 'missing' }]}
        agentName="章节写手"
      />,
    )
    expect(html).not.toContain('处调整正在生效')
    expect(html).not.toContain('恢复「章节写手」的默认写法')
  })

  test('孤儿与生效中的调整混在一起时，生效回执与恢复入口只算生效中的那一条，不把孤儿也算进去', () => {
    const html = renderToStaticMarkup(
      <AgentProseBlockPanelView
        views={[
          { ...CLEAN, userText: '你是毒舌说书人。' },
          {
            ...CLEAN,
            id: 'gone-block',
            officialText: '',
            userText: '我的孤儿。',
            baseText: '早年文案。',
            status: 'missing',
          },
        ]}
        agentName="章节写手"
      />,
    )
    expect(html).toContain('你的 1 处调整正在生效')
    expect(html).toContain('恢复「章节写手」的默认写法')
  })
})

describe('ProseBlockDetailBody（详情弹窗正文，脱离 Dialog 容器单测）', () => {
  test('官方更新过：三栏对照都在（你当初改的是这一版 / 现在官方写的是 / 你的版本），且仍给编辑区', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <ProseBlockDetailBody
          view={{ ...CLEAN, userText: '我的版本。', baseText: '官方旧文案。', status: 'official-updated' }}
          draft="我的版本。"
        />
      </Dialog>,
    )
    expect(html).toContain('你当初改的是这一版：')
    expect(html).toContain('官方旧文案。')
    expect(html).toContain('现在官方写的是：')
    expect(html).toContain('你的版本：')
    expect(html).toContain('我的版本。')
    expect(html).toContain('<textarea')
  })

  test('孤儿状态的弹窗没有编辑区：不出现 <textarea>，只有说明与删除入口', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <ProseBlockDetailBody
          view={{ ...CLEAN, officialText: '', userText: '我的孤儿。', baseText: '早年文案。', status: 'missing' }}
        />
      </Dialog>,
    )
    expect(html).not.toContain('<textarea')
    expect(html).toContain('这段内容在新版里已经没有了，你之前的调整不再起作用。')
    expect(html).toContain('删除')
  })

  test('清空草稿仍可保存：不加"不能为空"校验（分块覆盖胜过只追加的核心价值）', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <ProseBlockDetailBody view={{ ...CLEAN, userText: '之前写的。' }} draft="" />
      </Dialog>,
    )
    expect(html).not.toContain('不能为空')
    expect(html).toContain('保存')
  })

  test('已被调整过的块，弹窗底部多给"复原为官方默认"；未调整过的块不给', () => {
    const adjustedHtml = renderToStaticMarkup(
      <Dialog open>
        <ProseBlockDetailBody view={{ ...CLEAN, userText: '我的版本。' }} draft="我的版本。" />
      </Dialog>,
    )
    expect(adjustedHtml).toContain('复原为官方默认')

    const cleanHtml = renderToStaticMarkup(
      <Dialog open>
        <ProseBlockDetailBody view={CLEAN} draft={CLEAN.officialText} />
      </Dialog>,
    )
    expect(cleanHtml).not.toContain('复原为官方默认')
  })

  test('文案不含开发黑话（弹窗正文，含 official-updated 三栏对照与孤儿说明两种状态）', () => {
    const officialUpdatedHtml = renderToStaticMarkup(
      <Dialog open>
        <ProseBlockDetailBody
          view={{ ...CLEAN, userText: '我的版本。', baseText: '官方旧文案。', status: 'official-updated' }}
          draft="我的版本。"
        />
      </Dialog>,
    )
    const missingHtml = renderToStaticMarkup(
      <Dialog open>
        <ProseBlockDetailBody
          view={{ ...CLEAN, officialText: '', userText: '我的孤儿。', baseText: '早年文案。', status: 'missing' }}
        />
      </Dialog>,
    )
    for (const jargon of ['prompt', 'Prompt', '提示词', '注入', 'override', '散文', '块', 'runtime', 'schema']) {
      expect(officialUpdatedHtml).not.toContain(jargon)
      expect(missingHtml).not.toContain(jargon)
    }
  })
})

describe('resetAllConfirmCopy（恢复当前 Agent 默认的二次确认文案）', () => {
  test('标题与正文都指名当前 Agent，不是含糊的"全部"', () => {
    const copy = resetAllConfirmCopy('大纲架构师')
    expect(copy.title).toContain('大纲架构师')
    expect(String(copy.description)).toContain('大纲架构师')
  })

  test('是不可逆的破坏性操作：danger=true，且正文说明不可撤销', () => {
    const copy = resetAllConfirmCopy('章节写手')
    expect(copy.danger).toBe(true)
    expect(String(copy.description)).toContain('无法撤销')
  })

  test('文案不含开发黑话', () => {
    const copy = resetAllConfirmCopy('章节写手')
    const text = `${copy.title} ${String(copy.description)}`
    for (const jargon of ['prompt', 'Prompt', '提示词', '注入', 'override', '散文', '块', 'runtime', 'schema']) {
      expect(text).not.toContain(jargon)
    }
  })

  test('不再说"全部"，且说清"已不存在"的旧调整不在这次范围内（修复虚假完成信号）', () => {
    const copy = resetAllConfirmCopy('章节写手')
    expect(String(copy.description)).not.toContain('全部')
    expect(String(copy.description)).toContain('已不存在')
  })
})
