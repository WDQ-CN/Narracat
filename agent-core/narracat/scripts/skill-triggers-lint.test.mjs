import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { lintSkillTriggers, parseTriggerDeclaration } from './skill-triggers-lint.mjs'

async function makeSkillsDir() {
  return mkdtemp(join(tmpdir(), 'narracat-skill-triggers-'))
}

async function writeSkill(skillsDir, name, frontmatter) {
  await mkdir(join(skillsDir, name), { recursive: true })
  await writeFile(join(skillsDir, name, 'SKILL.md'), `---\n${frontmatter}\n---\n\n正文。\n`, 'utf-8')
}

describe('parseTriggerDeclaration', () => {
  test('reads mount-mode and a YAML block triggers list', () => {
    const result = parseTriggerDeclaration(
      ['name: demo', 'mount-mode: on-demand', 'triggers:', '  - 遇到风格分析', '  - 遇到深审'].join('\n'),
    )
    expect(result.mountMode).toBe('on-demand')
    expect(result.triggers).toEqual(['遇到风格分析', '遇到深审'])
  })

  test('reads an inline triggers array', () => {
    const result = parseTriggerDeclaration('mount-mode: on-demand\ntriggers: [a, b]')
    expect(result.mountMode).toBe('on-demand')
    expect(result.triggers).toEqual(['a', 'b'])
  })

  test('defaults to no mount-mode when absent (preload type)', () => {
    const result = parseTriggerDeclaration('name: demo\ndescription: x')
    expect(result.mountMode).toBeNull()
    expect(result.triggers).toEqual([])
  })
})

describe('lintSkillTriggers', () => {
  test('fails an on-demand skill that lacks triggers', async () => {
    const skillsDir = await makeSkillsDir()
    await writeSkill(skillsDir, 'demo-on-demand', 'name: demo-on-demand\nmount-mode: on-demand')

    const findings = lintSkillTriggers(skillsDir)
    expect(findings.length).toBe(1)
    expect(findings[0].skill).toBe('demo-on-demand')
    expect(findings[0].message).toContain('缺触发点')
  })

  test('passes an on-demand skill with a non-empty triggers list', async () => {
    const skillsDir = await makeSkillsDir()
    await writeSkill(
      skillsDir,
      'demo-ok',
      ['name: demo-ok', 'mount-mode: on-demand', 'triggers:', '  - 遇到风格分析时调用'].join('\n'),
    )

    expect(lintSkillTriggers(skillsDir)).toEqual([])
  })

  test('does not touch preload-type skills (no mount-mode declared)', async () => {
    const skillsDir = await makeSkillsDir()
    await writeSkill(skillsDir, 'sample-craft', 'name: sample-craft\ndescription: An index.')
    await writeSkill(skillsDir, 'novel-structure', 'name: novel-structure\ndescription: Structure.')

    expect(lintSkillTriggers(skillsDir)).toEqual([])
  })

  test('flags an invalid mount-mode value', async () => {
    const skillsDir = await makeSkillsDir()
    await writeSkill(skillsDir, 'demo-typo', 'name: demo-typo\nmount-mode: ondemand')

    const findings = lintSkillTriggers(skillsDir)
    expect(findings.length).toBe(1)
    expect(findings[0].message).toContain('mount-mode 取值非法')
  })

  test('the built-in skills declare no mount-mode and therefore pass', () => {
    const builtinSkillsDir = join(import.meta.dir, '..', 'skills')
    expect(lintSkillTriggers(builtinSkillsDir)).toEqual([])
  })
})
