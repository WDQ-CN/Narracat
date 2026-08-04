import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

import { loadNovelChapterArtifacts, loadNovelWorkbenchArtifacts } from './novel-artifacts'
import { createNovelProjectFixture } from './test-novel-fixture'

async function makeArtifactProject(contextPackContent = '{"target_chapter":1,"style_guidance":{}}\n'): Promise<string> {
  return (await createNovelProjectFixture({ name: 'artifacts', state: 'chaptered', contextPackContent })).root
}

describe('novel chapter artifact loading', () => {
  test('loads chapter artifacts in display order with parsed context pack data', async () => {
    const root = await makeArtifactProject()

    const result = await loadNovelChapterArtifacts({
      projectPath: root,
      chapterNumber: 1,
      volumeNumber: 1,
    })

    expect(result.projectPath).toBe(root)
    expect(result.chapterNumber).toBe(1)
    expect(result.volumeNumber).toBe(1)
    expect(result.artifacts.map((artifact) => [artifact.kind, artifact.exists])).toEqual([
      ['outline', true],
      ['manuscript', true],
      ['context-pack', true],
      ['review', true],
      // 深审标注随轻审同住 reviews/，默认 fixture 未跑深审故缺失（ADR-0021）。
      ['deep-review', false],
    ])
    expect(result.artifacts[2].data).toEqual({ target_chapter: 1, style_guidance: {} })
  })

  test('discovers a deep-review annotation from reviews/ alongside the light review', async () => {
    const root = await makeArtifactProject()
    const deepReviewBody = '# 深审标注：第 1 章\n\n第 3 段：钩子有力，余韵收得稳。\n'
    await writeFile(join(root, 'reviews', 'ch-001-deep-review.md'), deepReviewBody, 'utf-8')

    const result = await loadNovelChapterArtifacts({ projectPath: root, chapterNumber: 1, volumeNumber: 1 })
    const deepReview = result.artifacts.find((artifact) => artifact.kind === 'deep-review')

    expect(deepReview?.exists).toBe(true)
    expect(deepReview?.path.endsWith('ch-001-deep-review.md')).toBe(true)
    expect(deepReview?.content).toBe(deepReviewBody)
    expect(deepReview?.data).toBeUndefined()
  })

  test('preserves invalid context pack content with a parse error', async () => {
    const invalidJson = '{"target_chapter":1,\n'
    const root = await makeArtifactProject(invalidJson)

    const result = await loadNovelChapterArtifacts({
      projectPath: root,
      chapterNumber: 1,
      volumeNumber: 1,
    })
    const contextPack = result.artifacts[2]

    expect(contextPack.kind).toBe('context-pack')
    expect(contextPack.exists).toBe(true)
    expect(contextPack.content).toBe(invalidJson)
    expect(contextPack.error).toContain('JSON 解析失败：')
  })

  test('prefers structured chapter outline json as parsed data over md fallback', async () => {
    const root = await makeArtifactProject()
    await writeFile(
      join(root, 'outline', 'vol-01', 'ch-001.json'),
      `${JSON.stringify({
        chapter: 1,
        title: '初醒',
        value_shift: '麻木→求生',
        pov_character: { character_uid: 'u', name: '林晚' },
        scenes: [
          { location: '剑冢', characters: [{ character_uid: 'u', name: '林晚' }], pressure_point: '断剑认主' },
        ],
      })}\n`,
      'utf-8',
    )

    const result = await loadNovelChapterArtifacts({ projectPath: root, chapterNumber: 1, volumeNumber: 1 })
    const outline = result.artifacts[0]

    expect(outline.kind).toBe('outline')
    expect(outline.exists).toBe(true)
    expect(outline.path.endsWith('ch-001.json')).toBe(true)
    expect(outline.data).toMatchObject({ chapter: 1, title: '初醒' })
    expect(outline.error).toBeUndefined()
  })

  test('resolves storyline_focus ids to names from the book outline contract', async () => {
    const root = await makeArtifactProject()
    await writeFile(
      join(root, 'outline', 'vol-01', 'ch-001.json'),
      `${JSON.stringify({ chapter: 1, title: '初醒', storyline_focus: ['SL-main', 'SL-rival'] })}\n`,
      'utf-8',
    )
    await writeFile(
      join(root, 'outline', 'outline-structure.json'),
      `${JSON.stringify({
        storylines: [
          { id: 'SL-main', name: '内奸与剑脉', type: 'main', priority: 1, entry_chapter: 1 },
          { id: 'SL-rival', name: '大师兄之争', type: 'rivalry', priority: 2, entry_chapter: 4 },
        ],
        volumes: [],
      })}\n`,
      'utf-8',
    )

    const result = await loadNovelChapterArtifacts({ projectPath: root, chapterNumber: 1, volumeNumber: 1 })
    const outline = result.artifacts[0]

    expect(outline.data).toMatchObject({
      storyline_focus: ['SL-main', 'SL-rival'],
      storylineNames: { 'SL-main': '内奸与剑脉', 'SL-rival': '大师兄之争' },
    })
  })

  test('leaves chapter outline data without storylineNames when book outline is absent', async () => {
    const root = await makeArtifactProject()
    await writeFile(
      join(root, 'outline', 'vol-01', 'ch-001.json'),
      `${JSON.stringify({ chapter: 1, title: '初醒', storyline_focus: ['SL-main'] })}\n`,
      'utf-8',
    )

    const result = await loadNovelChapterArtifacts({ projectPath: root, chapterNumber: 1, volumeNumber: 1 })
    const outline = result.artifacts[0]

    expect((outline.data as Record<string, unknown>).storylineNames).toBeUndefined()
  })

  test('resolves foreshadowing_touch ids to descriptions from the book outline registry', async () => {
    const root = await makeArtifactProject()
    await writeFile(
      join(root, 'outline', 'vol-01', 'ch-001.json'),
      `${JSON.stringify({
        chapter: 1,
        title: '初醒',
        beats: ['入场：断剑认主。', '升级：血珠剑鸣。', '翻转：玉符现形。'],
        foreshadowing_touch: [{ id: 'F-SWORD-CORE', action: 'reveal' }],
      })}\n`,
      'utf-8',
    )
    await writeFile(
      join(root, 'outline', 'outline-structure.json'),
      `${JSON.stringify({
        foreshadowing_registry: [
          { id: 'F-SWORD-CORE', type: 'major', description: '剑芯玉符', planted_chapter: 1, target_reveal: '20' },
        ],
        volumes: [],
      })}\n`,
      'utf-8',
    )

    const result = await loadNovelChapterArtifacts({ projectPath: root, chapterNumber: 1, volumeNumber: 1 })
    const outline = result.artifacts[0]

    expect(outline.data).toMatchObject({
      foreshadowing_touch: [{ id: 'F-SWORD-CORE', action: 'reveal' }],
      foreshadowingDescriptions: { 'F-SWORD-CORE': '剑芯玉符' },
    })
  })

  test('falls back to chapter outline md (no data) when no json twin exists', async () => {
    const root = await makeArtifactProject()
    const result = await loadNovelChapterArtifacts({ projectPath: root, chapterNumber: 1, volumeNumber: 1 })
    const outline = result.artifacts[0]

    expect(outline.kind).toBe('outline')
    expect(outline.exists).toBe(true)
    expect(outline.path.endsWith('ch-001.md')).toBe(true)
    expect(outline.data).toBeUndefined()
    expect(outline.content).toContain('初醒')
  })

  test('preserves invalid chapter outline json content with a parse error', async () => {
    const root = await makeArtifactProject()
    await writeFile(join(root, 'outline', 'vol-01', 'ch-001.json'), '{"chapter":1,\n', 'utf-8')

    const result = await loadNovelChapterArtifacts({ projectPath: root, chapterNumber: 1, volumeNumber: 1 })
    const outline = result.artifacts[0]

    expect(outline.path.endsWith('ch-001.json')).toBe(true)
    expect(outline.error).toContain('JSON 解析失败：')
  })

  test('returns missing artifacts for a missing project without throwing', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'narracat-artifacts-missing-'))
    const root = join(parent, 'missing-project')

    const result = await loadNovelChapterArtifacts({
      projectPath: root,
      chapterNumber: 1,
    })

    expect(result.projectPath).toBe(root)
    expect(result.chapterNumber).toBe(1)
    expect(result.volumeNumber).toBe(1)
    expect(result.artifacts).toHaveLength(5)
    expect(result.artifacts.every((artifact) => artifact.exists === false)).toBe(true)
  })

  test('reads a staging draft as the manuscript artifact with a read-only draft marker when official manuscript is missing', async () => {
    const root = await makeArtifactProject()
    await mkdir(join(root, '.narracat', 'staging'), { recursive: true })
    await writeFile(join(root, '.narracat', 'staging', 'ch-002.md'), '# 第2章\n\n中断前热写的草稿\n', 'utf-8')

    const result = await loadNovelChapterArtifacts({ projectPath: root, chapterNumber: 2, volumeNumber: 1 })
    const manuscript = result.artifacts.find((artifact) => artifact.kind === 'manuscript')

    expect(manuscript?.exists).toBe(true)
    expect(manuscript?.isDraft).toBe(true)
    expect(manuscript?.content).toContain('中断前热写的草稿')
    expect(manuscript?.path.endsWith(join('staging', 'ch-002.md'))).toBe(true)
  })

  test('does not fall back to a staging draft once the official manuscript exists', async () => {
    const root = await makeArtifactProject()
    await mkdir(join(root, '.narracat', 'staging'), { recursive: true })
    await writeFile(join(root, '.narracat', 'staging', 'ch-001.md'), '# 第1章\n\n本该被忽略的残留草稿\n', 'utf-8')

    const result = await loadNovelChapterArtifacts({ projectPath: root, chapterNumber: 1, volumeNumber: 1 })
    const manuscript = result.artifacts.find((artifact) => artifact.kind === 'manuscript')

    expect(manuscript?.exists).toBe(true)
    expect(manuscript?.isDraft).toBeUndefined()
    expect(manuscript?.content).not.toContain('残留草稿')
  })
})

