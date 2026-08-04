import { WorkbenchGenerationAnimation } from './WorkbenchGenerationAnimation'
import type { WorkbenchGenerationState } from '@/lib/workbench-generation'

export function WorkbenchGenerationEmptyState({ generationState }: { generationState: WorkbenchGenerationState }) {
  return (
    <div
      className="flex h-full items-center justify-center"
      data-workbench-generation-empty="true"
    >
      <div className="mx-auto flex max-w-sm flex-col items-center text-center">
        <WorkbenchGenerationAnimation size="main" className="mb-5" />
        <h2 className="text-sm font-semibold text-foreground">{generationState.statusText}</h2>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">完成后会自动刷新当前页面。</p>
      </div>
    </div>
  )
}
