import { FilePlus2 } from 'lucide-react'
import { BrandIllustration } from '@/components/brand'
import type { BrandIllustrationPurpose } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { EMPTY_PRIMARY_BODY_CLASS, EMPTY_PRIMARY_TITLE_CLASS, WORKBENCH_GUIDE_ACTION_CLASS } from '@/design-system'
import type { WorkbenchAction } from '@/lib/workbench-actions'
import { getWorkbenchActionIcon } from './workbench-action-icons'

export function WorkbenchEmptyGuide({
  action,
  description,
  onAction,
  purpose,
  title,
}: {
  title: string
  description: string
  purpose?: BrandIllustrationPurpose
  action?: WorkbenchAction | null
  onAction?: (action: WorkbenchAction) => void
}) {
  const shownAction = action && onAction ? action : null
  const actionIcon = shownAction ? getWorkbenchActionIcon(shownAction) : null
  const ActionIcon = actionIcon?.Icon

  return (
    <div className="flex h-full items-center justify-center" data-workbench-empty-guide="true">
      <div className="mx-auto flex max-w-sm flex-col items-center text-center">
        {purpose ? (
          <BrandIllustration purpose={purpose} size="lg" decorative className="mb-4" />
        ) : (
          <div className="mb-4 flex size-10 items-center justify-center rounded-full border border-border bg-active text-muted-foreground">
            <FilePlus2 className="size-5" />
          </div>
        )}
        <h2 className={EMPTY_PRIMARY_TITLE_CLASS}>{title}</h2>
        <p className={`mt-2 ${EMPTY_PRIMARY_BODY_CLASS}`}>{description}</p>
        {shownAction && actionIcon && ActionIcon && (
          <>
            <Button
              type="button"
              size="lg"
              className={`mt-5 ${WORKBENCH_GUIDE_ACTION_CLASS}`}
              aria-label={shownAction.label}
              disabled={!shownAction.enabled}
              data-action-icon={actionIcon.key}
              data-workbench-empty-guide-action={shownAction.id}
              onClick={() => onAction?.(shownAction)}
            >
              <ActionIcon className="size-3.5" />
              {shownAction.label}
            </Button>
            {!shownAction.enabled && shownAction.disabledReason && (
              <p className="mt-2 text-xs text-hint-foreground">{shownAction.disabledReason}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
