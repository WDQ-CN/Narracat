import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

async function writeFixtureFile(root: string, relativePath: string, content: string): Promise<void> {
  const path = join(root, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf-8')
}

const FIXTURE_VERSION = '3.10.22'
const FIXTURE_COMMANDS = ['init', 'setup', 'world', 'plan', 'reference', 'write', 'review', 'rewrite', 'status']
const FIXTURE_TEMPLATES = ['premise-template', 'relationships-template', 'character-template', 'world-setting-template']

export async function createNarraCatPluginFixture(prefix = 'narracat-plugin-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))

  await writeFixtureFile(
    root,
    '.claude-plugin/plugin.json',
    JSON.stringify(
      {
        name: 'narracat',
        version: FIXTURE_VERSION,
      },
      null,
      2,
    ),
  )

  // 引擎自有契约清单（阶段2切片④）：夹具只声明它实际生成的文件集合——
  // agents/skills/schemas 本夹具不生成对应文件，声明空清单即可，不为凑 REQUIRED 底线补造未使用的假文件。
  await writeFixtureFile(
    root,
    'narracat.manifest.json',
    JSON.stringify(
      {
        name: 'narracat',
        version: FIXTURE_VERSION,
        commands: FIXTURE_COMMANDS,
        agents: [],
        skills: [],
        schemas: [],
        templates: FIXTURE_TEMPLATES,
      },
      null,
      2,
    ),
  )

  await writeFixtureFile(root, 'templates/premise-template.md', '# 核心前提\n\n')
  await writeFixtureFile(root, 'templates/relationships-template.md', '# 角色关系\n\n')
  await writeFixtureFile(root, 'templates/character-template.md', '# 角色设定\n\n')
  await writeFixtureFile(root, 'templates/world-setting-template.md', '# 世界设定\n\n')

  for (const command of FIXTURE_COMMANDS) {
    await writeFixtureFile(
      root,
      `commands/${command}.md`,
      `---\ndescription: ${command}\n---\n执行 ${command} command。参数：$ARGUMENTS。`,
    )
  }

  return root
}
