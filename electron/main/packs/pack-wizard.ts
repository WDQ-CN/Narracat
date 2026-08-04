/**
 * 作家向导编排（刀5核心）：多轮访谈会话 → 每轮确定性探测 output/cards.json → 纠错一轮 →
 * 原子落草稿工程（provenance=created）→ 编译容忍 → done。
 *
 * 与刀4 pack-learn 的三条同族纪律：
 * - 原子出现：草稿工程只在解析成功后创建，saving 段任何失败/取消整体回滚（deletePackDraft），
 *   error/cancelled 路径零半成品残留。
 * - 终态单发：done/error/cancelled 各 emit 恰好一次。cancelled 只在 cancel() 里 emit（会话可能
 *   正停在 awaiting_user、没有任何在跑的 promise 可以侦测 abort），迟到的 runTurn 结果一律以
 *   finished 标记拦下，不复活已终态会话。
 * - 工作区清理：所有终态路径统一经 finish* 清理临时工作区。
 *
 * 生命周期：一个实例 = 一次访谈会话。终态后 start/send 一律拒绝——「再来一次」由装配方
 * （ipc.ts getPackWizard）检测 isFinished() 后重建实例（工厂便宜，见 T4）。
 * busy 与 pack-learn 的 busy 各自独立，互不影响。
 */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createPackDraft, deletePackDraft, getPackDraft } from './pack-drafts'
import { parseLearnOutput, type LearnOutput } from './pack-learn-output'
import type { PreviewCardResult } from './pack-preview'
import { EVIDENCE_SECTION_RE } from '@shared/lib/pack-card-sections'
import {
  WIZARD_INPUT_MAX_CHARS,
  WIZARD_INPUT_TOO_LONG_MESSAGE,
  type DraftCard,
  type PackWizardAck,
  type PackWizardCardSummary,
  type PackWizardEvent,
  type PackWizardEventBody,
  type PackWizardMessage,
  type PackWizardPhase,
  type PackWizardSnapshot,
} from '@shared/types/capability-pack'

/** cards.json 里没起包名时的兜底工程名。 */
export const DEFAULT_WIZARD_PACK_NAME = '作家向导草稿'

export interface WizardTurnInput {
  workspaceDir: string
  /** 首轮 null；此后带上首轮捕获的 sessionId 续同一会话上下文。 */
  resumeSessionId: string | null
  prompt: string
  signal: AbortSignal
  /** 消息级 assistant 文本回调（v1 非 token 流），编排层负责转成 assistant 事件。 */
  onAssistantText: (text: string) => void
}

/**
 * 会话执行三态契约（T1 spike 实测回写）：`truncated` = 当轮被 maxTurns 截断（error_max_turns），
 * 不是死刑——同 sessionId 可续、上下文完好，状态机映射回 awaiting_user 让作者继续说话；
 * 截断发生在当轮工具执行之后，cards.json 确定性探测天然兜住截断轮（照常 probe）。
 */
export type WizardTurnResult =
  | { outcome: 'success' | 'truncated'; sessionId?: string }
  | { outcome: 'error'; error: string }

export interface PackWizardDeps {
  userDataPath: () => string
  /** 会话执行（T4 真实现：SDK query + options.resume；本模块只管编排）。 */
  runTurn: (input: WizardTurnInput) => Promise<WizardTurnResult>
  /** 必须传会自身落盘 sidecar 的真实例（getPackCompiler().compileCard，刀4 T11 教训）；结果容忍失败。 */
  compileCard: (input: { userDataPath: string; draftId: string; cardId: string }) => Promise<unknown>
  /**
   * 代表性预览（刀3 previewDraftCard 可编程面，生产接线补 paths）：craft 跑典型情境竞争、persona
   * 跑典型画像声音匹配。结果只进 done 摘要的 previewHits，异常容忍（null），不阻断访谈收尾。
   */
  previewCard: (input: { userDataPath: string; draftId: string; cardId: string }) => Promise<PreviewCardResult>
  /** writer-wizard.md 命令全文（App 直读引擎资产，learn-craft 同款消费方式）。 */
  readWizardPrompt: () => Promise<string>
  emit: (event: PackWizardEvent) => void
}