test('loads master outline as a workbench object artifact', async () => {
  const root = await makeArtifactProject()
  await mkdir(join(root, 'outline'), { recursive: true })
  await writeFile(join(root, 'outline', 'master-outline.md'), '# 全书大纲\n', 'utf-8')

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'master-outline',
  })

  expect(result.objectId).toBe('master-outline')
  expect(result.objectKind).toBe('master-outline')
  expect(result.artifacts).toEqual([
    expect.objectContaining({
      id: 'master-outline',
      kind: 'markdown',
      title: '全书大纲',
      exists: true,
      content: '# 全书大纲\n',
    }),
  ])
})

test('attaches outline structure data contract to the master outline object', async () => {
  const root = await makeArtifactProject()
  await writeFile(
    join(root, 'outline', 'master-outline.md'),
    '# 全书大纲\n\n## 叙述者腔调\n- archetype: 热血\n',
    'utf-8',
  )
  await writeFile(
    join(root, 'outline', 'outline-structure.json'),
    `${JSON.stringify({
      central_dramatic_question: '林晚能否找出内奸?',
      storylines: [{ id: 'SL-main', name: '主线', type: 'main', priority: 1, entry_chapter: 1 }],
      volumes: [
        { volume_no: 1, title: '卷一', arc_list: [{ arc_id: 'V01-A01', title: '弧一', chapter_start: 1, chapter_end: 10 }] },
      ],
    })}\n`,
    'utf-8',
  )

  const result = await loadNovelWorkbenchArtifacts({ projectPath: root, objectId: 'master-outline' })
  const artifact = result.artifacts[0]

  expect(artifact.id).toBe('master-outline')
  expect(artifact.exists).toBe(true)
  // 原 md 保留：叙述者腔调摘要仍取 bible 层信息
  expect(artifact.content).toContain('叙述者腔调')
  // outline-structure.json 作为 DTO data 附加，App 从契约渲染卷章树/故事线
  expect(artifact.data).toMatchObject({ central_dramatic_question: '林晚能否找出内奸?' })
})

