import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackLearner, buildLearnPrompt, SOURCE_FINGERPRINT_FILENAME, type PackLearnerDeps } from './pack-learn'
import { getPackDraft, listPackDrafts, packDraftsDir } from './pack-drafts'
import type { PackLearnEvent } from '@shared/types/capability-pack'

let tmp: string
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'narracat-learn-')) })
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

const SOURCE_TEXT = '他推开破庙的门，雪片跟着卷了进来，火堆边的老人没有抬头。'

function makeNovelProject(): string {
  const project = join(tmp, 'novel-a')
  // 真实成稿契约 = manuscript/vol-NN/ch-NNN.md（novel-layout.ts；T5 评审 Critical 教训，勿用臆造的 chapters/）
  mkdirSync(join(project, 'manuscript', 'vol-01'), { recursive: true })
  for (let i = 1; i <= 3; i++) {
    writeFileSync(join(project, 'manuscript', 'vol-01', `ch-00${i}.md`), `# 第${i}章\n\n${SOURCE_TEXT}第${i}章正文。`, 'utf8')
  }
  return project
}

const CLEAN_CARDS = {
  cards: [
    { type: 'craft', name: '留白收尾', one_line: '顶点前停笔', body: '[runtime]\n机制名：留白收尾\n注解：情绪顶点前一拍停笔。\n\n[evidence]\n摘录', intent: '高潮章用' },
  ],
  proper_nouns: ['破庙老人'],
}

function makeDeps(overrides: Partial<PackLearnerDeps> = {}): { deps: PackLearnerDeps; events: PackLearnEvent[] } {
  const events: PackLearnEvent[] = []
  const deps: PackLearnerDeps = {
    userDataPath: () => tmp,
    // 假学习会话：直接把 CLEAN_CARDS 写进 output/cards.json
    runLearnSession: async ({ workspaceDir }) => {
      await writeFile(join(workspaceDir, 'output', 'cards.json'), JSON.stringify(CLEAN_CARDS), 'utf8')
      return { ok: true }
    },
    rewriteCardBody: async () => null,
    compileCard: async () => ({ status: 'ok' }),
    readCommandSource: async () => '# learn-craft 命令正文',
    readMethodologySource: async () => '# 方法论正文',
    emit: (e) => events.push(e),
    ...overrides,
  }
  return { deps, events }
}

