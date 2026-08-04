import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweepStaleUserSkillCopies } from './sweep-stale-user-skill-copies'

const MARKER = '.narracat-user-skill'

async function makeProject(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `narracat-sweep-${label}-`))
}

function skillsRoot(projectPath: string): string {
  return join(projectPath, '.claude', 'skills')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function makeMarkedCopy(projectPath: string, name: string): Promise<string> {
  const dir = join(skillsRoot(projectPath), name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: 范例。\n---\n正文。\n`, 'utf-8')
  await writeFile(join(dir, MARKER), '', 'utf-8')
  return dir
}

async function makeAuthoredSkill(projectPath: string, name: string): Promise<string> {
  const dir = join(skillsRoot(projectPath), name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: 作者自己的项目级 skill。\n---\n正文。\n`, 'utf-8')
  return dir
}

describe('sweepStaleUserSkillCopies', () => {
  test('deletes a marked leftover copy (crash residue)', async () => {
    const projectPath = await makeProject('marked')
    const dir = await makeMarkedCopy(projectPath, 'dialogue-pack')

    await sweepStaleUserSkillCopies(projectPath)

    expect(await pathExists(dir)).toBe(false)
  })

  test('never touches an unmarked directory (author asset)', async () => {
    const projectPath = await makeProject('authored')
    const dir = await makeAuthoredSkill(projectPath, 'my-own-skill')

    await sweepStaleUserSkillCopies(projectPath)

    expect(await pathExists(dir)).toBe(true)
    expect(await pathExists(join(dir, 'SKILL.md'))).toBe(true)
  })

  test('mixed: deletes marked copies, leaves unmarked author skills alone', async () => {
    const projectPath = await makeProject('mixed')
    const marked = await makeMarkedCopy(projectPath, 'stale-user-pack')
    const authored = await makeAuthoredSkill(projectPath, 'author-pack')

    await sweepStaleUserSkillCopies(projectPath)

    expect(await pathExists(marked)).toBe(false)
    expect(await pathExists(authored)).toBe(true)
  })

  test('missing .claude/skills/ directory: no-op, does not throw', async () => {
    const projectPath = await makeProject('missing')

    await expect(sweepStaleUserSkillCopies(projectPath)).resolves.toBeUndefined()
  })

  test('ignores non-directory entries under .claude/skills/', async () => {
    const projectPath = await makeProject('stray-file')
    await mkdir(skillsRoot(projectPath), { recursive: true })
    await writeFile(join(skillsRoot(projectPath), 'stray.txt'), 'noise', 'utf-8')

    await expect(sweepStaleUserSkillCopies(projectPath)).resolves.toBeUndefined()
    expect(await pathExists(join(skillsRoot(projectPath), 'stray.txt'))).toBe(true)
  })

  test('a single failing rm does not throw and does not block the sweep (degrades silently)', async () => {
    const projectPath = await makeProject('rm-fails')
    await makeMarkedCopy(projectPath, 'dialogue-pack')

    const fs = {
      readdir: (await import('node:fs/promises')).readdir,
      stat: (await import('node:fs/promises')).stat,
      rm: async () => {
        throw new Error('rm blew up')
      },
    }

    await expect(sweepStaleUserSkillCopies(projectPath, fs)).resolves.toBeUndefined()
  })
})
