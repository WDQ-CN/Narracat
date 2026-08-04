import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  EMPTY_COMPACT_BODY_CLASS,
  EMPTY_COMPACT_TITLE_CLASS,
  EMPTY_PRIMARY_BODY_CLASS,
  EMPTY_PRIMARY_TITLE_CLASS,
} from '@/design-system'

export function WorkbenchEmptyState({
  children,
  density = 'primary',
  icon: Icon,
  title,
}: {
  children: ReactNode
  density?: 'primary' | 'compact'
  icon: LucideIcon
  title: string
}) {
  const titleClass = density === 'compact' ? EMPTY_COMPACT_TITLE_CLASS : EMPTY_PRIMARY_TITLE_CLASS
  const bodyClass = density === 'compact' ? EMPTY_COMPACT_BODY_CLASS : EMPTY_PRIMARY_BODY_CLASS

  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-sm text-center">
        <Icon className="mx-auto mb-3 size-5 text-hint-foreground" />
        <div className={titleClass}>{title}</div>
        <div className={`mt-1 ${bodyClass}`}>{children}</div>
      </div>
    </div>
  )
}
