import { describe, expect, test } from 'bun:test'
import { loadNovelWorkbenchArtifacts } from './novel-artifacts'
import { loadNovelProjectDetail, loadNovelProjectSummary } from './novel-project'
import { createNovelProjectFixture } from './test-novel-fixture'

describe('novel project fixture', () => {
  test('expresses empty setup outlined and chaptered project states', async () => {
    const empty = await createNovelProjectFixture({ name: 'empty', state: 'empty' })
    const setup = await createNovelProjectFixture({ name: 'setup', state: 'setup' })
    const outlined = await createNovelProjectFixture({ name: 'outlined', state: 'outlined' })
    const chaptered = await createNovelProjectFixture({ name: 'chaptered', state: 'chaptered' })

    await expect(loadNovelProjectSummary(empty.root)).resolves.toMatchObject({
      title: '星辰大海',
      status: 'needs-setup',
      chapterProgress: '0 / 0 章',
    })
    await expect(loadNovelProjectSummary(setup.root)).resolves.toMatchObject({
      status: 'needs-outline',
      chapterProgress: '0 / 0 章',
    })
    await expect(loadNovelProjectSummary(outlined.root)).resolves.toMatchObject({
      status: 'ready',
      chapterProgress: '0 / 2 章',
    })
    await expect(loadNovelProjectSummary(chaptered.root)).resolves.toMatchObject({
      status: 'ready',
      chapterProgress: '1 / 2 章',
      wordCountLabel: '2100 字',
    })

    const outlinedDetail = await loadNovelProjectDetail(outlined.root, 2)
    expect(outlinedDetail.tocItems).toContainEqual(
      expect.objectContaining({
        id: 'chapter-1',
        status: 'planned',
      }),
    )
    expect(outlinedDetail.treeItems).toContainEqual(
      expect.objectContaining({
        id: 'volume-outline-1',
        exists: true,
      }),
    )

    const chapteredDetail = await loadNovelProjectDetail(chaptered.root, 2)
    expect(chapteredDetail.tocItems).toContainEqual(
      expect.objectContaining({
        id: 'chapter-1',
        status: 'completed',
      }),
    )
    expect(chapteredDetail.tocItems).toContainEqual(
      expect.objectContaining({
        id: 'chapter-2',
        status: 'planned',
      }),
    )
  })

  test('supports dynamic bible groups and chapter artifact contracts', async () => {
    const fixture = await createNovelProjectFixture({
      name: 'dynamic-contracts',
      state: 'chaptered',
      dynamicBibleGroups: [
        {
          dirName: 'rules',
          files: {
            'limits.md': '# Limits\n',
            'technology.txt': '不能超光速\n',
          },
        },
      ],
    })

    const detail = await loadNovelProjectDetail(fixture.root, 1)
    expect(detail.treeItems).toContainEqual(
      expect.objectContaining({
        id: 'bible-rules',
        kind: 'bible-group',
        title: '规则设定',
        exists: true,
      }),
    )

    await expect(
      loadNovelWorkbenchArtifacts({
        projectPath: fixture.root,
        objectId: 'chapter-1',
        volumeNumber: 1,
      }),
    ).resolves.toMatchObject({
      objectKind: 'chapter',
      artifacts: [
        expect.objectContaining({ id: 'chapter-outline', exists: true }),
        expect.objectContaining({ id: 'manuscript', exists: true }),
        expect.objectContaining({ id: 'context-pack', exists: true }),
        expect.objectContaining({ id: 'review', exists: true }),
        // 深审标注随轻审同住 reviews/，fixture 未跑深审故缺失（ADR-0021）。
        expect.objectContaining({ id: 'deep-review', exists: false }),
      ],
    })

    await expect(
      loadNovelWorkbenchArtifacts({
        projectPath: fixture.root,
        objectId: 'bible-rules',
      }),
    ).resolves.toMatchObject({
      objectKind: 'bible-group',
      title: '规则设定',
      artifacts: [
        expect.objectContaining({ id: 'bible-rules-limits.md', exists: true }),
        expect.objectContaining({ id: 'bible-rules-technology.txt', exists: true }),
      ],
    })
  })
})
