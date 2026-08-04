import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listSkillMounts,
  normalizeSkillMount,
  removeSkillMount,
  resetAgentSkillMounts,
  setSkillMount,
  skillMountStorePath,
} from './skill-mount-store'

async function makeStorePath(label: string): Promise<string> {
  const userData = await mkdtemp(join(tmpdir(), `narracat-skill-mounts-${label}-`))
  return skillMountStorePath(userData)
}

describe('SkillMountStore', () => {
  test('write-then-read roundtrip persists mounts', async () => {
    const storePath = await makeStorePath('roundtrip')

    await setSkillMount(storePath, { agentId: 'chapter-writer', skillId: 'sample-craft', mode: 'preload' })
    const mounts = await listSkillMounts(storePath)

    expect(mounts).toEqual([
      { agentId: 'chapter-writer', skillId: 'sample-craft', mode: 'preload', state: 'mounted' },
    ])
  })

  test('missing store file returns empty mounts (pure default overlay)', async () => {
    const storePath = await makeStorePath('missing')
    expect(await listSkillMounts(storePath)).toEqual([])
  })

  test('corrupt JSON degrades to empty mounts instead of throwing', async () => {
    const storePath = await makeStorePath('corrupt')
    await writeFile(storePath, '{ this is not valid json', 'utf-8')

    expect(await listSkillMounts(storePath)).toEqual([])
  })

  test('setSkillMount upserts the same (agentId, skillId) instead of duplicating', async () => {
    const storePath = await makeStorePath('upsert')

    await setSkillMount(storePath, { agentId: 'world-curator', skillId: 'novel-structure', mode: 'preload' })
    const mounts = await setSkillMount(storePath, {
      agentId: 'world-curator',
      skillId: 'novel-structure',
      mode: 'on-demand',
    })

    expect(mounts).toEqual([
      { agentId: 'world-curator', skillId: 'novel-structure', mode: 'on-demand', state: 'mounted' },
    ])
  })

  test('removeSkillMount drops only the matching record', async () => {
    const storePath = await makeStorePath('remove')

    await setSkillMount(storePath, { agentId: 'a', skillId: 's1', mode: 'preload' })
    await setSkillMount(storePath, { agentId: 'a', skillId: 's2', mode: 'preload' })
    const mounts = await removeSkillMount(storePath, { agentId: 'a', skillId: 's1' })

    expect(mounts).toEqual([{ agentId: 'a', skillId: 's2', mode: 'preload', state: 'mounted' }])
  })

  test('resetAgentSkillMounts clears all overlays for an agent only', async () => {
    const storePath = await makeStorePath('reset')

    await setSkillMount(storePath, { agentId: 'a', skillId: 's1', mode: 'preload' })
    await setSkillMount(storePath, { agentId: 'a', skillId: 's2', mode: 'on-demand' })
    await setSkillMount(storePath, { agentId: 'b', skillId: 's3', mode: 'preload' })
    const mounts = await resetAgentSkillMounts(storePath, { agentId: 'a' })

    expect(mounts).toEqual([{ agentId: 'b', skillId: 's3', mode: 'preload', state: 'mounted' }])
  })

  test('writes pretty JSON with a trailing newline', async () => {
    const storePath = await makeStorePath('format')
    await setSkillMount(storePath, { agentId: 'a', skillId: 's1', mode: 'preload' })

    const raw = await readFile(storePath, 'utf-8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(JSON.parse(raw)).toEqual({
      mounts: [{ agentId: 'a', skillId: 's1', mode: 'preload', state: 'mounted' }],
    })
  })

  test('normalizeSkillMount rejects invalid records', () => {
    expect(normalizeSkillMount(null)).toBeNull()
    expect(normalizeSkillMount({ agentId: 'a', skillId: 's', mode: 'nope' })).toBeNull()
    expect(normalizeSkillMount({ agentId: '  ', skillId: 's', mode: 'preload' })).toBeNull()
    expect(normalizeSkillMount({ agentId: 'a', skillId: 's', mode: 'on-demand', state: 'unmounted' })).toEqual({
      agentId: 'a',
      skillId: 's',
      mode: 'on-demand',
      state: 'unmounted',
    })
  })
})
