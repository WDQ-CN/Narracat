import type { NovelWorkbenchArtifact, NovelWorkbenchArtifacts, NovelWorkbenchTreeItem } from '@shared/types/novel'
import type { WorkbenchChapterView } from '@shared/types/workbench'
import { renderReviewReportMarkdown, type ReviewReportData } from './review-report'
import {
  renderChapterOutlineMarkdown,
  renderOutlineStructureMarkdown,
  type ChapterOutlineData,
  type OutlineStructureData,
} from '@shared/lib/outline-structure'
import { renderPremiseCardsMarkdown, type PremiseCardsData } from './premise-cards'

export interface WorkbenchCopyDocument {
  title: string
  text: string
}

const CHAPTER_COPY_ARTIFACT_IDS: Partial<Record<WorkbenchChapterView, NovelWorkbenchArtifact['id']>> = {
  text: 'manuscript',
  context: 'manuscript',
  outline: 'chapter-outline',
  review: 'review',
}

function extractStructuredJsonComment(content: string, key: string): { content: string; data?: unknown } {
  let data: unknown

  const pattern = new RegExp(`<!--\\s*${key}\\s*:\\s*([\\s\\S]*?)\\s*-->`, 'gi')
  const nextContent = content.replace(pattern, (_match, rawData: string) => {
    if (data === undefined) {
      try {
        data = JSON.parse(rawData.trim())
      } catch {
        data = undefined
      }
    }

    return ''
  })

  return { content: nextContent.trimEnd(), data }
}

export function extractChapterMetadata(content: string): { content: string; metadata?: unknown } {
  const { content: nextContent, data } = extractStructuredJsonComment(content, 'chapter_metadata')
  return { content: nextContent, metadata: data }
}

// 审修报告末尾的 <!-- review_report_json: {...} --> 是供程序路由的冗余孪生（见上游 ADR 0012），
// Markdown 本体已含全部字段人读版本（两维度判定 / 阅读欲望 / 修订指令），因此只剥离不展示。
export function stripReviewReportJson(content: string): string {
  return extractStructuredJsonComment(content, 'review_report_json').content
}

export function normalizeCopyDocumentText(content: string): string {
  return content.replace(/\r\n?/g, '\n').trim()
}

export function resolveVisibleWorkbenchCopyDocument({
  artifacts,
  chapterView,
  selectedItem,
  selectedSubcontentArtifactId,
}: {
  artifacts: NovelWorkbenchArtifacts | null
  chapterView: WorkbenchChapterView
  selectedItem: NovelWorkbenchTreeItem | null
  selectedSubcontentArtifactId?: string | null
}): WorkbenchCopyDocument | null {
  if (!selectedItem || selectedItem.kind === 'reference-list') return null

  if (selectedItem.kind === 'chapter') {
    const artifactId = CHAPTER_COPY_ARTIFACT_IDS[chapterView]
    const artifact = artifacts?.artifacts.find((candidate) => candidate.id === artifactId)
    return copyDocumentFromArtifact(artifact, {
      stripChapterMetadata: artifactId === 'manuscript',
      stripReviewReportJson: artifactId === 'review',
    })
  }

  const displayableArtifacts = artifacts?.artifacts.filter(hasCopyableArtifactContent) ?? []
  const artifact =
    displayableArtifacts.find((candidate) => candidate.id === selectedSubcontentArtifactId) ??
    displayableArtifacts[0]

  return copyDocumentFromArtifact(artifact)
}

function hasCopyableArtifactContent(artifact: NovelWorkbenchArtifact): boolean {
  if (!artifact.exists) return false
  if (artifact.data && typeof artifact.data === 'object') return true
  return typeof artifact.content === 'string' && normalizeCopyDocumentText(artifact.content).length > 0
}

/**
 * 带结构化 DTO（data）的产物复制其人读 markdown 渲染，与 App 视图一致（ADR-0018），
 * 不复制 .json 原文；无 DTO 时回退人读 md content。
 */
function structuredArtifactMarkdown(artifact: NovelWorkbenchArtifact): string | null {
  const data = artifact.data
  if (!data || typeof data !== 'object') return null
  if (artifact.id === 'review') return renderReviewReportMarkdown(data as ReviewReportData)
  if (artifact.id === 'chapter-outline') return renderChapterOutlineMarkdown(data as ChapterOutlineData)
  if (artifact.id === 'master-outline') return renderOutlineStructureMarkdown(data as OutlineStructureData)
  if (artifact.id === 'bible-premise') return renderPremiseCardsMarkdown(data as PremiseCardsData)
  return null
}

function copyDocumentFromArtifact(
  artifact: NovelWorkbenchArtifact | undefined,
  options: { stripChapterMetadata?: boolean; stripReviewReportJson?: boolean } = {},
): WorkbenchCopyDocument | null {
  // staging 只读预览（刀 3 §4.6）：写作中断的草稿不进复制/导出，只在阅读画布展示。
  if (!artifact?.exists || artifact.isDraft) return null

  const structured = structuredArtifactMarkdown(artifact)
  let content = structured ?? (typeof artifact.content === 'string' ? artifact.content : null)
  if (content === null) return null

  // 剥离仅适用于人读 md 回退路径的程序化注释；结构化渲染已是干净 markdown
  if (structured === null) {
    if (options.stripChapterMetadata) content = extractChapterMetadata(content).content
    if (options.stripReviewReportJson) content = stripReviewReportJson(content)
  }
  const text = normalizeCopyDocumentText(content)
  if (!text) return null

  return {
    title: artifact.title,
    text,
  }
}
