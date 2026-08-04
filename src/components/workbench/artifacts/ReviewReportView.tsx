import { MessageSquareText } from 'lucide-react'
import { ArtifactDocumentBody, ArtifactDocumentShell } from './ArtifactDocumentShell'
import type { MarkdownSelectionHandoff } from './ArtifactDocumentShell'
import { WorkbenchEmptyState } from '../WorkbenchEmptyState'
import { renderReviewReportMarkdown, type ReviewReportData } from '@/lib/review-report'
import type { NovelArtifact } from '@shared/types/novel'

export function ReviewReportView({
  artifact,
  selectionHandoff,
}: {
  artifact?: NovelArtifact
  selectionHandoff?: MarkdownSelectionHandoff | null
}) {
  if (!artifact?.exists) {
    return (
      <WorkbenchEmptyState icon={MessageSquareText} title="审修报告尚未生成">
        审修完成后，质量结论和修改建议会在这里显示。
      </WorkbenchEmptyState>
    )
  }

  const data = artifact.data as ReviewReportData | undefined
  if (!data || typeof data !== 'object') {
    return (
      <WorkbenchEmptyState icon={MessageSquareText} title="审修报告无法显示">
        审修报告数据契约缺失或损坏，可重新运行审修。
      </WorkbenchEmptyState>
    )
  }

  const content = renderReviewReportMarkdown(data)
  // 清空 data，让文件信息的「字数」按渲染后正文计（壳层 data 存在时会按 JSON 计）
  const displayArtifact = { ...artifact, content, data: undefined }

  return (
    <ArtifactDocumentShell artifact={displayArtifact} title={artifact.title}>
      <ArtifactDocumentBody selectionHandoff={selectionHandoff}>{content}</ArtifactDocumentBody>
    </ArtifactDocumentShell>
  )
}
