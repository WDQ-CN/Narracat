import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/cn'
import { BrandMark, type BrandMarkTone } from './BrandMark'

export type BrandLockupSize = 'sm' | 'md' | 'lg'

export interface BrandLockupProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  size?: BrandLockupSize
  tone?: BrandMarkTone
}

const LOCKUP_TEXT_CLASS: Record<BrandLockupSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
}

export function BrandLockup({
  className,
  size = 'md',
  tone = 'neutral',
  ...props
}: BrandLockupProps) {
  return (
    <span
      data-brand-lockup="true"
      data-size={size}
      className={cn('inline-flex select-none items-center gap-2 text-foreground', className)}
      {...props}
    >
      <BrandMark decorative size={size} tone={tone} />
      <span className={cn('font-semibold leading-none', LOCKUP_TEXT_CLASS[size])}>NarraCat</span>
    </span>
  )
}
