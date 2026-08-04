import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'bun:test'

import { createNarraCatPluginFixture } from '../../engine/test-plugin-fixture'
import { createNovelProjectFixture } from '../../novel/test-novel-fixture'
import { resolveRecoverWriteRun } from './recover-write'

let pluginPath = ''

function resolveDeps(): { pluginPath: string } {
  return { pluginPath }
}

// A ready project with chapter 1 planned; markChapterOneWriteInterrupted then
// drives it into a recoverable write checkpoint.
async function makeReadyProject(): Promise<string> {
  return (await createNovelProjectFixture({ name: 'recover-write', state: 'outlined' })).root
}

async function markChapterOneWriteInterrupted(projectPath: string): Promise<void> {
  await writeFile(
    join(projectPath, '.narracat', 'state.yaml'),
    [
      'progress:',
      '  last_completed_chapter: 0',
      '  completed_chapters: []',
      '  in_progress_chapter: 1',
      '  total_chapters_planned: 12',
      'word_count:',
      '  total: 0',
      '  by_chapter: {}',
      'checkpoint:',
      '  last_command: write',
      '  last_step: 5',
      '  timestamp: 2026-05-18T12:00:00.000Z',
      'structure:',
      '  total_volumes: 1',
      '  total_chapters_planned: 12',
      '  chapter_to_volume:',
      '    1: 1',
      '',
    ].join('\n'),
    'utf-8',
  )
  await mkdir(join(projectPath, '.narracat', 'context-packs'), { recursive: true })
  await mkdir(join(projectPath, 'manuscript', 'vol-01'), { recursive: true })
  await mkdir(join(projectPath, 'reviews'), { recursive: true })
  await writeFile(join(projectPath, '.narracat', 'context-packs', 'ch-001.json'), '{"target_chapter":1}\n', 'utf-8')
  await writeFile(join(projectPath, 'manuscript', 'vol-01', 'ch-001.md'), '# 第1章\n\n中断前正文\n', 'utf-8')
  await writeFile(
    join(projectPath, 'reviews', 'ch-001-review.json'),
    '{"chapter":1,"verdict":"pass","issues":[]}\n',
    'utf-8',
  )
}

describe('resolveRecoverWriteRun', () => {
  beforeAll(async () => {
    pluginPath = await createNarraCatPluginFixture('narracat-recover-write-plugin-')
  })

  test('continues a recoverable chapter through the NarraCat write command source', async () => {
    const projectPath = await makeReadyProject()
    await markChapterOneWriteInterrupted(projectPath)

    const resolved = await resolveRecoverWriteRun({ projectPath, userPrompt: '继续完成本章' }, resolveDeps())

    expect(resolved).toMatchObject({
      projectPath,
      chapterNumber: 1,
      volumeNumber: 1,
      maxTurns: 72,
    })
    expect(resolved.prompt).toContain('你正在当前小说项目中执行 NarraCat command：/narracat:write')
    expect(resolved.prompt).toContain('$ARGUMENTS：1')
    expect(resolved.prompt).not.toContain('$ARGUMENTS：继续完成本章')
    expect(resolved.prompt).toContain('恢复诊断')
    expect(resolved.prompt).toContain('recovery_mode: write')
    expect(resolved.prompt).toContain('chapter_num: 1')
    expect(resolved.prompt).toContain('checkpoint_last_step: 5')
    expect(resolved.prompt).toContain('manuscript_exists: true')
    expect(resolved.prompt).toContain('review_verdict: PASS')
    expect(resolved.prompt).toContain('recommended_resume_step: 6')
    expect(resolved.prompt).toContain('执行 write command。参数：$ARGUMENTS。')
  })

  test('recommends resume step 4 (not step 3) when only a staging draft exists, not the official manuscript', async () => {
    const projectPath = await makeReadyProject()
    await writeFile(
      join(projectPath, '.narracat', 'state.yaml'),
      [
        'progress:',
        '  last_completed_chapter: 0',
        '  completed_chapters: []',
        '  in_progress_chapter: 1',
        '  total_chapters_planned: 12',
        'word_count:',
        '  total: 0',
        '  by_chapter: {}',
        'checkpoint:',
        '  last_command: write',
        '  last_step: 3',
        '  timestamp: 2026-05-18T12:00:00.000Z',
        'structure:',
        '  total_volumes: 1',
        '  total_chapters_planned: 12',
        '  chapter_to_volume:',
        '    1: 1',
        '',
      ].join('\n'),
    )
    await mkdir(join(projectPath, '.narracat', 'context-packs'), { recursive: true })
    await mkdir(join(projectPath, '.narracat', 'staging'), { recursive: true })
    await writeFile(join(projectPath, '.narracat', 'context-packs', 'ch-001.json'), '{"target_chapter":1}\n', 'utf-8')
    await writeFile(join(projectPath, '.narracat', 'staging', 'ch-001.md'), '# 第1章\n\n中断前热写的草稿\n', 'utf-8')

    const resolved = await resolveRecoverWriteRun({ projectPath, userPrompt: '继续完成本章' }, resolveDeps())

    expect(resolved.prompt).toContain('manuscript_exists: true')
    expect(resolved.prompt).toContain('review_verdict: unknown')
    expect(resolved.prompt).toContain('recommended_resume_step: 4')
  })

  test('blocks recovery when no chapter is recoverable', async () => {
    const projectPath = await makeReadyProject()

    await expect(resolveRecoverWriteRun({ projectPath, userPrompt: '继续完成本章' }, resolveDeps())).rejects.toThrow(
      '没有可恢复的中断章节。',
    )
  })
})