export function buildWizardOpeningPrompt(commandSource: string): string {
  return [
    '你正在执行 NarraCat「作家向导」访谈任务：/narracat:writer-wizard',
    '',
    '<command>',
    commandSource,
    '</command>',
    '',
    '开始访谈。',
  ].join('\n')
}

/**
 * T3 评审 Minor-1：parseLearnOutput 的 reason 是学习会话口径（「学习结果…」），会经纠错 prompt 与
 * error 终态透出到向导语境；这里在向导侧把主语映射成访谈口径，learn 侧文案原样不动、零回归。
 */
function toWizardReason(reason: string): string {
  return reason.replace(/^学习结果/, '访谈产出')
}

function buildCorrectionPrompt(reason: string): string {
  return [
    '你写入 output/cards.json 的内容没有通过校验：',
    reason,
    '',
    '请严格按输出契约重写 output/cards.json：合法 JSON、不加注释、每张卡 type/name/one_line/body/intent 齐全，',
    'structure 卡的 intent 只能是 stage-opening / stage-1 / stage-2 之一。',
    `每张卡 body 必须含非空 [evidence] 摘录段，且至少一条摘录标注「${WIZARD_EVIDENCE_MARK}」；craft 卡 body 必须含 [runtime] 机制段。`,
    `name 不超过 ${WIZARD_CARD_NAME_MAX_CHARS} 字、one_line 不超过 ${WIZARD_CARD_ONE_LINE_MAX_CHARS} 字、顶层 pack_name 不超过 ${WIZARD_PACK_NAME_MAX_CHARS} 字。`,
    '只重写这一个文件，不要写其他文件。',
  ].join('\n')
}

// ---- 向导产物契约校验（PR#478 外审 P2：形式残缺卡不当成功产物，违规喂进既有纠错一轮）----
// 规则镜像 commands/writer-wizard.md 的输出契约（长度上限/摘录标注/[runtime] 段都是命令原文要求）。
// 只在向导侧做：learn 的 evidence 标注是章节序号不是「来自访谈」，共享的 parseLearnOutput 不动。

export const WIZARD_CARD_NAME_MAX_CHARS = 12
export const WIZARD_CARD_ONE_LINE_MAX_CHARS = 40
export const WIZARD_PACK_NAME_MAX_CHARS = 12
export const WIZARD_EVIDENCE_MARK = '来自访谈'

export interface WizardCardsValidation {
  /** 违规明细（人话，逐条进纠错 prompt / error 文案）。空数组 = 全部通过。 */
  violations: string[]
  /** 违规卡在 cards 里的下标（纠错后仍违规时按此丢弃）；pack_name 违规不指向卡，不在此列。 */
  invalidCardIndexes: Set<number>
  /** 顶层 pack_name 超长：不丢卡，纠错后仍超长则回退兜底包名。 */
  packNameInvalid: boolean
}

/** 卡正文里非空 [evidence] 段内容（matchAll 不动共享正则的 lastIndex，勿换成 .test/.exec）。 */
function evidenceSections(body: string): string[] {
  return [...body.matchAll(EVIDENCE_SECTION_RE)].map((m) => m[1].trim()).filter((s) => s.length > 0)
}