test('master outline stays displayable from data contract even when md is absent', async () => {
  const root = await makeArtifactProject()
  await rm(join(root, 'outline', 'master-outline.md'))
  await writeFile(
    join(root, 'outline', 'outline-structure.json'),
    `${JSON.stringify({ central_dramatic_question: '能否找出内奸?', volumes: [] })}\n`,
    'utf-8',
  )

  const result = await loadNovelWorkbenchArtifacts({ projectPath: root, objectId: 'master-outline' })
  const artifact = result.artifacts[0]

  expect(artifact.exists).toBe(true)
  expect(artifact.data).toMatchObject({ central_dramatic_question: '能否找出内奸?' })
})

test('loads narrator voice as a projected workbench object artifact', async () => {
  const root = await makeArtifactProject()
  await mkdir(join(root, 'outline'), { recursive: true })
  await writeFile(
    join(root, 'outline', 'master-outline.md'),
    [
      '# 全书大纲',
      '',
      '## 叙述者腔调（required，双路产出）',
      '- **archetype**: 猛文热血',
      '- **dimensions**:',
      '  - pacing: 急',
      '',
      '## 主要叙事弧线',
      '',
    ].join('\n'),
    'utf-8',
  )

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'narrator-voice',
  })

  expect(result.objectId).toBe('narrator-voice')
  expect(result.objectKind).toBe('narrator-voice')
  expect(result.artifacts).toEqual([
    expect.objectContaining({
      id: 'narrator-voice',
      kind: 'markdown',
      title: '叙事声音 / 写作风格',
      exists: true,
      content: expect.stringContaining('## 叙述者腔调'),
    }),
  ])
  expect(result.artifacts[0]?.content).not.toContain('## 主要叙事弧线')
})

