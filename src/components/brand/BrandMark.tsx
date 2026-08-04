import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/cn'

export type BrandMarkSize = 'sm' | 'md' | 'lg' | 'xl'
export type BrandMarkTone = 'neutral' | 'brand'

export interface BrandMarkProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  size?: BrandMarkSize
  tone?: BrandMarkTone
  decorative?: boolean
}

const MARK_SIZE_CLASS: Record<BrandMarkSize, string> = {
  sm: 'size-6',
  md: 'size-8',
  lg: 'size-11',
  xl: 'size-14',
}

const narracatMarkUrl = new URL('../../assets/brand/narracat-mark.webp', import.meta.url).href

export function BrandMark({
  className,
  decorative = false,
  size = 'md',
  tone: _tone = 'neutral',
  ...props
}: BrandMarkProps) {
  return (
    <span
      data-brand-mark="true"
      data-size={size}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : 'NarraCat'}
      role={decorative ? undefined : 'img'}
      className={cn(
        'inline-flex shrink-0 items-center justify-center leading-none',
        MARK_SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      <img
        src={narracatMarkUrl}
        alt=""
        aria-hidden="true"
        decoding="async"
        draggable={false}
        className={cn('block object-contain', MARK_SIZE_CLASS[size])}
      />
    </span>
  )
}