export function validateWizardCards(output: LearnOutput): WizardCardsValidation {
  const violations: string[] = []
  const invalidCardIndexes = new Set<number>()
  let packNameInvalid = false

  if (output.packName && output.packName.length > WIZARD_PACK_NAME_MAX_CHARS) {
    packNameInvalid = true
    violations.push(`包名「${output.packName}」超过 ${WIZARD_PACK_NAME_MAX_CHARS} 字`)
  }

  output.cards.forEach((card, index) => {
    const problems: string[] = []
    const sections = evidenceSections(card.body)
    if (sections.length === 0) {
      problems.push('缺少非空 [evidence] 摘录段')
    } else if (!sections.some((s) => s.includes(WIZARD_EVIDENCE_MARK))) {
      problems.push(`摘录没有「${WIZARD_EVIDENCE_MARK}」标注`)
    }
    if (card.type === 'craft' && !card.body.includes('[runtime]')) {
      problems.push('craft 卡缺少 [runtime] 机制段')
    }
    if (card.name.length > WIZARD_CARD_NAME_MAX_CHARS) {
      problems.push(`卡名超过 ${WIZARD_CARD_NAME_MAX_CHARS} 字`)
    }
    if (card.oneLine.length > WIZARD_CARD_ONE_LINE_MAX_CHARS) {
      problems.push(`一句话说明超过 ${WIZARD_CARD_ONE_LINE_MAX_CHARS} 字`)
    }
    if (problems.length > 0) {
      invalidCardIndexes.add(index)
      violations.push(`第 ${index + 1} 张卡「${card.name}」：${problems.join('；')}`)
    }
  })

  return { violations, invalidCardIndexes, packNameInvalid }
}

/** 违规明细拼成纠错/终态可用的单串原因（与 JSON 非法同走 buildCorrectionPrompt 一条通道）。 */
function formatWizardViolations(validation: WizardCardsValidation): string {
  return ['访谈产出的卡格式不完整：', ...validation.violations].join('\n')
}

/** 「聊不出东西」的明示形态：合法 JSON 且 cards 为空数组（与解析非法要区分——空卡走 done(null)，非法走纠错）。 */
function isEmptyCardsOutput(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { cards?: unknown } | null
    return typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.cards) && parsed.cards.length === 0
  } catch {
    return false
  }
}

