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

  test('overrides 同名整体覆盖（用户 Skill inline prompt 生效，I-1）', async () => {
    const root = makeAgentCore({ 'chapter-writer.md': CHAPTER_WRITER_MD })
    const registry = await resolveEngineAgentDefinitions({
      agentCorePath: root,
      overrides: { 'chapter-writer': { description: 'Writes chapters.', prompt: '热写正文。\n\n## 已挂载技能\n\n### 我的技能\n\n短句成瘾', tools: ['Read', 'Write'] } },
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