describe('createPackLearner', () => {
  test('happy path：出草稿工程，meta 锁 learned-own，指纹落盘，事件走到 done', async () => {
    let capturedWorkspaceDir = ''
    const { deps, events } = makeDeps({
      runLearnSession: async ({ workspaceDir }) => {
        capturedWorkspaceDir = workspaceDir
        await writeFile(join(workspaceDir, 'output', 'cards.json'), JSON.stringify(CLEAN_CARDS), 'utf8')
        return { ok: true }
      },
    })
    const learner = createPackLearner(deps)
    const result = await learner.startLearning({ source: { kind: 'novel', projectPath: makeNovelProject(), title: '试书' }, tier: 'skim' })
    if (result.status !== 'ok') throw new Error(JSON.stringify(result))
    const draft = await getPackDraft({ userDataPath: tmp, draftId: result.draftId })
    expect(draft?.meta.localSource).toBe('learned-own')
    expect(draft?.meta.learnedFrom).toEqual({ sourceKind: 'novel', title: '试书' })
    expect(draft?.meta.name).toBe('《试书》·写法')
    expect(draft?.cards.length).toBe(1)
    const fp = JSON.parse(await readFile(join(packDraftsDir(tmp), result.draftId, SOURCE_FINGERPRINT_FILENAME), 'utf8'))
    expect(fp.properNouns).toContain('破庙老人')
    expect(events.at(-1)?.phase).toBe('done')
    // F4：report 三字段——3 章成书 skim 档 3 章全抽样，1 张干净卡全保留、0 张丢弃
    expect(result.report).toEqual({ cardsKept: 1, cardsDropped: 0, chaptersSampled: 3 })
    // F2：学习会话用过的临时工作区，跑完必须已被清理，不留残留
    expect(capturedWorkspaceDir).not.toBe('')
    expect(existsSync(capturedWorkspaceDir)).toBe(false)
  })

  test('贴原文的卡：重写失败（rewrite 返 null）→ 丢弃；全丢 → error 且无工程落盘', async () => {
    const plagiarized = {
      cards: [{ type: 'craft', name: '抄', one_line: '抄', body: `[runtime]\n${SOURCE_TEXT}\n\n[evidence]\n无`, intent: '无' }],
      proper_nouns: [],
    }
    const { deps } = makeDeps({
      runLearnSession: async ({ workspaceDir }) => {
        await writeFile(join(workspaceDir, 'output', 'cards.json'), JSON.stringify(plagiarized), 'utf8')
        return { ok: true }
      },
    })
    const learner = createPackLearner(deps)
    const result = await learner.startLearning({ source: { kind: 'novel', projectPath: makeNovelProject(), title: '试书' }, tier: 'skim' })
    expect(result.status).toBe('error')
    expect(await listPackDrafts({ userDataPath: tmp })).toEqual([])
  })

  test('贴原文的卡：重写成功 → 保留重写后的正文', async () => {
    const plagiarized = {
      cards: [{ type: 'craft', name: '半抄', one_line: 'x', body: `[runtime]\n${SOURCE_TEXT}\n\n[evidence]\n无`, intent: 'x' }],
      proper_nouns: [],
    }
    const { deps } = makeDeps({
      runLearnSession: async ({ workspaceDir }) => {
        await writeFile(join(workspaceDir, 'output', 'cards.json'), JSON.stringify(plagiarized), 'utf8')
        return { ok: true }
      },
      rewriteCardBody: async () => '[runtime]\n机制名：门与雪\n注解：用环境细节代替情绪陈述。\n\n[evidence]\n无',
    })
    const learner = createPackLearner(deps)
    const result = await learner.startLearning({ source: { kind: 'novel', projectPath: makeNovelProject(), title: '试书' }, tier: 'skim' })
    if (result.status !== 'ok') throw new Error(JSON.stringify(result))
    const draft = await getPackDraft({ userDataPath: tmp, draftId: result.draftId })
    expect(draft?.cards[0].body).toContain('门与雪')
  })

  test('txt 来源 → learned-external', async () => {
    const txtPath = join(tmp, '外部书.txt')
    writeFileSync(txtPath, `第1章 开局\n${'正文。'.repeat(100)}\n第2章 发展\n正文二\n第3章 收束\n正文三`, 'utf8')
    const { deps } = makeDeps()
    const learner = createPackLearner(deps)
    const result = await learner.startLearning({ source: { kind: 'txt', filePath: txtPath, title: '外部书' }, tier: 'skim' })
    if (result.status !== 'ok') throw new Error(JSON.stringify(result))
    const draft = await getPackDraft({ userDataPath: tmp, draftId: result.draftId })
    expect(draft?.meta.localSource).toBe('learned-external')
  })

  test('会话失败 → error，无工程、无残留（workspace 已清理）', async () => {
    let capturedWorkspaceDir = ''
    const { deps } = makeDeps({
      runLearnSession: async ({ workspaceDir }) => {
        capturedWorkspaceDir = workspaceDir
        return { ok: false, error: '模型断了' }
      },
    })
    const learner = createPackLearner(deps)
    const result = await learner.startLearning({ source: { kind: 'novel', projectPath: makeNovelProject(), title: '试书' }, tier: 'skim' })
    expect(result.status).toBe('error')
    expect(await listPackDrafts({ userDataPath: tmp })).toEqual([])
    // F2：会话失败这条路径也必须清掉工作区，不能只在成功路径上验证
    expect(capturedWorkspaceDir).not.toBe('')
    expect(existsSync(capturedWorkspaceDir)).toBe(false)
  })

  test('saving 段中途失败（provenance 落锁前置盘面异常）→ 整体回滚，不留半成品工程目录', async () => {
    // F1：草稿目录在 createPackDraft 之后、updatePackDraft 落 provenance 锁之前被"外力"弄坏
    // （模拟中途盘面异常）——用损坏 draft.json 而非直接删目录，是为了让判别力落在"回滚代码
    // 真的把目录整个删掉了"，而不是被故障注入本身的副作用（删目录）蒙混过关；
    // listPackDrafts 对损坏 JSON 本来就会 fail-soft 跳过，不足以证明目录被回滚清掉。
    let draftDirCaptured = ''
    let calls = 0
    const { deps } = makeDeps({
      userDataPath: () => {
        calls++
        if (calls === 2) {
          const [draftId] = readdirSync(packDraftsDir(tmp))
          draftDirCaptured = join(packDraftsDir(tmp), draftId)
          writeFileSync(join(draftDirCaptured, 'draft.json'), '{not valid json', 'utf8')
        }
        return tmp
      },
    })
    const learner = createPackLearner(deps)
    const result = await learner.startLearning({ source: { kind: 'novel', projectPath: makeNovelProject(), title: '试书' }, tier: 'skim' })
    expect(result.status).toBe('error')
    expect(draftDirCaptured).not.toBe('')
    expect(existsSync(draftDirCaptured)).toBe(false)
    expect(await listPackDrafts({ userDataPath: tmp })).toEqual([])
  })

  test('busy 守卫：跑动中再来一发直接拒', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const { deps } = makeDeps({
      runLearnSession: async ({ workspaceDir }) => {
        await gate
        await writeFile(join(workspaceDir, 'output', 'cards.json'), JSON.stringify(CLEAN_CARDS), 'utf8')
        return { ok: true }
      },
    })
    const learner = createPackLearner(deps)
    const first = learner.startLearning({ source: { kind: 'novel', projectPath: makeNovelProject(), title: '试书' }, tier: 'skim' })
    const second = await learner.startLearning({ source: { kind: 'novel', projectPath: makeNovelProject(), title: '试书' }, tier: 'skim' })
    expect(second.status).toBe('error')
    release()
    expect((await first).status).toBe('ok')
  })

  test('cancel → cancelled，无工程落盘', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const { deps } = makeDeps({
      runLearnSession: async ({ signal }) => {
        await gate
        return signal.aborted ? { ok: false, error: 'aborted' } : { ok: true }
      },
    })
    const learner = createPackLearner(deps)
    const pending = learner.startLearning({ source: { kind: 'novel', projectPath: makeNovelProject(), title: '试书' }, tier: 'skim' })
    learner.cancel()
    release()
    const result = await pending
    expect(result.status).toBe('cancelled')
    expect(await listPackDrafts({ userDataPath: tmp })).toEqual([])
  })

  test('P2-5：saving/编译阶段点停止——compileCard 阻塞期间 cancel → cancelled，回滚已建工程', async () => {
    // 外审实证场景：createPackDraft 已落盘 + compileCard 正在跑（阻塞在假件 gate 上）时用户点「停止」，
    // 修复前会无视 signal 继续跑完、最终仍 emit done 返回一个用户明确不要的草稿。
    let releaseCompile: () => void = () => {}
    const compileGate = new Promise<void>((resolve) => { releaseCompile = resolve })
    let compileEntered: () => void = () => {}
    const compileEnteredPromise = new Promise<void>((resolve) => { compileEntered = resolve })
    const { deps, events } = makeDeps({
      compileCard: async () => {
        compileEntered()
        await compileGate
        return { status: 'ok' }
      },
    })
    const learner = createPackLearner(deps)
    const pending = learner.startLearning({ source: { kind: 'novel', projectPath: makeNovelProject(), title: '试书' }, tier: 'skim' })
    await compileEnteredPromise
    learner.cancel()
    releaseCompile()
    const result = await pending
    expect(result.status).toBe('cancelled')
    expect(await listPackDrafts({ userDataPath: tmp })).toEqual([])
    expect(events.filter((e) => e.phase === 'done')).toEqual([])
    expect(events.filter((e) => e.phase === 'cancelled').length).toBe(1)
  })

  test('F3：evidence 段落逐字引用原文不算抄袭——只扫 runtime 正文，摘录区豁免', async () => {
    const withEvidenceQuote = {
      cards: [
        {
          type: 'craft',
          name: '摘录佐证',
          one_line: '证据在摘录区',
          body: `[runtime]\n机制名：留白收尾\n注解：情绪顶点前一拍停笔，不多写。\n\n[evidence]\n${SOURCE_TEXT}`,
          intent: '高潮章用',
        },
      ],
      proper_nouns: [],
    }
    const { deps } = makeDeps({
      runLearnSession: async ({ workspaceDir }) => {
        await writeFile(join(workspaceDir, 'output', 'cards.json'), JSON.stringify(withEvidenceQuote), 'utf8')
        return { ok: true }
      },
    })
    const learner = createPackLearner(deps)
    const result = await learner.startLearning({ source: { kind: 'novel', projectPath: makeNovelProject(), title: '试书' }, tier: 'skim' })
    if (result.status !== 'ok') throw new Error(JSON.stringify(result))
    expect(result.report.cardsDropped).toBe(0)
    const draft = await getPackDraft({ userDataPath: tmp, draftId: result.draftId })
    expect(draft?.cards[0].body).toContain(SOURCE_TEXT)
  })

  test('F4：混合——一张干净卡 + 一张贴原文卡（重写失败）→ 部分保留，report 三字段吻合', async () => {
    const mixed = {
      cards: [
        { type: 'craft', name: '留白收尾', one_line: '顶点前停笔', body: '[runtime]\n机制名：留白收尾\n注解：情绪顶点前一拍停笔。\n\n[evidence]\n摘录', intent: '高潮章用' },
        { type: 'craft', name: '抄', one_line: '抄', body: `[runtime]\n${SOURCE_TEXT}\n\n[evidence]\n无`, intent: '无' },
      ],
      proper_nouns: [],
    }
    const { deps } = makeDeps({
      runLearnSession: async ({ workspaceDir }) => {
        await writeFile(join(workspaceDir, 'output', 'cards.json'), JSON.stringify(mixed), 'utf8')
        return { ok: true }
      },
    })
    const learner = createPackLearner(deps)
    const result = await learner.startLearning({ source: { kind: 'novel', projectPath: makeNovelProject(), title: '试书' }, tier: 'skim' })
    if (result.status !== 'ok') throw new Error(JSON.stringify(result))
    expect(result.report).toEqual({ cardsKept: 1, cardsDropped: 1, chaptersSampled: 3 })
  })
})

describe('buildLearnPrompt', () => {
  test('内联命令与方法论，声明档位与书名', () => {
    const p = buildLearnPrompt({ commandSource: 'CMD正文', methodologySource: 'METH正文', tier: 'deep', sourceTitle: '试书' })
    expect(p).toContain('CMD正文')
    expect(p).toContain('METH正文')
    expect(p).toContain('精读')
    expect(p).toContain('试书')
  })
})
