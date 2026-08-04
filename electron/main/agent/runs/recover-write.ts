import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentRunRequest } from '../../agent-runner'
import {
  chapterContextPackCandidates,
  chapterManuscriptCandidates,
  chapterOutlineCandidates,
  chapterReviewCandidates,
  chapterStagingPath,
} from '../../novel/novel-layout'
import { loadNovelProjectDetail } from '../../novel/novel-project'
import {
  createInlineNarraCatCommandPrompt,
  readNarraCatCommandFile,
  type ReadNarraCatCommandFile,
} from './narracat-command'

export interface ResolveRecoverWriteRunInput {
  projectPath: string
  selectedChapter?: number
  userPrompt: string
}

export interface ResolveRecoverWriteRunDeps {
  pluginPath: string
  readCommandFile?: ReadNarraCatCommandFile
}

export interface ResolvedRecoverWriteRun {
  projectPath: string
  chapterNumber: number
  volumeNumber: number
  prompt: string
  maxTurns: number
}

interface RecoveryInspection {
  contextPackExists: boolean
  manuscriptExists: boolean
  reviewExists: boolean
  reviewVerdict: string
  recommendedResumeStep: number
}

const RECOVER_WRITE_MAX_TURNS = 72

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function hasAnyFile(paths: string[]): Promise<boolean> {
  for (const path of paths) {
    if (await isFile(path)) return true
  }

  return false
}

async function readFirstExistingFile(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      return await readFile(path, 'utf-8')
    } catch {
      // Try the next accepted NarraCat filename variant.
    }
  }

  return null
}

function toAbsolutePaths(projectPath: string, relativePaths: string[]): string[] {
  return relativePaths.map((relativePath) => join(projectPath, relativePath))
}

function readReviewVerdict(content: string | null): string {
  if (!content) return 'unknown'

  // 审校报告数据契约（ADR-0018）：从结构化 JSON 读 verdict，不再解析人读 markdown
  try {
    const parsed = JSON.parse(content) as { verdict?: unknown }
    if (typeof parsed.verdict === 'string') return parsed.verdict.toUpperCase()
  } catch {
    // 非 JSON（历史 markdown 残留）→ unknown，按需重审
  }
  return 'unknown'
}

function resolveRecommendedResumeStep({
  contextPackExists,
  manuscriptExists,
  reviewExists,
  reviewVerdict,
}: Omit<RecoveryInspection, 'recommendedResumeStep'>): number {
  if (!contextPackExists) return 1
  if (!manuscriptExists) return 3
  if (!reviewExists) return 4
  if (reviewVerdict === 'PASS') return 6
  return 5
}

async function inspectRecoveryArtifacts(
  projectPath: string,
  volumeNumber: number,
  chapterNumber: number,
): Promise<RecoveryInspection> {
  const contextPackExists = await hasAnyFile(
    toAbsolutePaths(projectPath, chapterContextPackCandidates(chapterNumber)),
  )
  // 写作链现把工作正文放 .narracat/staging/ch-NNN.md，promote 时才 rename 进正式路径；
  // 中断时正式路径无文件不等于「无正文」——只认正式路径会让恢复推荐把已完成的热写/打磨
  // 成果误判为「无正文」而推荐回到步骤 3，白丢进度（刀 3 §4.6 控制器裁定）。
  const manuscriptExists = await hasAnyFile(
    toAbsolutePaths(projectPath, [
      ...chapterManuscriptCandidates(volumeNumber, chapterNumber),
      chapterStagingPath(chapterNumber),
    ]),
  )
  const reviewContent = await readFirstExistingFile(
    toAbsolutePaths(projectPath, chapterReviewCandidates(chapterNumber, { includePlainChapterFile: true })),
  )
  const reviewExists = reviewContent !== null
  const reviewVerdict = readReviewVerdict(reviewContent)

  return {
    contextPackExists,
    manuscriptExists,
    reviewExists,
    reviewVerdict,
    recommendedResumeStep: resolveRecommendedResumeStep({
      contextPackExists,
      manuscriptExists,
      reviewExists,
      reviewVerdict,
    }),
  }
}

