import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readOfficialSkillBody } from './official-skill-body'

let corePath = ''

beforeEach(async () => {
  corePath = await mkdtemp(join(tmpdir(), 'agent-core-'))
  await mkdir(join(corePath, 'skills', 'novel-web-craft'), { recursive: true })
  await writeFile(
    join(corePath, 'skills', 'novel-web-craft', 'SKILL.md'),
    '---\nname: novel-web-craft\ndescription: 素材库\n---\n\n# 网文写作功底素材库\n\n正文在这里。\n',
    'utf-8',
  )
})

afterEach(async () => {
  await rm(corePath, { recursive: true, force: true })
})

describe('readOfficialSkillBody', () => {
  test('读到正文并剥掉 frontmatter', async () => {
    const body = await readOfficialSkillBody({ agentCorePath: corePath, skillId: 'novel-web-craft' })
    expect(body).toContain('# 网文写作功底素材库')
    expect(body).toContain('正文在这里。')
    expect(body).not.toContain('description:')
  })

  test('不存在的 skill → 空串，不抛', async () => {
    expect(await readOfficialSkillBody({ agentCorePath: corePath, skillId: 'no-such' })).toBe('')
  })

  test('路径穿越被拒（IPC 是信任边界）', async () => {
    expect(await readOfficialSkillBody({ agentCorePath: corePath, skillId: '../../etc/passwd' })).toBe('')
    expect(await readOfficialSkillBody({ agentCorePath: corePath, skillId: '..' })).toBe('')
  })

  // 真机走查抓到的两轮：①作者读到了 `${CLAUDE_PLUGIN_ROOT}` 内部变量名；②改成展开绝对路径后，
  // 作者读到 `/Users/<用户名>/...` 一长串本机路径——截图求助会连用户名和目录结构一起泄露。
  // 定案：展示侧相对化（模型侧另走 expandEngineRoot 拿绝对路径，两种语义不共用）。
  describe('引擎路径变量（展示侧相对化）', () => {
    beforeEach(async () => {
      await writeFile(
        join(corePath, 'skills', 'novel-web-craft', 'SKILL.md'),
        '---\nname: novel-web-craft\ndescription: 素材库\n---\n\n' +
          '索引在 ${CLAUDE_PLUGIN_ROOT}/skills/novel-web-craft/references/pack-index.md，\n' +
          '范本在 $CLAUDE_PLUGIN_ROOT/skills/novel-web-craft/references/personas/。\n',
        'utf-8',
      )
    })

    test('变量前缀被去掉，留下相对引擎根的路径（两种书写形态都吃）', async () => {
      const body = await readOfficialSkillBody({ agentCorePath: corePath, skillId: 'novel-web-craft' })
      expect(body).toContain('skills/novel-web-craft/references/pack-index.md')
      expect(body).toContain('skills/novel-web-craft/references/personas/')
    })

    test('不残留内部变量名', async () => {
      const body = await readOfficialSkillBody({ agentCorePath: corePath, skillId: 'novel-web-craft' })
      expect(body).not.toContain('CLAUDE_PLUGIN_ROOT')
    })

    test('不泄露本机绝对路径（作者截图不该带出用户名与目录结构）', async () => {
      const body = await readOfficialSkillBody({ agentCorePath: corePath, skillId: 'novel-web-craft' })
      expect(body).not.toContain(corePath)
    })

    test('相对化不留带头斜杠（不能变成 /skills/... 这种怪路径）', async () => {
      const body = await readOfficialSkillBody({ agentCorePath: corePath, skillId: 'novel-web-craft' })
      expect(body).toContain('索引在 skills/')
      expect(body).not.toContain('索引在 /skills/')
    })
  })
})