test('loads volume outline as a workbench object artifact', async () => {
  const root = await makeArtifactProject()
  await writeFile(join(root, 'outline', 'vol-01', 'vol-outline.md'), '# 第一卷\n', 'utf-8')

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'volume-outline-1',
  })

  expect(result.objectKind).toBe('volume-outline')
  expect(result.artifacts[0]).toMatchObject({
    id: 'volume-outline-1',
    kind: 'markdown',
    title: '卷大纲',
    exists: true,
  })
})

test('loads chapter bundle as workbench object artifacts', async () => {
  const root = await makeArtifactProject()

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'chapter-1',
    volumeNumber: 1,
  })

  expect(result.objectKind).toBe('chapter')
  expect(result.artifacts.map((artifact) => [artifact.id, artifact.exists])).toEqual([
    ['chapter-outline', true],
    ['manuscript', true],
    ['context-pack', true],
    ['review', true],
    ['deep-review', false],
  ])
})

test('surfaces a staging draft manuscript as a read-only workbench chapter artifact', async () => {
  const root = await makeArtifactProject()
  await mkdir(join(root, '.narracat', 'staging'), { recursive: true })
  await writeFile(join(root, '.narracat', 'staging', 'ch-002.md'), '# 第2章\n\n中断前热写的草稿\n', 'utf-8')

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'chapter-2',
    volumeNumber: 1,
  })

  expect(result.artifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'manuscript',
        kind: 'manuscript',
        exists: true,
        isDraft: true,
        content: expect.stringContaining('中断前热写的草稿'),
      }),
    ]),
  )
})

