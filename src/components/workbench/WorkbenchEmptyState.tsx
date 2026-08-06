import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  EMPTY_COMPACT_BODY_CLASS,
  EMPTY_COMPACT_TITLE_CLASS,
  EMPTY_PRIMARY_BODY_CLASS,
  EMPTY_PRIMARY_TITLE_CLASS,
} from '@/design-system'
import { cn } from '@/lib/cn'

export function WorkbenchEmptyState({
  children,
  density = 'primary',
  icon: Icon,
  iconClassName,
  title,
}: {
  children: ReactNode
  density?: 'primary' | 'compact'
  icon: LucideIcon
  /** 图标附加类，用于加载态转圈（animate-spin）这类需要图标自己有动效的场景。 */
  iconClassName?: string
  title: string
}) {
  const titleClass = density === 'compact' ? EMPTY_COMPACT_TITLE_CLASS : EMPTY_PRIMARY_TITLE_CLASS
  const bodyClass = density === 'compact' ? EMPTY_COMPACT_BODY_CLASS : EMPTY_PRIMARY_BODY_CLASS

  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-sm text-center">
        <Icon className={cn('mx-auto mb-3 size-5 text-hint-foreground', iconClassName)} />
        <div className={titleClass}>{title}</div>
        <div className={`mt-1 ${bodyClass}`}>{children}</div>
      </div>
    </div>
  )
}