function createRecoveryDiagnosis({
  chapterNumber,
  inspection,
  lastCommand,
  lastStep,
  userPrompt,
  volumeNumber,
}: {
  chapterNumber: number
  volumeNumber: number
  lastCommand: string | null | undefined
  lastStep: number | null | undefined
  userPrompt: string
  inspection: RecoveryInspection
}): string {
  return [
    '恢复诊断：',
    'recovery_mode: write',
    'command: write',
    `chapter_num: ${chapterNumber}`,
    `volume_num: ${volumeNumber}`,
    `checkpoint_last_command: ${lastCommand ?? 'unknown'}`,
    `checkpoint_last_step: ${lastStep ?? 'unknown'}`,
    `context_pack_exists: ${inspection.contextPackExists}`,
    `manuscript_exists: ${inspection.manuscriptExists}`,
    `review_exists: ${inspection.reviewExists}`,
    `review_verdict: ${inspection.reviewVerdict}`,
    'memory_summary_status: unknown',
    'completed_in_state: false',
    `in_progress_chapter: ${chapterNumber}`,
    `recommended_resume_step: ${inspection.recommendedResumeStep}`,
    ...(userPrompt.trim() ? [`desktop_user_intent: ${userPrompt.trim()}`] : []),
    '',
    '恢复执行要求：继续执行 /narracat:write 的标准流程；不要跳过未确认的标准步骤。',
    '如果已有正文、审修报告或上下文包，请先读取实际存在的文件，再从推荐步骤恢复并补齐后续 state、review 与 memory 更新。',
  ].join('\n')
}

export function isRecoverWriteRequest(request: AgentRunRequest): boolean {
  return request.command === 'recover-write'
}

export async function resolveRecoverWriteRun(
  input: ResolveRecoverWriteRunInput,
  {
    pluginPath,
    readCommandFile = readNarraCatCommandFile,
  }: ResolveRecoverWriteRunDeps,
): Promise<ResolvedRecoverWriteRun> {
  const detail = await loadNovelProjectDetail(input.projectPath, input.selectedChapter)

  if (detail.status === 'invalid') throw new Error(detail.problem ?? '不是有效 NarraCat 项目。')
  if (detail.status === 'needs-setup') throw new Error('请先完成小说设定。')
  if (detail.status === 'needs-outline') throw new Error('请先完成大纲规划。')

  const chapters = detail.tocItems
    .filter((item) => item.kind === 'chapter' && item.chapterNumber && item.volumeNumber)
    .sort((left, right) => (left.chapterNumber ?? 0) - (right.chapterNumber ?? 0))
  const selected = input.selectedChapter
    ? chapters.find((item) => item.chapterNumber === input.selectedChapter)
    : undefined
  const target =
    selected?.status === 'recoverable' ? selected : chapters.find((item) => item.status === 'recoverable')

  if (!target?.chapterNumber || !target.volumeNumber) {
    throw new Error('没有可恢复的中断章节。')
  }

  const chapterNumber = target.chapterNumber
  const volumeNumber = target.volumeNumber
  if (!(await hasAnyFile(toAbsolutePaths(input.projectPath, chapterOutlineCandidates(volumeNumber, chapterNumber))))) {
    throw new Error(`第 ${chapterNumber} 章大纲文件缺失。`)
  }

  const inspection = await inspectRecoveryArtifacts(input.projectPath, volumeNumber, chapterNumber)

  return {
    projectPath: input.projectPath,
    chapterNumber,
    volumeNumber,
    maxTurns: RECOVER_WRITE_MAX_TURNS,
    prompt: createInlineNarraCatCommandPrompt({
      commandName: 'write',
      pluginPath,
      projectPath: input.projectPath,
      intent: String(chapterNumber),
      commandSource: readCommandFile(pluginPath, 'write'),
      extraInstruction: createRecoveryDiagnosis({
        chapterNumber,
        volumeNumber,
        lastCommand: detail.checkpoint?.lastCommand,
        lastStep: detail.checkpoint?.lastStep,
        userPrompt: input.userPrompt,
        inspection,
      }),
    }),
  }
}