test('surfaces a deep-review annotation as a workbench chapter artifact', async () => {
  const root = await makeArtifactProject()
  await writeFile(join(root, 'reviews', 'ch-001-deep-review.md'), '# 深审标注：第 1 章\n\n第 3 段：钩子有力。\n', 'utf-8')

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'chapter-1',
    volumeNumber: 1,
  })

  expect(result.artifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'deep-review',
        kind: 'deep-review',
        exists: true,
        content: expect.stringContaining('深审标注'),
      }),
    ]),
  )
})

test('loads unpadded NarraCat chapter output filenames as workbench object artifacts', async () => {
  const root = await makeArtifactProject()
  await rm(join(root, 'manuscript', 'vol-01', 'ch-001.md'))
  await rm(join(root, '.narracat', 'context-packs', 'ch-001.json'))
  await rm(join(root, 'reviews', 'ch-001-review.json'))
  await writeFile(join(root, 'manuscript', 'vol-01', 'ch-1.md'), '# 第1章\n\n非补零正文\n', 'utf-8')
  await writeFile(join(root, '.narracat', 'context-packs', 'ch-1.json'), '{"target_chapter":1}\n', 'utf-8')
  await writeFile(
    join(root, 'reviews', 'ch-1-review.json'),
    '{"chapter":1,"verdict":"fail","issues":[{"severity":"blocker","where":"第1段","what":"时间线矛盾","fix_hint":"对齐前章"}]}\n',
    'utf-8',
  )

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'chapter-1',
    volumeNumber: 1,
  })

  expect(result.objectKind).toBe('chapter')
  expect(result.artifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'manuscript', exists: true, content: expect.stringContaining('非补零正文') }),
      expect.objectContaining({ id: 'context-pack', exists: true, data: { target_chapter: 1 } }),
      expect.objectContaining({ id: 'review', exists: true, data: expect.objectContaining({ verdict: 'fail' }) }),
    ]),
  )
})

test('loads root-level NarraCat manuscript output as a chapter workbench artifact', async () => {
  const root = await makeArtifactProject()
  await rm(join(root, 'manuscript', 'vol-01', 'ch-001.md'))
  await writeFile(join(root, 'manuscript', 'ch-001.md'), '# 第1章\n\n真实正文\n', 'utf-8')

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'chapter-1',
    volumeNumber: 1,
  })

  expect(result.objectKind).toBe('chapter')
  expect(result.artifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'manuscript', exists: true, content: expect.stringContaining('真实正文') }),
    ]),
  )
})

test('loads bible premise as a workbench object artifact', async () => {
  const root = await makeArtifactProject()
  await mkdir(join(root, 'bible'), { recursive: true })
  await writeFile(join(root, 'bible', 'premise.md'), '# 核心前提\n\n真实前提\n', 'utf-8')

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'bible-premise',
  })

  expect(result.objectKind).toBe('bible-document')
  expect(result.artifacts[0]).toMatchObject({
    id: 'bible-premise',
    kind: 'markdown',
    title: '核心前提',
    exists: true,
    content: '# 核心前提\n\n真实前提\n',
  })
})

test('treats initialized setup templates as missing workbench artifacts', async () => {
  const root = (await createNovelProjectFixture({ name: 'template-artifacts', state: 'empty' })).root

  const foundation = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'foundation',
  })
  const premise = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'bible-premise',
  })
  const characters = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'characters',
  })
  const world = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'world',
  })

  expect(foundation.artifacts.map((artifact) => [artifact.id, artifact.exists])).toEqual([
    ['bible-premise', false],
    ['bible-relationships', false],
  ])
  expect(premise.artifacts[0]).toMatchObject({
    id: 'bible-premise',
    exists: false,
  })
  expect('content' in premise.artifacts[0]).toBe(false)
  expect(characters.artifacts.map((artifact) => [artifact.id, artifact.exists])).toEqual([
    ['character-角色名', false],
  ])
  expect(world.artifacts.map((artifact) => [artifact.id, artifact.exists])).toEqual([
    ['world-设定名称', false],
  ])
})

