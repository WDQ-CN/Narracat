import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assembleAgentSkills, parseAgentFile } from './assemble-agent-skills'
import type { ProseOverrideEntry } from '@shared/types/prose-block'

/** 构建一个含 chapter-writer.md（带 writer-persona 散文块）的最小 Agent Core fixture 目录。 */
async function makeAgentCore(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narracat-assemble-'))
  await mkdir(join(root, 'agents'), { recursive: true })

  await writeFile(
    join(root, 'agents', 'chapter-writer.md'),
    [
      '---',
      'name: chapter-writer',
      'description: Writes chapters.',
      'tools: Read, Write',
      '---',
      '',
      '<!-- narracat:prose id="writer-persona" title="写手的人设" -->',
      '你是章节写手。',
      '<!-- /narracat:prose -->',
    ].join('\n'),
    'utf-8',
  )

  return root
}

describe('作者要求注入（spec §5.1）', () => {
  let FIXTURE_AGENT_CORE = ''

  beforeEach(async () => {
    FIXTURE_AGENT_CORE = await makeAgentCore()
  })

  afterEach(async () => {
    await rm(FIXTURE_AGENT_CORE, { recursive: true, force: true })
  })

  test('有要求时追加「作者对你的要求」段，按传入顺序编号', async () => {
    const agents = await assembleAgentSkills({
      agentCorePath: FIXTURE_AGENT_CORE,
      agentIds: ['chapter-writer'],
      authorRequestsByAgent: { 'chapter-writer': ['少写环境描写，多写对话', '每章结尾留一个悬念'] },
    })
    const prompt = agents['chapter-writer'].prompt
    expect(prompt).toContain('## 作者对你的要求（写作时必须遵守）')
    expect(prompt).toContain('1. 少写环境描写，多写对话')
    expect(prompt).toContain('2. 每章结尾留一个悬念')
    // 要求追加在末尾，官方 prompt 正文仍在前面
    expect(prompt.indexOf('## 作者对你的要求')).toBeGreaterThan(0)
  })

  test('空白要求被跳过，不产生空编号', async () => {
    const agents = await assembleAgentSkills({
      agentCorePath: FIXTURE_AGENT_CORE,
      agentIds: ['chapter-writer'],
      authorRequestsByAgent: { 'chapter-writer': ['   ', '真正的要求'] },
    })
    expect(agents['chapter-writer'].prompt).toContain('1. 真正的要求')
    expect(agents['chapter-writer'].prompt).not.toContain('2.')
  })

  test('既无要求也无散文覆盖的 Agent 不生成覆盖', async () => {
    const agents = await assembleAgentSkills({
      agentCorePath: FIXTURE_AGENT_CORE,
      agentIds: ['chapter-writer'],
    })
    expect(agents['chapter-writer']).toBeUndefined()
  })

  test('只有散文覆盖也要生成覆盖（否则作者的调整落空）', async () => {
    const agents = await assembleAgentSkills({
      agentCorePath: FIXTURE_AGENT_CORE,
      agentIds: ['chapter-writer'],
      proseOverrides: {
        'writer-persona': { text: '你是毒舌说书人。', baseText: '', baseEngineVersion: '', updatedAt: '' },
      },
    })
    expect(agents['chapter-writer'].prompt).toContain('你是毒舌说书人。')
  })

  test('组装出的定义不再带 skills 字段（pi 侧无消费者）', async () => {
    const agents = await assembleAgentSkills({
      agentCorePath: FIXTURE_AGENT_CORE,
      agentIds: ['chapter-writer'],
      authorRequestsByAgent: { 'chapter-writer': ['要求一条'] },
    })
    expect('skills' in agents['chapter-writer']).toBe(false)
  })
})

