import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveEngineAgentDefinitions } from './engine-agent-registry'

function makeAgentCore(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'narracat-registry-'))
  mkdirSync(join(root, 'agents'), { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, 'agents', name), content)
  return root
}

const CHAPTER_WRITER_MD = `---\nname: chapter-writer\ndescription: Writes chapters.\ntools: Read, Write\n---\n\n热写正文。`

const CHAPTER_WRITER_WITH_PROSE_BLOCK_MD = `---\nname: chapter-writer\ndescription: Writes chapters.\ntools: Read, Write\n---\n\n<!-- narracat:prose id="writer-persona" title="人设" -->\n官方人设。\n<!-- /narracat:prose -->`

describe('resolveEngineAgentDefinitions', () => {
  test('解析引擎 agent 文件为定义（description/prompt/tools）', async () => {
    const root = makeAgentCore({ 'chapter-writer.md': CHAPTER_WRITER_MD })
    const registry = await resolveEngineAgentDefinitions({ agentCorePath: root })
    expect(registry['chapter-writer']).toMatchObject({
      description: 'Writes chapters.',
      tools: ['Read', 'Write'],
    })
    expect(registry['chapter-writer'].prompt).toContain('热写正文')
  })

  test('overrides 同名整体覆盖（作者要求 inline prompt 生效，I-1）', async () => {
    const root = makeAgentCore({ 'chapter-writer.md': CHAPTER_WRITER_MD })
    const registry = await resolveEngineAgentDefinitions({
      agentCorePath: root,
      overrides: { 'chapter-writer': { description: 'Writes chapters.', prompt: '热写正文。\n\n## 我对它的要求\n\n短句成瘾', tools: ['Read', 'Write'] } },
    })
    expect(registry['chapter-writer'].prompt).toContain('短句成瘾')
  })

  test('override 形状非法时回落引擎默认并保留其余 agent', async () => {
    const root = makeAgentCore({ 'chapter-writer.md': CHAPTER_WRITER_MD })
    const registry = await resolveEngineAgentDefinitions({
      agentCorePath: root,
      overrides: { 'chapter-writer': { prompt: 42 } },
    })
    expect(registry['chapter-writer'].prompt).toContain('热写正文')
  })

  test('proseOverrides 第三参透传到默认路径（无挂载变化时 pi 实际走的路径），prompt 是覆盖后的文本', async () => {
    const root = makeAgentCore({ 'chapter-writer.md': CHAPTER_WRITER_WITH_PROSE_BLOCK_MD })
    const registry = await resolveEngineAgentDefinitions({
      agentCorePath: root,
      proseOverrides: {
        'writer-persona': {
          text: '我的人设。',
          baseText: '官方人设。',
          baseEngineVersion: '4.0.162',
          updatedAt: '2026-08-06T10:00:00+08:00',
        },
      },
    })
    expect(registry['chapter-writer'].prompt).toContain('我的人设。')
    expect(registry['chapter-writer'].prompt).not.toContain('官方人设。')
    expect(registry['chapter-writer'].prompt).not.toContain('narracat:prose')
  })

  test('文件缺失的 agent 不进注册表（fail-soft）但留 console.warn——静默跳过会让派发端只看到「没这个 agent」', async () => {
    const root = makeAgentCore({ 'chapter-writer.md': CHAPTER_WRITER_MD })
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '))
    }
    try {
      const registry = await resolveEngineAgentDefinitions({ agentCorePath: root })
      expect(registry['memory-keeper']).toBeUndefined()
    } finally {
      console.warn = originalWarn
    }
    expect(warnings.some((line) => line.includes('memory-keeper'))).toBe(true)
    expect(warnings.some((line) => line.includes('chapter-writer'))).toBe(false)
  })
})
