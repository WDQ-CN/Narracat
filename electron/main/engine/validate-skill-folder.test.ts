import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InvalidSkillFolderError, validateSkillFolder } from './validate-skill-folder'

async function makeFolder(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `narracat-validate-${label}-`))
}

describe('validateSkillFolder', () => {
  test('accepts a folder with SKILL.md carrying name + description', async () => {
    const folder = await makeFolder('ok')
    await writeFile(
      join(folder, 'SKILL.md'),
      '---\nname: craft-pack\ndescription: 写法范例库。\n---\n\n# body\n',
      'utf-8',
    )

    expect(await validateSkillFolder(folder)).toEqual({ name: 'craft-pack', description: '写法范例库。' })
  })

  test('rejects folder without SKILL.md', async () => {
    const folder = await makeFolder('no-skill-md')
    await writeFile(join(folder, 'README.md'), '# nope\n', 'utf-8')
    await expect(validateSkillFolder(folder)).rejects.toBeInstanceOf(InvalidSkillFolderError)
  })

  test('rejects when SKILL.md is a directory, not a file', async () => {
    const folder = await makeFolder('skill-md-dir')
    await mkdir(join(folder, 'SKILL.md'), { recursive: true })
    await expect(validateSkillFolder(folder)).rejects.toBeInstanceOf(InvalidSkillFolderError)
  })

  test('rejects SKILL.md without frontmatter', async () => {
    const folder = await makeFolder('no-frontmatter')
    await writeFile(join(folder, 'SKILL.md'), '# 没有 frontmatter 的正文\n', 'utf-8')
    await expect(validateSkillFolder(folder)).rejects.toBeInstanceOf(InvalidSkillFolderError)
  })

  test('rejects frontmatter missing name or description', async () => {
    const folder = await makeFolder('missing-fields')
    await writeFile(join(folder, 'SKILL.md'), '---\nname: only-name\n---\n', 'utf-8')
    await expect(validateSkillFolder(folder)).rejects.toBeInstanceOf(InvalidSkillFolderError)
  })

  test('rejects a name that is not lowercase kebab-case (dot / spaces / uppercase / traversal)', async () => {
    for (const badName of ['.', '..', 'Has Space', 'UpperCase', '../escape', 'under_score', 'trailing-']) {
      const folder = await makeFolder('bad-name')
      await writeFile(
        join(folder, 'SKILL.md'),
        `---\nname: ${JSON.stringify(badName)}\ndescription: 简介。\n---\n# body\n`,
        'utf-8',
      )
      await expect(validateSkillFolder(folder)).rejects.toBeInstanceOf(InvalidSkillFolderError)
    }
  })

  test('accepts lowercase kebab names with digits', async () => {
    const folder = await makeFolder('kebab-digits')
    await writeFile(
      join(folder, 'SKILL.md'),
      '---\nname: scene-pack-2\ndescription: 简介。\n---\n# body\n',
      'utf-8',
    )
    expect(await validateSkillFolder(folder)).toEqual({ name: 'scene-pack-2', description: '简介。' })
  })

  test('error message is author-facing', async () => {
    const folder = await makeFolder('message')
    await expect(validateSkillFolder(folder)).rejects.toThrow('不是有效的 Skill 文件夹。')
  })
})
