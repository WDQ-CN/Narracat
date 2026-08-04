import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'bun:test'

const execFileAsync = promisify(execFile)
const repoRoot = process.cwd()
const lockedVersion = JSON.parse(
  await readFile(join(repoRoot, 'agent-core', 'narracat-agent-core.lock.json'), 'utf-8'),
).version

// 阶段2切片④：source 判据是自有清单 narracat.manifest.json（唯一契约清单）。
// 拆旧刀5：claude-sdk 适配器工件 plugin.json 已退役，夹具不再创建 .claude-plugin。
async function makeAgentCoreRoot(manifestVersion) {
  const root = await mkdtemp(join(tmpdir(), 'narracat-agent-core-source-'))
  await writeFile(
    join(root, 'narracat.manifest.json'),
    JSON.stringify({ name: 'narracat', version: manifestVersion, description: 'fixture' }),
    'utf-8',
  )
  return root
}

async function runPrepare(args) {
  try {
    const result = await execFileAsync('node', ['scripts/prepare-narracat-agent-core.mjs', ...args], {
      cwd: repoRoot,
      encoding: 'utf-8',
    })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }
  }
}

describe('prepare-narracat-agent-core', () => {
  test('check-version reports source manifest drift from the Agent Core lock', async () => {
    const source = await makeAgentCoreRoot('9.9.9')
    const destination = await makeAgentCoreRoot(lockedVersion)

    const result = await runPrepare([
      '--check-version',
      '--source',
      source,
      '--destination',
      destination,
    ])

    expect(result.code).toBe(1)
    expect(`${result.stdout}\n${result.stderr}`).toContain('NarraCat Agent Core 版本差异')
    expect(`${result.stdout}\n${result.stderr}`).toContain('来源: 9.9.9')
    expect(`${result.stdout}\n${result.stderr}`).toContain(`锁定: ${lockedVersion}`)
  })

  test('check-version passes when narracat.manifest.json matches the Agent Core lock', async () => {
    const root = await makeAgentCoreRoot(lockedVersion)

    const result = await runPrepare(['--check-version', '--source', root, '--destination', root])

    expect(result.code).toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain(`NarraCat Agent Core 版本一致：${lockedVersion}`)
  })

  test('source import replaces an outdated destination when the accepted source matches the Agent Core lock', async () => {
    const source = await makeAgentCoreRoot(lockedVersion)
    const destination = await makeAgentCoreRoot('1.0.0')

    const result = await runPrepare([
      '--final-import',
      '--source',
      source,
      '--destination',
      destination,
    ])
    const syncedManifest = JSON.parse(await readFile(join(destination, 'narracat.manifest.json'), 'utf-8'))

    expect(result.code).toBe(0)
    expect(syncedManifest.name).toBe('narracat')
    expect(syncedManifest.version).toBe(lockedVersion)
    expect(syncedManifest.description).toBe('fixture')
  })
})
