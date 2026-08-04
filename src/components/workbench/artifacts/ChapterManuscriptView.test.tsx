import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChapterManuscriptView } from './ChapterManuscriptView'
import type { NovelArtifact } from '@shared/types/novel'

const artifact: NovelArtifact = {
  kind: 'manuscript',
  title: '第 013 章',
  path: '/p/manuscript/vol-01/ch-013.md',
  exists: true,
  content: '林昭推开门。\n\n<!-- chapter_metadata: {"chapter_num":13} -->',
}

describe('ChapterManuscriptView · 阅读态', () => {
  test('离开对话只提供保留、继续、明确放弃，默认聚焦保留草稿', () => {
    const source = readFileSync(fileURLToPath(new URL('./ChapterManuscriptView.tsx', import.meta.url)), 'utf-8')

    expect(source).toContain('保留草稿并离开')
    expect(source).toContain('继续编辑')
    expect(source).toContain('放弃草稿并离开')
    expect(source).not.toContain('保存并离开')
    expect(source).toContain('autoFocus')
  })

  // 编辑/保存/取消/同步本章记忆全部收进 titlebar 动作区（WorkbenchStage 驱动），
  // 内容区不再放浮动按钮——这里只断言正文本身，不断言任何 data-manuscript-action。
  test('渲染正文，不出现内容区浮动按钮（元数据注释不外显）', () => {
    const html = renderToStaticMarkup(
      <ChapterManuscriptView artifact={artifact} projectPath="/p" chapter={13} agentBusy={false} />,
    )
    expect(html).not.toContain('data-manuscript-action')
    expect(html).toContain('林昭推开门。')
    expect(html).not.toContain('chapter_metadata')
  })

  test('agentBusy 时同样不出现内容区浮动按钮', () => {
    const html = renderToStaticMarkup(
      <ChapterManuscriptView artifact={artifact} projectPath="/p" chapter={13} agentBusy={true} />,
    )
    expect(html).not.toContain('data-manuscript-action')
  })

})

// 编辑态（store.editing=true）整体替换为编辑器的行为不在此覆盖：zustand v5 的 useSyncExternalStore
// 服务端快照固定读 getInitialState()（非当前 getState()），renderToStaticMarkup 无法反映渲染前的
// store mutation，只能验证默认（未编辑）态。editing/saving/handlers 字段本身的读写在
// manuscript-editor-guard.test.ts 覆盖；「if (editing) 提前 return 编辑器且不渲染保存/取消按钮」
// 这条分支逻辑走真机人工验证（见 titlebar-rework-report.md）。