test('loads foundation as the standard bible artifact group', async () => {
  const root = await makeArtifactProject()
  await mkdir(join(root, 'bible'), { recursive: true })
  await writeFile(join(root, 'bible', 'premise.md'), '# 核心前提\n\n真实前提\n', 'utf-8')
  await writeFile(join(root, 'bible', 'style-guide.md'), '# 风格指南\n\n第三人称\n', 'utf-8')

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'foundation',
  })

  expect(result.objectKind).toBe('foundation')
  expect(result.artifacts.map((artifact) => [artifact.id, artifact.exists])).toEqual([
    ['bible-premise', true],
    ['bible-relationships', false],
  ])
  expect(result.artifacts.some((artifact) => artifact.id === 'bible-style-guide')).toBe(false)
})

test('loads volume group through its volume outline artifact', async () => {
  const root = await makeArtifactProject()
  await writeFile(join(root, 'outline', 'vol-01', 'vol-outline.md'), '# 第一卷\n', 'utf-8')

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'volume-1',
  })

  expect(result.objectKind).toBe('volume')
  expect(result.artifacts[0]).toMatchObject({
    id: 'volume-outline-1',
    kind: 'markdown',
    title: '卷大纲',
    exists: true,
  })
})

test('loads foundation child list groups from direct text files', async () => {
  const root = await makeArtifactProject()
  await mkdir(join(root, 'bible', 'characters'), { recursive: true })
  await mkdir(join(root, 'bible', 'world'), { recursive: true })
  await mkdir(join(root, 'bible', 'references'), { recursive: true })
  await writeFile(
    join(root, 'bible', 'characters', 'role-001.md'),
    '# 角色档案\n\n## 基本信息\n- **姓名**：张三（灰谷巡夜人）\n\n目标明确\n',
    'utf-8',
  )
  await writeFile(join(root, 'bible', 'world', '边城.md'), '# 边城\n\n边城是主角旅程的起点。\n', 'utf-8')
  // 英文 slug 文件名 + 中文标题：目录展示应取文档首个标题，而非英文文件名。
  await writeFile(join(root, 'bible', 'world', 'jianghu-rules.md'), '# 江湖规则体系\n\n资格认证体系。\n', 'utf-8')
  await writeFile(join(root, 'bible', 'references', '参考章.txt'), '参考章\n', 'utf-8')
  await mkdir(join(root, 'bible', 'reference-guidance'), { recursive: true })
  await writeFile(join(root, 'bible', 'reference-guidance', 'index.md'), '# 参考指导\n\n句式短促，转场利落。\n', 'utf-8')

  const characters = await loadNovelWorkbenchArtifacts({ projectPath: root, objectId: 'characters' })
  expect(characters.objectKind).toBe('character-list')
  expect(characters.artifacts).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'character-role-001', title: '张三', exists: true })]),
  )

  const world = await loadNovelWorkbenchArtifacts({ projectPath: root, objectId: 'world' })
  expect(world.objectKind).toBe('world-list')
  expect(world.artifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'world-边城', title: '边城', exists: true }),
      expect.objectContaining({ id: 'world-jianghu-rules', title: '江湖规则体系', exists: true }),
    ]),
  )

  await expect(loadNovelWorkbenchArtifacts({ projectPath: root, objectId: 'references' })).resolves.toMatchObject({
    objectKind: 'reference-list',
    title: '参考作品',
    referenceWorksSummary: {
      status: {
        guidanceState: 'current',
        sourceCount: 1,
        needsAnalysis: false,
        guidanceExists: true,
      },
      guidance: {
        exists: true,
        relativePath: 'bible/reference-guidance/index.md',
        content: '# 参考指导\n\n句式短促，转场利落。\n',
      },
    },
    artifacts: [],
  })
})

