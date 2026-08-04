import { Layers } from 'lucide-react'
import { ArtifactDocumentBody, ArtifactDocumentShell } from './ArtifactDocumentShell'
import type { MarkdownSelectionHandoff } from './ArtifactDocumentShell'
import { WorkbenchEmptyState } from '../WorkbenchEmptyState'
import { renderChapterOutlineMarkdown, type ChapterOutlineData } from '@shared/lib/outline-structure'
import type { NovelArtifact } from '@shared/types/novel'

export function OutlineView({
  artifact,
  selectionHandoff,
}: {
  artifact?: NovelArtifact
  selectionHandoff?: MarkdownSelectionHandoff | null
}) {
  if (!artifact?.exists) {
    return (
      <WorkbenchEmptyState icon={Layers} title="缺少章节大纲">
        当前章节还没有大纲文件。补齐大纲后才能进入稳定写作流程。
      </WorkbenchEmptyState>
    )
  }

  // 优先从结构化数据契约（ch-NNN.json）渲染人读 markdown（ADR-0018）；缺契约时回退人读 md
  const data = artifact.data
  const content =
    data && typeof data === 'object'
      ? renderChapterOutlineMarkdown(data as ChapterOutlineData)
      : artifact.content ?? ''
  // 清空 data，让文件信息的「字数」按渲染后正文计（壳层 data 存在时会按 JSON 计）
  const displayArtifact = { ...artifact, content, data: undefined }

  return (
    <ArtifactDocumentShell artifact={displayArtifact} title={artifact.title}>
      <ArtifactDocumentBody selectionHandoff={selectionHandoff}>{content}</ArtifactDocumentBody>
    </ArtifactDocumentShell>
  )
}