describe('parseAgentFile 应用散文覆盖', () => {
  let corePath = ''

  const AGENT_MD = `---
name: chapter-writer
description: writes chapters
tools: Read, Write
---

<!-- narracat:prose id="writer-persona" title="写手的人设" -->
你是专业的网络小说作家。
<!-- /narracat:prose -->

## 停下来的情况

- 读不到就停。
`

  beforeEach(async () => {
    corePath = await mkdtemp(join(tmpdir(), 'agent-core-'))
    await mkdir(join(corePath, 'agents'), { recursive: true })
    await writeFile(join(corePath, 'agents', 'chapter-writer.md'), AGENT_MD, 'utf-8')
  })

  afterEach(async () => {
    await rm(corePath, { recursive: true, force: true })
  })

  function entry(text: string): ProseOverrideEntry {
    return {
      text,
      baseText: '你是专业的网络小说作家。',
      baseEngineVersion: '4.0.162',
      updatedAt: '2026-08-06T10:00:00+08:00',
    }
  }

  test('不传 overrides 时也必须移除标记', async () => {
    const parsed = await parseAgentFile(corePath, 'chapter-writer')
    expect(parsed?.prompt).not.toContain('narracat:prose')
    expect(parsed?.prompt).toContain('你是专业的网络小说作家。')
  })

  test('传 overrides 时替换块正文', async () => {
    const parsed = await parseAgentFile(corePath, 'chapter-writer', { 'writer-persona': entry('你是毒舌说书人。') })
    expect(parsed?.prompt).toContain('你是毒舌说书人。')
    expect(parsed?.prompt).not.toContain('你是专业的网络小说作家。')
    expect(parsed?.prompt).not.toContain('narracat:prose')
  })

  test('锁死段落不受影响', async () => {
    const parsed = await parseAgentFile(corePath, 'chapter-writer', { 'writer-persona': entry('新人设。') })
    expect(parsed?.prompt).toContain('## 停下来的情况')
    expect(parsed?.prompt).toContain('- 读不到就停。')
  })

  test('override 指向不存在的块时静默跳过，官方原文照常', async () => {
    const parsed = await parseAgentFile(corePath, 'chapter-writer', { 'no-such-block': entry('x') })
    expect(parsed?.prompt).toContain('你是专业的网络小说作家。')
  })
})

describe('assembleAgentSkills 因散文覆盖而生成定义', () => {
  let corePath = ''

  beforeEach(async () => {
    corePath = await mkdtemp(join(tmpdir(), 'agent-core-'))
    await mkdir(join(corePath, 'agents'), { recursive: true })
    await writeFile(
      join(corePath, 'agents', 'chapter-writer.md'),
      `---\nname: chapter-writer\ndescription: writes\ntools: Read\n---\n\n<!-- narracat:prose id="writer-persona" title="人设" -->\n官方人设。\n<!-- /narracat:prose -->\n`,
      'utf-8',
    )
  })

  afterEach(async () => {
    await rm(corePath, { recursive: true, force: true })
  })

  test('挂载与默认一致但存在 prose override 时仍要生成覆盖', async () => {
    const agents = await assembleAgentSkills({
      agentCorePath: corePath,
      agentIds: ['chapter-writer'],
      proseOverrides: {
        'writer-persona': {
          text: '我的人设。',
          baseText: '官方人设。',
          baseEngineVersion: '4.0.162',
          updatedAt: '2026-08-06T10:00:00+08:00',
        },
      },
    })

    expect(agents['chapter-writer']?.prompt).toContain('我的人设。')
  })

  // 注入侧必须是**绝对**路径——模型拿它去 Read 真实文件，相对路径读不到。
  // 这条与 official-skill-body.test.ts 的「展示侧相对化」成对存在：同一个变量两种语义，
  // 两个函数长得像、极易被顺手「统一」，统一到哪一边都会坏一边（模型读不到文件，或作者
  // 的截图泄露本机路径），而少了这两条测试的任意一条都不会变红。改动 engine-path-vars.ts 前先读这里。
  test('注入侧把引擎路径变量展开为绝对路径（两种书写形态都吃）', async () => {
    await writeFile(
      join(corePath, 'agents', 'chapter-writer.md'),
      `---\nname: chapter-writer\ndescription: writes\ntools: Read\n---\n\n` +
        `契约见 \${CLAUDE_PLUGIN_ROOT}/docs/contracts/world-guided.md，\n` +
        `素材见 $CLAUDE_PLUGIN_ROOT/skills/novel-web-craft/SKILL.md。\n`,
      'utf-8',
    )

    const agents = await assembleAgentSkills({
      agentCorePath: corePath,
      agentIds: ['chapter-writer'],
      authorRequestsByAgent: { 'chapter-writer': ['随便一条要求，只为触发组装'] },
    })

    const prompt = agents['chapter-writer']?.prompt ?? ''
    expect(prompt).toContain(`${corePath}/docs/contracts/world-guided.md`)
    expect(prompt).toContain(`${corePath}/skills/novel-web-craft/SKILL.md`)
    expect(prompt).not.toContain('CLAUDE_PLUGIN_ROOT')
  })
})