test('single world document title comes from the first heading, not the english filename', async () => {
  const root = await makeArtifactProject()
  await mkdir(join(root, 'bible', 'world'), { recursive: true })
  await writeFile(join(root, 'bible', 'world', 'jianghu-rules.md'), '# 江湖规则体系\n\n资格认证体系。\n', 'utf-8')

  const object = await loadNovelWorkbenchArtifacts({ projectPath: root, objectId: 'world-jianghu-rules' })

  expect(object.objectKind).toBe('world')
  expect(object.title).toBe('江湖规则体系')
  expect(object.artifacts).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'world-jianghu-rules', title: '江湖规则体系' })]),
  )
})

test('parses character_identity: exposes uid/name and hides the comment from rendering', async () => {
  const root = await makeArtifactProject()
  await mkdir(join(root, 'bible', 'characters'), { recursive: true })
  await writeFile(
    join(root, 'bible', 'characters', 'role-007.md'),
    '# 角色档案\n<!-- character_identity: {"character_uid":"a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d","name":"林衍"} -->\n\n## 基本信息\n- **姓名**：林衍\n\n沉默寡言。\n',
    'utf-8',
  )

  const characters = await loadNovelWorkbenchArtifacts({ projectPath: root, objectId: 'characters' })
  const role = characters.artifacts.find((artifact) => artifact.id === 'character-role-007')
  expect(role).toBeDefined()
  expect(role?.characterUid).toBe('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
  expect(role?.characterName).toBe('林衍')
  expect(role?.title).toBe('林衍')
  expect(role?.content).not.toContain('character_identity')
  expect(role?.content).toContain('沉默寡言')
  // 缺 profile_stage 的旧档按 full 兼容
  expect(role?.characterProfileStage).toBe('full')
})

test('parses character_identity profile_stage: stub 角色档案标完善度', async () => {
  const root = await makeArtifactProject()
  await mkdir(join(root, 'bible', 'characters'), { recursive: true })
  await writeFile(
    join(root, 'bible', 'characters', 'role-008.md'),
    '# 角色档案\n<!-- character_identity: {"character_uid":"b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d","name":"无名客","profile_stage":"stub"} -->\n\n## 基本信息\n- **姓名**：无名客（留白）\n',
    'utf-8',
  )

  const characters = await loadNovelWorkbenchArtifacts({ projectPath: root, objectId: 'characters' })
  const role = characters.artifacts.find((artifact) => artifact.id === 'character-role-008')
  expect(role?.characterProfileStage).toBe('stub')
})

test('loads world settings and dynamic bible groups from direct files only', async () => {
  const root = await makeArtifactProject()
  await rm(join(root, 'bible', 'world'), { recursive: true, force: true })
  await mkdir(join(root, 'bible', 'world', 'nested'), { recursive: true })
  await mkdir(join(root, 'bible', 'rules', 'nested'), { recursive: true })
  await writeFile(join(root, 'bible', 'world', '学院.md'), '# 学院\n\n学院制度。\n', 'utf-8')
  await writeFile(join(root, 'bible', 'world', '边城.md'), '# 边城\n\n边城是主角旅程的起点。\n', 'utf-8')
  await writeFile(join(root, 'bible', 'world', 'nested', '隐藏势力.md'), '# 隐藏势力\n', 'utf-8')
  await writeFile(join(root, 'bible', 'rules', 'limits.md'), '# Limits\n', 'utf-8')
  await writeFile(join(root, 'bible', 'rules', 'notes.txt'), '不能超光速\n', 'utf-8')
  await writeFile(join(root, 'bible', 'rules', 'nested', 'hidden.md'), '# Hidden\n', 'utf-8')

  const world = await loadNovelWorkbenchArtifacts({ projectPath: root, objectId: 'world' })
  const rules = await loadNovelWorkbenchArtifacts({ projectPath: root, objectId: 'bible-rules' })

  expect(world.objectKind).toBe('world-list')
  expect(world.artifacts).toHaveLength(2)
  expect(world.artifacts.map((artifact) => artifact.id)).toEqual(
    expect.arrayContaining(['world-学院', 'world-边城']),
  )
  expect(world.artifacts.map((artifact) => artifact.id)).not.toContain('world-隐藏势力')
  expect(rules.objectKind).toBe('bible-group')
  expect(rules.artifacts).toHaveLength(2)
  expect(rules.artifacts.map((artifact) => artifact.id)).toEqual(
    expect.arrayContaining(['bible-rules-limits.md', 'bible-rules-notes.txt']),
  )
  expect(rules.artifacts.map((artifact) => artifact.id)).not.toContain('bible-rules-hidden.md')
})

test('loads dynamic bible directory groups from markdown and text files', async () => {
  const root = await makeArtifactProject()
  await mkdir(join(root, 'bible', 'rules'), { recursive: true })
  await writeFile(join(root, 'bible', 'rules', 'limits.md'), '# Limits\n', 'utf-8')
  await writeFile(join(root, 'bible', 'rules', 'technology.md'), '# Technology\n', 'utf-8')
  await writeFile(join(root, 'bible', 'rules', 'limits.txt'), '不能超光速\n', 'utf-8')

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'bible-rules',
  })

  expect(result.objectKind).toBe('bible-group')
  expect(result.title).toBe('规则设定')
  expect(result.artifacts).toEqual([
    expect.objectContaining({
      id: 'bible-rules-limits.md',
      title: 'limits',
      exists: true,
    }),
    expect.objectContaining({
      id: 'bible-rules-limits.txt',
      title: 'limits',
      exists: true,
      content: '不能超光速\n',
    }),
    expect.objectContaining({
      id: 'bible-rules-technology.md',
      title: 'technology',
      exists: true,
    }),
  ])
  expect(new Set(result.artifacts.map((artifact) => artifact.id)).size).toBe(result.artifacts.length)
})

