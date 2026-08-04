import type { ReactNode } from 'react'
import { FileText } from 'lucide-react'
import { ArtifactDocumentBody, ArtifactDocumentShell } from './ArtifactDocumentShell'
import type { MarkdownSelectionHandoff } from './ArtifactDocumentShell'
import { WorkbenchEmptyState } from '../WorkbenchEmptyState'
import { extractChapterMetadata } from '@/lib/workbench-copy-document'
import type { NovelArtifact } from '@shared/types/novel'

export function ChapterPreview({
  artifact,
  leadingContent,
  selectionHandoff,
}: {
  artifact?: NovelArtifact
  leadingContent?: ReactNode
  selectionHandoff?: MarkdownSelectionHandoff | null
}) {
  if (!artifact?.exists) {
    return (
      <WorkbenchEmptyState icon={FileText} title="正文尚未生成">
        运行写下一章后，章节正文会出现在这里。
      </WorkbenchEmptyState>
    )
  }

  const { content, metadata } = extractChapterMetadata(artifact.content ?? '')
  const displayArtifact = { ...artifact, content }

  return (
    <ArtifactDocumentShell artifact={displayArtifact} chapterSummary={metadata} title={artifact.title}>
      {leadingContent}
      <ArtifactDocumentBody selectionHandoff={selectionHandoff}>{content}</ArtifactDocumentBody>
    </ArtifactDocumentShell>
  )
}
