import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { OfficialSkillSectionView } from './OfficialSkillSection'

describe('OfficialSkillSectionView', () => {
  test('白名单内的 Agent 列出条目', () => {
    const html = renderToStaticMarkup(<OfficialSkillSectionView agentId="chapter-writer" />)
    expect(html).toContain('它自带的本事')
    expect(html).toContain('网文写作手艺')
  })

  test('白名单外的 Agent 整栏不渲染（没有就不提，不出空状态）', () => {
    const html = renderToStaticMarkup(<OfficialSkillSectionView agentId="memory-keeper" />)
    expect(html).toBe('')
  })

  test('不出现任何编辑或挂载入口', () => {
    const html = renderToStaticMarkup(<OfficialSkillSectionView agentId="chapter-writer" />)
    expect(html).not.toContain('编辑')
    expect(html).not.toContain('挂载')
  })
})
