/**
 * 学习编排（刀4核心）：会话 → 防抄袭扫描门 → 重写重试 → 原子落草稿工程 → 编译容忍。
 *
 * 原子出现纪律：草稿工程只在扫描门之后创建（createPackDraft）——任何 error/cancelled 路径
 * 之前都不落盘，`listPackDrafts` 在失败/中止分支必须看不到半成品工程。
 *
 * 终态 emit 纪律：done/error/cancelled 三种终态各 emit 恰好一次，且都在 `startLearning`
 * 内部的 return 点前完成——`cancel()` 本身不 emit（只 abort 信号），否则会和
 * `startLearning` 侦测到 aborted 后自己 emit 的 cancelled 事件重复触发两次。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createPackDraft, deletePackDraft, updatePackDraft, packDraftsDir } from './pack-drafts'
import { loadNovelChapters, loadExternalBook, assembleLearnWorkspace } from './pack-learn-workspace'
import { parseLearnOutput } from './pack-learn-output'
import { buildSourceFingerprint, buildWindowIndex, scanTextReuse, type TextReuseFinding } from './text-reuse-scan'
import { extractNonEvidenceText } from '@shared/lib/pack-card-sections'
import type { DraftCard, PackLearnEvent, PackLearnResult, PackLearnSource, PackLearnTier } from '@shared/types/capability-pack'

export const SOURCE_FINGERPRINT_FILENAME = 'source-fingerprint.json'
const MAX_REWRITES = 2
const TIER_LABEL: Record<PackLearnTier, string> = { skim: '选读', deep: '精读' }

export interface PackLearnerDeps {
  userDataPath: () => string
  runLearnSession: (input: { prompt: string; workspaceDir: string; signal: AbortSignal }) => Promise<{ ok: true } | { ok: false; error: string }>
  rewriteCardBody: (input: { body: string; findings: TextReuseFinding[] }) => Promise<string | null>
  compileCard: (input: { userDataPath: string; draftId: string; cardId: string }) => Promise<unknown> // 结果容忍失败（无 sidecar 卡由刀3 发布规则兜底）
  readCommandSource: () => Promise<string> // learn-craft.md 全文
  readMethodologySource: () => Promise<string> // text-decomposition-methodology.md 全文
  emit: (event: PackLearnEvent) => void
  now?: () => string
}

export function buildLearnPrompt(input: { commandSource: string; methodologySource: string; tier: PackLearnTier; sourceTitle: string }): string {
  return [
    `你正在执行 NarraCat「从书学写法」学习任务：/narracat:learn-craft`,
    `本次档位：${TIER_LABEL[input.tier]}（${input.tier}）；源书：《${input.sourceTitle}》。`,
    '',
    '<command>',
    input.commandSource,
    '</command>',
    '',
    '<methodology>（去文本化纪律全文，必须遵守）',
    input.methodologySource,
    '</methodology>',
  ].join('\n')
}

export function createPackLearner(deps: PackLearnerDeps) {
  let busy = false
  let abortController: AbortController | null = null

  function emitError(message: string): PackLearnResult {
    deps.emit({ phase: 'error', message })
    return { status: 'error', message }
  }

  function emitCancelled(): PackLearnResult {
    deps.emit({ phase: 'cancelled', message: '已停止这次学习。' })
    return { status: 'cancelled' }
  }

  async function startLearning(input: { source: PackLearnSource; tier: PackLearnTier }): Promise<PackLearnResult> {
    // busy 守卫：拒绝发生在任何生命周期开始之前，同步返回、不 emit——
    // 「done/error/cancelled 三种终态各恰好 emit 一次」这条不变量只约束「已开跑」的一次学习，
    // 这里调用方连跑都没跑起来，是该不变量的显式例外（F5）。
    if (busy) return { status: 'error', message: '已有一本书在学，请先等它完成。' }
    busy = true
    abortController = new AbortController()
    const signal = abortController.signal
    let workspaceDir: string | null = null
    try {
      deps.emit({ phase: 'preparing', message: '正在整理书源……' })
      const source = input.source.kind === 'novel'
        ? await loadNovelChapters(input.source.projectPath, input.source.title)
        : await loadExternalBook(input.source.filePath)
      workspaceDir = await mkdtemp(join(tmpdir(), 'narracat-learn-'))
      const { sampledIndices, fullText, sampledText } = await assembleLearnWorkspace({ workspaceDir, source, tier: input.tier })
      if (signal.aborted) return emitCancelled()

      deps.emit({ phase: 'reading', message: `正在读书学写法（抽样 ${sampledIndices.length} 章）……` })
      const prompt = buildLearnPrompt({
        commandSource: await deps.readCommandSource(),
        methodologySource: await deps.readMethodologySource(),
        tier: input.tier,
        sourceTitle: source.title,
      })
      const session = await deps.runLearnSession({ prompt, workspaceDir, signal })
      if (signal.aborted) return emitCancelled()
      if (!session.ok) return emitError(`这次学习没跑完：${session.error}`)

      let raw: string
      try {
        raw = await readFile(join(workspaceDir, 'output', 'cards.json'), 'utf8')
      } catch {
        return emitError('这次学习没有产出结果，请重试。')
      }
      const parsed = parseLearnOutput(raw)
      if (!parsed.ok) return emitError(parsed.reason)

      deps.emit({ phase: 'scanning', message: '正在做防抄袭检查……' })
      const now = deps.now ?? (() => new Date().toISOString())
      const fingerprint = buildSourceFingerprint({
        fullText,
        properNouns: parsed.output.properNouns,
        sourceKind: source.sourceKind,
        sourceTitle: source.title,
        now,
      })
      // 精确窗口 Set 只对抽样文本建（模型只见过抽样章，学习期抄袭只可能来自抽样输入）；
      // fingerprint.windowBloom（由 buildSourceFingerprint 用 fullText 构建）覆盖全书层，
      // 位集常驻内存不撑爆主进程（PR#477 外审 P2-6，见 text-reuse-scan.ts / pack-learn-workspace.ts）。
      const windowIndex = buildWindowIndex(sampledText)
      const kept: DraftCard[] = []
      let droppedCount = 0
      for (const card of parsed.output.cards) {
        if (signal.aborted) break
        let body = card.body
        let findings: TextReuseFinding[] = scanTextReuse(extractNonEvidenceText(body), { fingerprint, windowIndex })
        let attempts = 0
        while (findings.length > 0 && attempts < MAX_REWRITES) {
          const rewritten = await deps.rewriteCardBody({ body, findings })
          if (rewritten === null) break
          body = rewritten
          findings = scanTextReuse(extractNonEvidenceText(body), { fingerprint, windowIndex })
          attempts++
        }
        if (findings.length > 0) {
          droppedCount++
          continue
        }
        kept.push({ cardId: randomUUID(), type: card.type, name: card.name, oneLine: card.oneLine, body, intent: card.intent, compiled: null })
      }
      if (signal.aborted) return emitCancelled()
      if (kept.length === 0) {
        return emitError('学出来的卡都太贴原文，已全部放弃。换精读档或换一本书试试。')
      }

      deps.emit({ phase: 'saving', message: '正在落成草稿工程……' })
      const meta = await createPackDraft({
        userDataPath: deps.userDataPath(),
        name: `《${source.title}》·写法`,
        seed: { cards: kept, readme: `# 《${source.title}》·写法\n\n从《${source.title}》学到的写法（作者自用；${TIER_LABEL[input.tier]}档）。` },
      })
      // saving 段原子性（F1）：createPackDraft 落盘之后，草稿工程已经"存在"，但 meta.localSource
      // 还没写——PackDraftMeta 的约定是缺省视同 'created'（可导出）。updatePackDraft/指纹写入/
      // 编译循环任一步中途失败，若不整体回滚，就会残留一个"看起来是 created、实际是
      // learned-external"的半成品工程——合规泄漏（外部作品学得的内容被误判为可导出分享）。
      // 所以这一段包一层 try/catch：失败即 deletePackDraft 把整个工程连根拔掉，再走 error 终态。
      try {
        await updatePackDraft({
          userDataPath: deps.userDataPath(),
          draftId: meta.draftId,
          patch: {
            meta: {
              localSource: source.sourceKind === 'novel' ? 'learned-own' : 'learned-external',
              learnedFrom: { sourceKind: source.sourceKind, title: source.title },
            },
          },
        })
        await writeFile(join(packDraftsDir(deps.userDataPath()), meta.draftId, SOURCE_FINGERPRINT_FILENAME), JSON.stringify(fingerprint, null, 2), 'utf8')
        for (const card of kept) {
          // 编译循环逐卡查 abort（P2-5）：点了「停止」之后还没轮到的卡直接不编译，
          // 省掉无意义的编译调用；已经在跑的那一次 compileCard 不强行打断（见下方大注释）。
          if (signal.aborted) break
          try {
            await deps.compileCard({ userDataPath: deps.userDataPath(), draftId: meta.draftId, cardId: card.cardId })
          } catch {
            // 单卡编译失败容忍：无 sidecar 编译产物的卡由刀3 发布规则兜底，学习流程不因此中断
            // （这层容忍与外层回滚是两回事——编译失败不触发整体回滚，只有 provenance 锁/指纹这类
            // "工程完整性"层面的失败才触发）
          }
        }
      } catch (error) {
        await deletePackDraft({ userDataPath: deps.userDataPath(), draftId: meta.draftId }).catch(() => {})
        const message = error instanceof Error ? error.message : '落草稿工程时出了问题，请重试。'
        return emitError(message)
      }
      // saving/编译阶段响应取消（PR#477 P2-5）：用户点「停止」= 明确不要这次产物，宁可扔掉
      // 已经落盘/编译完成的部分，也不留一个「不想要的草稿」——即便 createPackDraft 已经建好
      // 工程、provenance 锁已写、部分卡已编译，只要此刻 signal 已 aborted 就整体回滚
      // （deletePackDraft）并走 cancelled 终态，不 emit done。
      // rewriteCardBody/compileCard 单次「正在进行中」的 LLM 调用本身不强行打断——打断需要
      // 额外的可取消 fetch 管线，而这一步是秒级延迟，UI 的「正在停止…」态已经诚实反馈给用户，
      // 等它跑完这一次调用是可接受的代价；真正不可接受的是「跑完后仍把结果当成功交付」。
      if (signal.aborted) {
        await deletePackDraft({ userDataPath: deps.userDataPath(), draftId: meta.draftId }).catch(() => {})
        return emitCancelled()
      }
      const report = { cardsKept: kept.length, cardsDropped: droppedCount + parsed.output.droppedCount, chaptersSampled: sampledIndices.length }
      deps.emit({ phase: 'done', message: `学完了：留下 ${kept.length} 张卡${droppedCount ? `，放弃 ${droppedCount} 张` : ''}。`, draftId: meta.draftId })
      return { status: 'ok', draftId: meta.draftId, report }
    } catch (error) {
      const message = error instanceof Error ? error.message : '学习过程出了问题，请重试。'
      return emitError(message)
    } finally {
      if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true }).catch(() => {})
      busy = false
      abortController = null
    }
  }

  return {
    startLearning,
    cancel: () => { abortController?.abort() },
    isBusy: () => busy,
  }
}
