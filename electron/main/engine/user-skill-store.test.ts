import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findSkillNameConflict,
  importUserSkill,
  listUserSkills,
  normalizeUserSkill,
  previewUserSkillImport,
  readUserSkillBody,
  uninstallUserSkill,
  userSkillSnapshotPath,
  userSkillStorePath,
} from './user-skill-store'
import type { UserSkill } from '@shared/types/skill-mount'
import { estimateSkillTokens } from '@shared/lib/skill-budget'
import { InvalidSkillFolderError, SkillNameConflictError } from './validate-skill-folder'

async function makeUserData(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `narracat-user-skills-${label}-`))
}

/** 造一个合法 Claude Code skill 文件夹：SKILL.md（name + description）+ 可选 references/scripts */
async function makeValidSkillFolder(
  label: string,
  options: { name?: string; description?: string; withReferences?: boolean; withScripts?: boolean } = {},
): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), `narracat-skill-src-${label}-`))
  const name = options.name ?? 'my-local-skill'
  const description = options.description ?? '本地范例库 Skill。'
  await writeFile(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# 正文\n内容。\n`, 'utf-8')
  if (options.withReferences) {
    await mkdir(join(folder, 'references'), { recursive: true })
    await writeFile(join(folder, 'references', 'guide.md'), '# 参考\n', 'utf-8')
  }
  if (options.withScripts) {
    await mkdir(join(folder, 'scripts'), { recursive: true })
    await writeFile(join(folder, 'scripts', 'run.sh'), '#!/bin/sh\necho hi\n', 'utf-8')
  }
  return folder
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 快照根 user-skills/ 下的子目录数（缺目录视作 0），用于断言「撞名挡在 cp 之前」无孤儿快照残留。 */
async function snapshotCount(userDataPath: string): Promise<number> {
  return (await readdir(join(userDataPath, 'user-skills')).catch(() => [])).length
}

describe('UserSkillStore', () => {
  test('imports a valid skill: snapshot copied + record written + listed', async () => {
    const userDataPath = await makeUserData('import')
    const folder = await makeValidSkillFolder('import', { name: 'craft-pack', description: '写法范例库。' })

    const skills = await importUserSkill({ folderPath: folder, agentId: 'chapter-writer', userDataPath })

    expect(skills).toHaveLength(1)
    const skill = skills[0]
    expect(skill.agentId).toBe('chapter-writer')
    expect(skill.name).toBe('craft-pack')
    expect(skill.description).toBe('写法范例库。')
    expect(skill.sourcePath).toBe(folder)
    expect(skill.hasScripts).toBe(false)
    expect(skill.id).toBeTruthy()
    expect(skill.mountedAt).toBeTruthy()

    // 快照落盘且含 SKILL.md
    const snapshot = userSkillSnapshotPath(userDataPath, skill.id)
    expect(await pathExists(join(snapshot, 'SKILL.md'))).toBe(true)

    // 记录持久化，二次 list 读得回
    expect(await listUserSkills(userSkillStorePath(userDataPath))).toEqual(skills)
  })

  test('import & list enrich each skill with estimatedTokens from its snapshot SKILL.md', async () => {
    const userDataPath = await makeUserData('tokens')
    const folder = await makeValidSkillFolder('tokens', { name: 'token-pack' })

    const [imported] = await importUserSkill({ folderPath: folder, agentId: 'chapter-writer', userDataPath })
    const snapshotContent = await readFile(
      join(userSkillSnapshotPath(userDataPath, imported.id), 'SKILL.md'),
      'utf-8',
    )

    // 用户 Skill 一律预加载 → token 必须计入预算；按快照 SKILL.md 现算
    expect(imported.estimatedTokens).toBe(estimateSkillTokens(snapshotContent))
    expect(imported.estimatedTokens ?? 0).toBeGreaterThan(0)

    // list 返回与 import 返回口径一致（同一快照现算，不持久化）
    const [listed] = await listUserSkills(userSkillStorePath(userDataPath))
    expect(listed.estimatedTokens).toBe(imported.estimatedTokens)
  })

  test('snapshot recursively copies references and scripts; hasScripts reflects scripts dir', async () => {
    const userDataPath = await makeUserData('recursive')
    const folder = await makeValidSkillFolder('recursive', { withReferences: true, withScripts: true })

    const [skill] = await importUserSkill({ folderPath: folder, agentId: 'chapter-writer', userDataPath })

    expect(skill.hasScripts).toBe(true)
    const snapshot = userSkillSnapshotPath(userDataPath, skill.id)
    expect(await pathExists(join(snapshot, 'references', 'guide.md'))).toBe(true)
    expect(await pathExists(join(snapshot, 'scripts', 'run.sh'))).toBe(true)
  })

  test('snapshot is decoupled from source: editing source after import does not change snapshot', async () => {
    const userDataPath = await makeUserData('decoupled')
    const folder = await makeValidSkillFolder('decoupled', { description: '原始简介。' })

    const [skill] = await importUserSkill({ folderPath: folder, agentId: 'world-curator', userDataPath })

    // 改原文件夹 SKILL.md
    await writeFile(join(folder, 'SKILL.md'), '---\nname: my-local-skill\ndescription: 改过的简介。\n---\n', 'utf-8')

    const snapshotBody = await readFile(join(userSkillSnapshotPath(userDataPath, skill.id), 'SKILL.md'), 'utf-8')
    expect(snapshotBody).toContain('原始简介。')
    expect(snapshotBody).not.toContain('改过的简介。')
  })

  test('rejects a non-skill folder with InvalidSkillFolderError and writes nothing', async () => {
    const userDataPath = await makeUserData('invalid')
    const notSkill = await mkdtemp(join(tmpdir(), 'narracat-not-skill-'))
    await writeFile(join(notSkill, 'readme.txt'), 'hello', 'utf-8')

    await expect(
      importUserSkill({ folderPath: notSkill, agentId: 'chapter-writer', userDataPath }),
    ).rejects.toBeInstanceOf(InvalidSkillFolderError)

    // 校验失败不留记录、不留快照根
    expect(await listUserSkills(userSkillStorePath(userDataPath))).toEqual([])
  })

  test('rejects SKILL.md missing required frontmatter fields', async () => {
    const userDataPath = await makeUserData('no-frontmatter')
    const folder = await mkdtemp(join(tmpdir(), 'narracat-skill-bad-fm-'))
    // 有 name 缺 description
    await writeFile(join(folder, 'SKILL.md'), '---\nname: only-name\n---\n# body\n', 'utf-8')

    await expect(
      importUserSkill({ folderPath: folder, agentId: 'chapter-writer', userDataPath }),
    ).rejects.toBeInstanceOf(InvalidSkillFolderError)
  })

  test('each import is independent: same source mounted on two agents yields two records + snapshots', async () => {
    // 无全局库复用：同一源文件夹挂到两个 Agent → 两条独立记录 + 两份独立快照。
    // （同 Agent 重复挂同名由 #294 撞名拒绝，独立性改由跨 Agent 体现。）
    const userDataPath = await makeUserData('independent')
    const folder = await makeValidSkillFolder('independent')

    await importUserSkill({ folderPath: folder, agentId: 'chapter-writer', userDataPath })
    const skills = await importUserSkill({ folderPath: folder, agentId: 'world-curator', userDataPath })

    expect(skills).toHaveLength(2)
    expect(skills[0].id).not.toBe(skills[1].id)
    for (const skill of skills) {
      expect(await pathExists(userSkillSnapshotPath(userDataPath, skill.id))).toBe(true)
    }
  })

  test('uninstall removes the record and deletes the snapshot directory', async () => {
    const userDataPath = await makeUserData('uninstall')
    const folder = await makeValidSkillFolder('uninstall')

    const [skill] = await importUserSkill({ folderPath: folder, agentId: 'chapter-writer', userDataPath })
    const snapshot = userSkillSnapshotPath(userDataPath, skill.id)
    expect(await pathExists(snapshot)).toBe(true)

    const remaining = await uninstallUserSkill({ id: skill.id, userDataPath })

    expect(remaining).toEqual([])
    expect(await pathExists(snapshot)).toBe(false)
  })

  test('uninstall only drops the matching record, keeps others and their snapshots', async () => {
    const userDataPath = await makeUserData('uninstall-one')
    const folderA = await makeValidSkillFolder('uninstall-a', { name: 'skill-a' })
    const folderB = await makeValidSkillFolder('uninstall-b', { name: 'skill-b' })

    const [a] = await importUserSkill({ folderPath: folderA, agentId: 'chapter-writer', userDataPath })
    const [, b] = await importUserSkill({ folderPath: folderB, agentId: 'world-curator', userDataPath })

    const remaining = await uninstallUserSkill({ id: a.id, userDataPath })

    expect(remaining.map((skill) => skill.id)).toEqual([b.id])
    expect(await pathExists(userSkillSnapshotPath(userDataPath, a.id))).toBe(false)
    expect(await pathExists(userSkillSnapshotPath(userDataPath, b.id))).toBe(true)
  })

  test('uninstall rejects unsafe ids (incl. "." that normalizes to the snapshot root) and deletes nothing outside the exact target', async () => {
    const userDataPath = await makeUserData('traversal')
    // 在 userData 根放一个「外部」文件，模拟 config / skill-mounts.json
    const sentinel = join(userDataPath, 'config.json')
    await writeFile(sentinel, '{"keep":true}', 'utf-8')
    // 一个真实存在的快照（合法 UUID 目录），断言非法 id 卸载不会把它/整个快照根连带删掉
    const survivor = userSkillSnapshotPath(userDataPath, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    await mkdir(survivor, { recursive: true })

    // '.' 经 path.join 归一化为 user-skills 根（rm 会删整根）、'config' 是裸名（误删兄弟目录）——
    // 黑名单都会放行，严格 UUID 白名单须一律拒。
    for (const evilId of ['../config', '..', '.', 'config', 'a/../../config', 'sub/dir', '..\\config', 'not-a-uuid']) {
      await expect(uninstallUserSkill({ id: evilId, userDataPath })).rejects.toThrow('用户 Skill id 非法。')
    }

    // 非法 id 一律拒删：外部文件、快照根、已有子快照全部原封不动
    expect(await pathExists(sentinel)).toBe(true)
    expect(await pathExists(join(userDataPath, 'user-skills'))).toBe(true)
    expect(await pathExists(survivor)).toBe(true)
  })

  test('import rejects a mount-disabled agent (memory-keeper) and writes nothing', async () => {
    const userDataPath = await makeUserData('disabled-agent')
    const folder = await makeValidSkillFolder('disabled-agent')

    await expect(
      importUserSkill({ folderPath: folder, agentId: 'memory-keeper', userDataPath }),
    ).rejects.toThrow('该 Agent 不开放挂载。')

    // 拒绝发生在校验/复制之前：不留记录、不留快照根
    expect(await listUserSkills(userSkillStorePath(userDataPath))).toEqual([])
  })

  test('missing store file lists empty; corrupt JSON degrades to empty', async () => {
    const userDataPath = await makeUserData('degrade')
    const storePath = userSkillStorePath(userDataPath)
    expect(await listUserSkills(storePath)).toEqual([])

    await writeFile(storePath, '{ not valid json', 'utf-8')
    expect(await listUserSkills(storePath)).toEqual([])
  })

  test('readUserSkillBody returns the SKILL.md body with frontmatter stripped', async () => {
    const userDataPath = await makeUserData('read-body')
    const folder = await makeValidSkillFolder('read-body', { name: 'craft-pack', description: '写法范例库。' })

    const [skill] = await importUserSkill({ folderPath: folder, agentId: 'chapter-writer', userDataPath })
    const body = await readUserSkillBody({ id: skill.id, userDataPath })

    // makeValidSkillFolder 的正文是「# 正文\n内容。」，frontmatter（name/description）须被剥离
    expect(body).toContain('# 正文')
    expect(body).toContain('内容。')
    expect(body).not.toContain('name: craft-pack')
    expect(body).not.toContain('description:')
  })

  test('readUserSkillBody degrades to empty string for a missing snapshot', async () => {
    const userDataPath = await makeUserData('read-body-missing')
    // 合法 UUID 形态但磁盘上无此快照 → 返空（与「非法 id 抛错」是两件事，后者见下一用例）
    expect(await readUserSkillBody({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', userDataPath })).toBe('')
  })

  test('readUserSkillBody rejects an id with path traversal (信任边界守卫)', async () => {
    const userDataPath = await makeUserData('read-body-traversal')
    for (const evilId of ['../config', '..', 'a/../../config', 'sub/dir', '..\\config']) {
      await expect(readUserSkillBody({ id: evilId, userDataPath })).rejects.toThrow('用户 Skill id 非法。')
    }
  })

  // ---- #294 安全/校验：scripts 确认触发位 + 同名冲突拒绝 ----

  test('hasScripts flags a scripts/ folder so the renderer can trigger the one-time confirm', async () => {
    const userDataPath = await makeUserData('scripts-flag')
    const withScripts = await makeValidSkillFolder('scripts-yes', { name: 'has-scripts', withScripts: true })
    const noScripts = await makeValidSkillFolder('scripts-no', { name: 'no-scripts' })

    const preview = await previewUserSkillImport({ folderPath: withScripts, agentId: 'chapter-writer', userDataPath })
    expect(preview.hasScripts).toBe(true)
    expect(preview.conflict).toBe(false)

    const plain = await previewUserSkillImport({ folderPath: noScripts, agentId: 'chapter-writer', userDataPath })
    expect(plain.hasScripts).toBe(false)
  })

  test('preview flags a conflict with an official skill name and copies nothing', async () => {
    const userDataPath = await makeUserData('preview-official-clash')
    const folder = await makeValidSkillFolder('preview-official', { name: 'novel-structure' })

    const preview = await previewUserSkillImport({
      folderPath: folder,
      agentId: 'chapter-writer',
      userDataPath,
      officialSkillNames: ['novel-structure', 'sample-craft'],
    })

    expect(preview.conflict).toBe(true)
    // 预检不复制、不写记录
    expect(await listUserSkills(userSkillStorePath(userDataPath))).toEqual([])
  })

  test('import rejects a name clashing with an official skill (SkillNameConflictError) before copying', async () => {
    const userDataPath = await makeUserData('official-clash')
    const folder = await makeValidSkillFolder('official', { name: 'novel-structure' })

    await expect(
      importUserSkill({
        folderPath: folder,
        agentId: 'chapter-writer',
        userDataPath,
        officialSkillNames: ['novel-structure'],
      }),
    ).rejects.toBeInstanceOf(SkillNameConflictError)

    // 撞名挡在复制之前：无记录、无孤儿快照（实查快照根，cp-then-throw 退化会留 UUID 目录被此抓到）
    expect(await listUserSkills(userSkillStorePath(userDataPath))).toEqual([])
    expect(await snapshotCount(userDataPath)).toBe(0)
  })

  test('import rejects a name already mounted on the same agent, but allows the same name on a different agent', async () => {
    const userDataPath = await makeUserData('same-agent-clash')
    const first = await makeValidSkillFolder('same-1', { name: 'dialogue-pack' })

    await importUserSkill({ folderPath: first, agentId: 'chapter-writer', userDataPath })

    // 同 Agent 撞已挂用户名 → 拒绝
    const clash = await makeValidSkillFolder('same-2', { name: 'dialogue-pack' })
    await expect(
      importUserSkill({ folderPath: clash, agentId: 'chapter-writer', userDataPath }),
    ).rejects.toBeInstanceOf(SkillNameConflictError)

    // 仍只有第一条记录
    expect(await listUserSkills(userSkillStorePath(userDataPath))).toHaveLength(1)

    // 同名挂到另一个 Agent 不算冲突（按 Agent 隔离注入）
    const other = await makeValidSkillFolder('same-3', { name: 'dialogue-pack' })
    const skills = await importUserSkill({ folderPath: other, agentId: 'world-curator', userDataPath })
    expect(skills).toHaveLength(2)
  })

  test('name conflict matching is case-insensitive against official skills', async () => {
    const userDataPath = await makeUserData('case-clash')
    // 导入名须过 SKILL_NAME_PATTERN（小写 kebab）；官方名带大写变体，验证撞名匹配大小写不敏感。
    const folder = await makeValidSkillFolder('case', { name: 'novel-structure' })

    await expect(
      importUserSkill({
        folderPath: folder,
        agentId: 'chapter-writer',
        userDataPath,
        officialSkillNames: ['Novel-Structure'],
      }),
    ).rejects.toBeInstanceOf(SkillNameConflictError)
  })

  test('findSkillNameConflict isolates by agent and ignores empty names', () => {
    const userSkills: UserSkill[] = [
      {
        id: '1',
        agentId: 'chapter-writer',
        name: 'dialogue-pack',
        description: 'd',
        sourcePath: '/p',
        hasScripts: false,
        mountedAt: '2026-01-01T00:00:00.000Z',
      },
    ]

    expect(
      findSkillNameConflict({ name: 'sample-craft', agentId: 'chapter-writer', officialSkillNames: ['sample-craft'], userSkills }),
    ).toBe(true)
    expect(
      findSkillNameConflict({ name: 'dialogue-pack', agentId: 'chapter-writer', officialSkillNames: [], userSkills }),
    ).toBe(true)
    // 不同 Agent 同名不冲突
    expect(
      findSkillNameConflict({ name: 'dialogue-pack', agentId: 'world-curator', officialSkillNames: [], userSkills }),
    ).toBe(false)
    // 全新名不冲突
    expect(
      findSkillNameConflict({ name: 'fresh-pack', agentId: 'chapter-writer', officialSkillNames: [], userSkills }),
    ).toBe(false)
    // 空名不冲突（不误判）
    expect(
      findSkillNameConflict({ name: '   ', agentId: 'chapter-writer', officialSkillNames: [], userSkills }),
    ).toBe(false)
  })

  test('normalizeUserSkill rejects records missing required fields', () => {
    expect(normalizeUserSkill(null)).toBeNull()
    expect(normalizeUserSkill({ id: 'x', agentId: 'a', name: 'n', description: 'd', sourcePath: '/p' })).toBeNull()
    expect(
      normalizeUserSkill({
        id: 'x',
        agentId: 'a',
        name: 'n',
        description: 'd',
        sourcePath: '/p',
        mountedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual({
      id: 'x',
      agentId: 'a',
      name: 'n',
      description: 'd',
      sourcePath: '/p',
      hasScripts: false,
      mountedAt: '2026-01-01T00:00:00.000Z',
    })
  })
})
