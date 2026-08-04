import { ShieldCheck } from 'lucide-react'
import { ArtifactDocumentBody, ArtifactDocumentShell } from './ArtifactDocumentShell'
import { WorkbenchEmptyState } from '../WorkbenchEmptyState'
import type { NovelArtifact } from '@shared/types/novel'

export function ContextPackView({ artifact }: { artifact?: NovelArtifact }) {
  if (!artifact?.exists) {
    return (
      <WorkbenchEmptyState icon={ShieldCheck} title="上下文包尚未生成">
        写前预检完成后，本章写作依据会在这里显示。
      </WorkbenchEmptyState>
    )
  }

  const content = artifact.data === undefined ? artifact.content : JSON.stringify(artifact.data, null, 2)

  return (
    <ArtifactDocumentShell artifact={artifact} title={artifact.title}>
      {artifact.error && (
        <div className="mb-4 rounded-card border border-destructive/30 px-3 py-2 text-xs text-destructive">
          {artifact.error}
        </div>
      )}
      <ArtifactDocumentBody mono>{content}</ArtifactDocumentBody>
    </ArtifactDocumentShell>
  )
}