test('loads dynamic bible directory groups from markdown files', async () => {
  const root = await makeArtifactProject()
  await mkdir(join(root, 'bible', 'rules'), { recursive: true })
  await writeFile(join(root, 'bible', 'rules', 'technology.md'), '# Technology\n', 'utf-8')

  const result = await loadNovelWorkbenchArtifacts({
    projectPath: root,
    objectId: 'bible-rules',
  })

  expect(result.objectKind).toBe('bible-group')
  expect(result.title).toBe('规则设定')
  expect(result.artifacts[0]).toMatchObject({
    id: 'bible-rules-technology.md',
    title: 'technology',
    exists: true,
  })
})

test('rejects uploaded reference files as direct workbench object artifacts', async () => {
  const root = await makeArtifactProject()
  await mkdir(join(root, 'bible', 'references'), { recursive: true })
  await writeFile(join(root, 'bible', 'references', '参考章.txt'), '参考章\n', 'utf-8')

  await expect(
    loadNovelWorkbenchArtifacts({
      projectPath: root,
      objectId: 'reference-参考章.txt',
    }),
  ).rejects.toThrow()
})

test('rejects traversal and undefined workbench object ids', async () => {
  const root = await makeArtifactProject()

  await expect(
    loadNovelWorkbenchArtifacts({
      projectPath: root,
      objectId: '../outside',
    }),
  ).rejects.toThrow('工作台对象 ID 非法。')
  await expect(
    loadNovelWorkbenchArtifacts({
      projectPath: root,
      objectId: 'chapter-abc',
    }),
  ).rejects.toThrow('工作台对象 ID 非法。')
  await expect(
    loadNovelWorkbenchArtifacts({
      projectPath: root,
      objectId: 'unknown-group',
    }),
  ).rejects.toThrow('工作台对象 ID 非法。')
  await expect(
    loadNovelWorkbenchArtifacts({
      projectPath: root,
      objectId: 'bible-.',
    }),
  ).rejects.toThrow('工作台对象 ID 非法。')
  await expect(
    loadNovelWorkbenchArtifacts({
      projectPath: root,
      objectId: 'bible-..',
    }),
  ).rejects.toThrow('工作台对象 ID 非法。')
})