export function createPackWizard(deps: PackWizardDeps) {
  let started = false
  let finished = false
  let awaitingUser = false
  let turnInFlight = false
  let correctionUsed = false
  let sessionId: string | null = null
  let workspaceDir: string | null = null
  let abortController: AbortController | null = null

  // 会话可恢复三件套（页面重载后主进程是单一真相源）：seq 序号、对话 transcript、最新状态。
  // user 消息在 send() 受理时记账，assistant 消息与 phase/终态载荷都在 emitEvent 单出口记账——
  // 事件流与快照永远同步，重载后按快照重建的现场不缺帧。
  // transcript 不设上限是有意的（截断会破坏「快照=完整现场」契约）：量级有界——user 单条
  // ≤ WIZARD_INPUT_MAX_CHARS（send 咽喉已守）、访谈是分钟级两位数轮次、单实例单会话，现实
  // < 1MB；实例随 dismiss/「再来一次」重建即整体释放，不是泄漏。
  let seq = 0
  let currentPhase: PackWizardPhase = 'preparing'
  let doneDraftId: string | null = null
  let doneCardCount: number | null = null
  let doneCards: PackWizardCardSummary[] | null = null
  let doneDroppedCount: number | null = null
  let errorMessage: string | null = null
  const transcript: PackWizardMessage[] = []

  /** 事件唯一出口：盖章 seq（实例内从 1 单调递增）+ 同步快照素材，所有 emit 必须走这里。 */
  function emitEvent(body: PackWizardEventBody): void {
    seq += 1
    switch (body.kind) {
      case 'phase':
        currentPhase = body.phase
        break
      case 'assistant':
        transcript.push({ role: 'assistant', text: body.text })
        break
      case 'done':
        currentPhase = 'done'
        doneDraftId = body.draftId
        doneCardCount = body.cardCount
        doneCards = body.cards ?? null
        doneDroppedCount = body.droppedCount ?? null
        break
      case 'error':
        currentPhase = 'error'
        errorMessage = body.message
        break
      case 'cancelled':
        currentPhase = 'cancelled'
        break
    }
    deps.emit({ ...body, seq })
  }

  function emitPhase(phase: PackWizardPhase): void {
    if (finished) return
    emitEvent({ kind: 'phase', phase })
  }

  /**
   * 会话快照（重载恢复用）：未开始返回 null（没有现场可恢复）；进行中与终态都返回——
   * 终态快照让重载后仍能回到「查看草稿/再来一次」的终态页而不是死循环。
   */
  function snapshot(): PackWizardSnapshot | null {
    if (!started) return null
    return {
      phase: currentPhase,
      messages: [...transcript],
      draftId: doneDraftId,
      cardCount: doneCardCount,
      errorMessage,
      lastSeq: seq,
      cards: doneCards,
      droppedCount: doneDroppedCount,
    }
  }

  async function cleanupWorkspace(): Promise<void> {
    if (!workspaceDir) return
    await rm(workspaceDir, { recursive: true, force: true }).catch(() => {})
  }

  async function finishDone(
    draftId: string | null,
    cardCount: number,
    extras?: { cards: PackWizardCardSummary[]; droppedCount: number },
  ): Promise<void> {
    if (finished) return
    finished = true
    emitEvent({ kind: 'done', draftId, cardCount, ...(extras ?? {}) })
    await cleanupWorkspace()
  }

  async function finishError(message: string): Promise<void> {
    if (finished) return
    finished = true
    emitEvent({ kind: 'error', message })
    await cleanupWorkspace()
  }

  /** 每轮 result 后确定性探测 output/cards.json（不靠模型宣称完成）；不存在返回 null。 */
  async function probeCardsFile(): Promise<string | null> {
    if (!workspaceDir) return null
    try {
      return await readFile(join(workspaceDir, 'output', 'cards.json'), 'utf8')
    } catch {
      return null
    }
  }

  async function runTurnAndSettle(prompt: string, isCorrection: boolean): Promise<void> {
    if (finished || !workspaceDir || !abortController) return
    turnInFlight = true
    awaitingUser = false
    try {
      emitPhase('thinking')
      const result = await deps.runTurn({
        workspaceDir,
        resumeSessionId: sessionId,
        prompt,
        signal: abortController.signal,
        onAssistantText: (text) => {
          if (!finished) emitEvent({ kind: 'assistant', text })
        },
      })
      // 迟到结果不复活：cancel() 已把会话推入终态时，这次 runTurn 的一切结果直接丢弃
      if (finished) return
      if (result.outcome === 'error') {
        await finishError(`这轮对话没跑完：${result.error}`)
        return
      }
      // success 与 truncated 同路：捕获可续 sessionId → 确定性探测（截断轮也可能已产出 cards.json）
      if (result.sessionId) sessionId = result.sessionId
      const raw = await probeCardsFile()
      if (raw === null) {
        if (isCorrection) {
          // 纠错轮连文件都没了（模型删了或没重写）——按「仍败」处理，不回 awaiting_user 装没事
          await finishError('这次访谈的产出没有通过校验，重试一次也没成功。请重新进向导再来一次。')
          return
        }
        awaitingUser = true
        emitPhase('awaiting_user')
        return
      }
      await settleCards(raw)
    } catch (error) {
      if (!finished) {
        await finishError(error instanceof Error ? error.message : '访谈过程出了问题，请重试。')
      }
    } finally {
      turnInFlight = false
    }
  }

  async function settleCards(raw: string): Promise<void> {
    emitPhase('saving')
    if (isEmptyCardsOutput(raw)) {
      // 明示没聊出可炼的写法：不落工程，原因已由 assistant 文本呈现
      await finishDone(null, 0)
      return
    }
    const parsed = parseLearnOutput(raw)
    if (!parsed.ok) {
      if (correctionUsed) {
        await finishError(`这次访谈的产出没有通过校验（${toWizardReason(parsed.reason)}），重试一次也没成功。请重新进向导再来一次。`)
        return
      }
      correctionUsed = true
      await runTurnAndSettle(buildCorrectionPrompt(toWizardReason(parsed.reason)), true)
      return
    }
    // 契约校验与 JSON 非法同走一条纠错通道（correctionUsed 共享一次名额）：一次纠错覆盖两类问题。
    const validation = validateWizardCards(parsed.output)
    let keptCards = parsed.output.cards
    let validationDropped = 0
    if (validation.violations.length > 0) {
      if (!correctionUsed) {
        correctionUsed = true
        await runTurnAndSettle(buildCorrectionPrompt(formatWizardViolations(validation)), true)
        return
      }
      // 纠错后仍违规：违规卡丢弃计数，完成页如实交代；全丢 = 这次访谈没有可交付产物
      keptCards = parsed.output.cards.filter((_, index) => !validation.invalidCardIndexes.has(index))
      validationDropped = parsed.output.cards.length - keptCards.length
      if (keptCards.length === 0) {
        await finishError('这次访谈的产出没有通过校验（卡的格式都不完整），重试一次也没成功。请重新进向导再来一次。')
        return
      }
    }
    // parseLearnOutput 层的 fail-soft 丢弃（缺字段/非法 type）与契约校验丢弃合并如实上报
    const droppedCount = parsed.output.droppedCount + validationDropped
    const packName =
      validation.packNameInvalid || !parsed.output.packName ? DEFAULT_WIZARD_PACK_NAME : parsed.output.packName
    const cards: DraftCard[] = keptCards.map((card) => ({
      cardId: randomUUID(),
      type: card.type,
      name: card.name,
      oneLine: card.oneLine,
      body: card.body,
      intent: card.intent,
      compiled: null,
    }))
    // 卡级摘要（诚实完成页）：编译/预览结果逐卡记账，随 done 事件下发
    const summaries: PackWizardCardSummary[] = cards.map((card) => ({
      name: card.name,
      type: card.type,
      compiled: false,
      previewHits: null,
    }))
    // saving 段原子性（刀4 F1 同族）：createPackDraft 之后任何失败都整体回滚 deletePackDraft，
    // 不留半成品工程。provenance=created 是 PackDraftMeta 缺省语义——不写 localSource、
    // 无 learnedFrom、无指纹文件（作者自述内容，非从书学得）。
    let meta: Awaited<ReturnType<typeof createPackDraft>> | null = null
    try {
      meta = await createPackDraft({
        userDataPath: deps.userDataPath(),
        name: packName,
        seed: { cards, readme: `# ${packName}\n\n和作家向导聊出来的写法（作者自用）。` },
      })
      for (const [index, card] of cards.entries()) {
        // 逐卡查终态/abort（刀4 P2-5）：点了「停止」后还没轮到的卡不再编译
        if (finished || abortController?.signal.aborted) break
        try {
          const result = await deps.compileCard({ userDataPath: deps.userDataPath(), draftId: meta.draftId, cardId: card.cardId })
          summaries[index].compiled = (result as { status?: unknown } | null)?.status === 'ok'
        } catch {
          // 单卡编译失败容忍：无 sidecar 编译产物的卡由刀3 发布规则兜底，访谈流程不因此中断
        }
      }
      // 代表性预览（PR#478 外审 P1 下半：向导不跑预览就盲报成功）：craft/persona 编译成功的卡
      // 各跑一次刀3 预览机（典型情境竞争/典型画像声音匹配），命中数进 done 摘要；structure 卡
      // 整批装载语义跳过。预览异常容忍——previewHits 保持 null，不阻断 done。
      for (const [index, card] of cards.entries()) {
        if (finished || abortController?.signal.aborted) break
        if (card.type === 'structure' || !summaries[index].compiled) continue
        try {
          const preview = await deps.previewCard({ userDataPath: deps.userDataPath(), draftId: meta.draftId, cardId: card.cardId })
          if (preview.status === 'ok' && preview.kind !== 'structure') {
            summaries[index].previewHits = preview.results.filter((entry) => entry.selected).length
          }
        } catch {
          // 预览失败容忍：previewHits=null（「没测出来」），完成页不据此下警示
        }
      }
      // done 前完整性核验：工程读不回来（落盘中途损坏）宁可回滚报错，也不把一个坏 draftId 交给 UI
      const persisted = await getPackDraft({ userDataPath: deps.userDataPath(), draftId: meta.draftId })
      if (!persisted) throw new Error('草稿工程落盘后校验失败，已回滚。请重试。')
    } catch (error) {
      if (meta) await deletePackDraft({ userDataPath: deps.userDataPath(), draftId: meta.draftId }).catch(() => {})
      await finishError(error instanceof Error ? error.message : '落草稿工程时出了问题，请重试。')
      return
    }
    // saving 中途被取消（cancelled 已由 cancel() emit 过）：用户明确不要这次产物，整体回滚、不 emit done
    if (finished || abortController?.signal.aborted) {
      await deletePackDraft({ userDataPath: deps.userDataPath(), draftId: meta.draftId }).catch(() => {})
      return
    }
    await finishDone(meta.draftId, cards.length, { cards: summaries, droppedCount })
  }

  async function start(): Promise<PackWizardAck> {
    if (started) {
      // busy 拒绝必须带出口：渲染端收到这个 ack 不报错，转身取快照恢复现场（提示不如恢复）
      return { ok: false, message: finished ? '这次向导已结束，请重新进入向导。' : '上一场访谈还没结束。' }
    }
    started = true
    abortController = new AbortController()
    try {
      emitPhase('preparing')
      workspaceDir = await mkdtemp(join(tmpdir(), 'narracat-wizard-'))
      await mkdir(join(workspaceDir, 'output'), { recursive: true })
      const commandSource = await deps.readWizardPrompt()
      await runTurnAndSettle(buildWizardOpeningPrompt(commandSource), false)
      return { ok: true }
    } catch (error) {
      if (!finished) {
        await finishError(error instanceof Error ? error.message : '向导没能启动，请重试。')
      }
      return { ok: true }
    }
  }

  async function send(text: string): Promise<PackWizardAck> {
    if (!started) return { ok: false, message: '向导还没开始。' }
    if (finished) return { ok: false, message: '这次向导已结束，请重新进入向导。' }
    if (turnInFlight || !awaitingUser) return { ok: false, message: '向导正忙，等它回复后再发。' }
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, message: '先输入内容再发送。' }
    // 超限拒发不截断（T6 评审 Minor-1）：守在 send 这个 ack 拒收路径的咽喉上（而不是 ipc reader
    // 抛错），拒收原因能经既有 ack 通道回到渲染端；渲染端 WizardComposer 有同值预检，这里兜底。
    if (trimmed.length > WIZARD_INPUT_MAX_CHARS) return { ok: false, message: WIZARD_INPUT_TOO_LONG_MESSAGE }
    // 受理即记账（拒收路径都在上方 return 掉了）：transcript 的 user 消息与渲染端乐观追加同步
    transcript.push({ role: 'user', text: trimmed })
    await runTurnAndSettle(trimmed, false)
    return { ok: true }
  }

  /**
   * 取消：abort + emit cancelled + 清工作区。cancelled 只在这里 emit（终态单发的唯一出口）；
   * 已在跑的 runTurn 结果由 finished 标记拦截，saving 段已建的工程由 settleCards 的终态检查回滚。
   */
  async function cancel(): Promise<void> {
    if (!started || finished) return
    finished = true
    awaitingUser = false
    abortController?.abort()
    emitEvent({ kind: 'cancelled' })
    await cleanupWorkspace()
  }

  return {
    start,
    send,
    cancel,
    snapshot,
    /** 会话进行中（已开始且未到终态）。 */
    isBusy: () => started && !finished,
    /** 已到终态（一个实例一次会话；「再来一次」由装配方重建实例）。 */
    isFinished: () => finished,
  }
}
