import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { auditAgentMemoryProject, formatAgentMemoryAuditReport } from './audit-agent-memory.mjs'

async function writeMemoryFile(root, relativePath, content) {
  const filePath = join(root, '.claude', 'agent-memory', relativePath)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

describe('audit-agent-memory', () => {
  test('allows stable writing-agent memory and quarantines chapter-scoped legacy notes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-memory-audit-'))

    await writeMemoryFile(
      root,
      'narracat-chapter-writer/user_style_prefs.md',
      [
        '---',
        'name: user_style_prefs',
        'type: user',
        '---',
        '',
        '用户偏好：情绪靠动作、代价、选择承载。',
      ].join('\n'),
    )
    await writeMemoryFile(
      root,
      'narracat-chapter-writer/project_style_anchor.md',
      [
        '---',
        'name: project_style_anchor',
        'type: project',
        '---',
        '',
        '第1章确定项目稳定风格：冷叙底色 + 因果玄秘。',
      ].join('\n'),
    )
    await writeMemoryFile(
      root,
      'narracat-chapter-writer/solo_confrontation_technique.md',
      [
        '---',
        'name: solo_confrontation_technique',
        'type: feedback',
        '---',
        '',
        'Ch5 单人内在对峙技法，不应自动套用到其他章节。',
      ].join('\n'),
    )
    await writeMemoryFile(
      root,
      'narracat-chapter-writer/MEMORY.md',
      '- [solo_confrontation_technique](solo_confrontation_technique.md) — Ch5 单人内在对峙技法\n',
    )
    await writeMemoryFile(
      root,
      'narracat-continuity-editor/unclassified.md',
      '旧审修记忆，没有分类，必须先人工提升为稳定 review-pattern 才能使用。\n',
    )
    await writeMemoryFile(
      root,
      'narracat-memory-keeper/anything.md',
      [
        '---',
        'type: process-guard',
        '---',
        '',
        'memory-keeper 不应从 agent-memory 读取任何东西。',
      ].join('\n'),
    )

    const audit = await auditAgentMemoryProject(root)
    const byPath = new Map(audit.entries.map((entry) => [entry.path, entry]))

    expect(audit.totals).toEqual({ allowed: 2, blocked: 4, total: 6 })
    expect(byPath.get('narracat-chapter-writer/user_style_prefs.md')).toMatchObject({
      status: 'allowed',
      category: 'user',
    })
    expect(byPath.get('narracat-chapter-writer/project_style_anchor.md')).toMatchObject({
      status: 'allowed',
      category: 'project',
    })
    expect(byPath.get('narracat-chapter-writer/solo_confrontation_technique.md')).toMatchObject({
      status: 'blocked',
      category: 'chapter-transient',
    })
    expect(byPath.get('narracat-chapter-writer/MEMORY.md')).toMatchObject({
      status: 'blocked',
      category: 'chapter-transient',
    })
    expect(byPath.get('narracat-continuity-editor/unclassified.md')).toMatchObject({
      status: 'blocked',
      category: 'stale',
    })
    expect(byPath.get('narracat-memory-keeper/anything.md')).toMatchObject({
      status: 'blocked',
      category: 'stale',
    })

    const formatted = formatAgentMemoryAuditReport(audit)
    expect(formatted).toContain('Allowed memory sources')
    expect(formatted).toContain('Blocked or quarantined memory sources')
    expect(formatted).toContain('solo_confrontation_technique.md')
    expect(formatted).toContain('memory-keeper must not use .claude/agent-memory')
  })

  test('passes an empty project without agent memory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-memory-empty-'))

    const audit = await auditAgentMemoryProject(root)

    expect(audit.entries).toEqual([])
    expect(audit.totals).toEqual({ allowed: 0, blocked: 0, total: 0 })
    expect(formatAgentMemoryAuditReport(audit)).toContain('- None')
  })
})
