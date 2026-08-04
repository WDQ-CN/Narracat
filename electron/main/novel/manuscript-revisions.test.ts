import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createManuscriptRevisionStore,
  parseManuscriptRevisionInput,
  parseReadManuscriptRevisionInput,
  parseRestoreManuscriptRevisionInput,
} from './manuscript-revisions.ts'
import { createNovelProjectFixture } from './test-novel-fixture.ts'

const ORIGINAL = '# 第1章: 初醒\n\n正文'
const AUTHOR_EDIT = '# 第1章: 初醒\n\n作者修改后的正文'
const AGENT_REWRITE = '# 第1章: 初醒\n\nAgent 重写后的正文'
const IDS = [
  'rev-00000000-0000-4000-8000-000000000001',
  'rev-00000000-0000-4000-8000-000000000002',
  'rev-00000000-0000-4000-8000-000000000003',
]

describe('manuscript revision store', () => {
  let projectPath: string
  let idIndex: number
  let timeIndex: number

  beforeEach(async () => {
    projectPath = (await createNovelProjectFixture({ name: 'revisions' })).root
    idIndex = 0
    timeIndex = 0
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  function createStore(instanceId = 'test-instance-1') {
    return createManuscriptRevisionStore({
      createRevisionId: () => IDS[idIndex++]!,
      now: () => `2026-07-26T00:00:0${timeIndex++}.000Z`,
      instanceId,
    })
  }

  test('begin 在变更前压缩正文，complete 留下可读版本并返回实际磁盘占用', async () => {
    const store = createStore()
    const capture = await store.begin({
      projectPath,
      chapter: 1,
      source: 'author-save',
      beforeVisibleText: ORIGINAL,
    })
    await writeFile(join(projectPath, 'manuscript', 'vol-01', 'ch-001.md'), `${AUTHOR_EDIT}\n`, 'utf-8')
    const completed = await store.complete({ projectPath, revisionId: capture.revisionId })

    expect(completed).toMatchObject({
      id: IDS[0],
      chapter: 1,
      source: 'author-save',
      summary: { addedChars: 6, removedChars: 0 },
    })
    const list = await store.listChapter({ projectPath, chapter: 1 })
    expect(list.revisions).toEqual([completed])
    expect(list.storageBytes).toBeGreaterThan(0)
    expect(await store.readRevision({ projectPath, chapter: 1, revisionId: capture.revisionId })).toEqual({
      revision: completed,
      visibleText: ORIGINAL,
    })

    const blobs = await readdir(join(projectPath, '.narracat', 'manuscript-revisions', 'blobs'))
    expect(blobs).toHaveLength(2)
    expect(blobs.every((name) => /^[a-f0-9]{64}\.txt\.gz$/.test(name))).toBe(true)
  })

  test('hash 未变化时不新增 revision，内容 blob 仍按 hash 去重', async () => {
    const store = createStore()
    const first = await store.begin({
      projectPath,
      chapter: 1,
      source: 'author-save',
      beforeVisibleText: ORIGINAL,
    })
    await store.complete({ projectPath, revisionId: first.revisionId, afterVisibleText: AUTHOR_EDIT })

    const unchanged = await store.begin({
      projectPath,
      chapter: 1,
      source: 'author-save',
      beforeVisibleText: AUTHOR_EDIT,
    })
    expect(
      await store.complete({
        projectPath,
        revisionId: unchanged.revisionId,
        afterVisibleText: `${AUTHOR_EDIT}\r\n`,
      }),
    ).toBeNull()

    expect((await store.listChapter({ projectPath, chapter: 1 })).revisions).toHaveLength(1)
    expect(await readdir(join(projectPath, '.narracat', 'manuscript-revisions', 'blobs'))).toHaveLength(2)
    expect(await readdir(join(projectPath, '.narracat', 'manuscript-revisions', 'pending'))).toHaveLength(0)
  })

  test('pending capture 在进程中断后由 list 按当前磁盘正文补齐，且 complete 幂等', async () => {
    const store = createStore()
    const capture = await store.begin({
      projectPath,
      chapter: 1,
      source: 'agent-rewrite',
      beforeVisibleText: ORIGINAL,
      runId: 'run-1',
    })
    await writeFile(join(projectPath, 'manuscript', 'vol-01', 'ch-001.md'), `${AGENT_REWRITE}\n`, 'utf-8')

    expect((await store.listChapter({ projectPath, chapter: 1 })).revisions).toHaveLength(0)
    const recoveredStore = createStore('test-instance-after-crash')
    const recovered = await recoveredStore.listChapter({ projectPath, chapter: 1 })
    expect(recovered.revisions).toHaveLength(1)
    expect(recovered.revisions[0]).toMatchObject({ id: capture.revisionId, source: 'agent-rewrite' })
    expect(await recoveredStore.complete({ projectPath, revisionId: capture.revisionId })).toEqual(
      recovered.revisions[0],
    )
    expect((await recoveredStore.listChapter({ projectPath, chapter: 1 })).revisions).toHaveLength(1)
  })

  test('complete 在索引前失败后，同一 App 实例的下一次读取也能接管 pending', async () => {
    const store = createStore()
    const capture = await store.begin({
      projectPath,
      chapter: 1,
      source: 'agent-rewrite',
      beforeVisibleText: ORIGINAL,
    })
    await writeFile(join(projectPath, 'manuscript', 'vol-01', 'ch-001.md'), `${AGENT_REWRITE}\n`, 'utf-8')

    const configPath = join(projectPath, '.narracat', 'config.yaml')
    const hiddenConfigPath = `${configPath}.temporarily-hidden`
    await rename(configPath, hiddenConfigPath)
    await expect(store.complete({ projectPath, revisionId: capture.revisionId })).rejects.toThrow('有效')
    await rename(hiddenConfigPath, configPath)

    const recovered = await store.listChapter({ projectPath, chapter: 1 })
    expect(recovered.revisions).toHaveLength(1)
    expect(recovered.revisions[0]).toMatchObject({ id: capture.revisionId, source: 'agent-rewrite' })
  })

  test('新章节第一次 agent-write 没有 before 正文也会留下 after 版本', async () => {
    const store = createStore()
    const capture = await store.begin({
      projectPath,
      chapter: 2,
      source: 'agent-write',
      beforeVisibleText: null,
    })
    await writeFile(join(projectPath, 'manuscript', 'vol-01', 'ch-002.md'), '# 第2章: 远行\n\n新正文\n', 'utf-8')
    await store.complete({ projectPath, revisionId: capture.revisionId })

    const list = await store.listChapter({ projectPath, chapter: 2 })
    expect(list.revisions).toHaveLength(1)
    expect(list.revisions[0]).toMatchObject({
      source: 'agent-write',
      summary: { addedChars: 14, removedChars: 0 },
    })
  })

  test('损坏或高版本索引 fail closed，不伪装为空历史', async () => {
    const root = join(projectPath, '.narracat', 'manuscript-revisions')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'index.json'), '{"schemaVersion":2,"novelId":"novel-1","revisions":[]}\n', 'utf-8')
    await expect(createStore().listChapter({ projectPath, chapter: 1 })).rejects.toThrow('更新版本')

    await writeFile(join(root, 'index.json'), '{bad', 'utf-8')
    await expect(createStore().listChapter({ projectPath, chapter: 1 })).rejects.toThrow('索引损坏')
  })
})

describe('manuscript revision IPC parsing', () => {
  test('只接受绝对项目路径、正章号和受控 revision id', () => {
    expect(parseManuscriptRevisionInput({ projectPath: '/p', chapter: 1 })).toEqual({
      projectPath: '/p',
      chapter: 1,
    })
    expect(
      parseReadManuscriptRevisionInput({
        projectPath: '/p',
        chapter: 1,
        revisionId: IDS[0],
      }),
    ).toEqual({ projectPath: '/p', chapter: 1, revisionId: IDS[0] })
    expect(
      parseRestoreManuscriptRevisionInput({
        projectPath: '/p',
        chapter: 1,
        revisionId: IDS[0],
        expectedVisibleText: '正文',
      }),
    ).toEqual({ projectPath: '/p', chapter: 1, revisionId: IDS[0], expectedVisibleText: '正文' })

    expect(() => parseManuscriptRevisionInput({ projectPath: 'relative', chapter: 1 })).toThrow()
    expect(() =>
      parseReadManuscriptRevisionInput({ projectPath: '/p', chapter: 1, revisionId: '../../secret' }),
    ).toThrow()
  })
})
