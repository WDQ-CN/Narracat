import type { ImgHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { getBrandIllustration, type BrandIllustrationPurpose } from './brand-illustrations'

export type BrandIllustrationSize = 'sm' | 'md' | 'lg' | 'xl'

export interface BrandIllustrationProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  purpose: BrandIllustrationPurpose
  size?: BrandIllustrationSize
  alt?: string
  decorative?: boolean
}

const ILLUSTRATION_SIZE_CLASS: Record<BrandIllustrationSize, string> = {
  sm: 'size-20',
  md: 'size-28',
  lg: 'size-36',
  xl: 'size-52',
}

export function BrandIllustration({
  className,
  decorative,
  purpose,
  size = 'md',
  alt,
  loading = 'lazy',
  ...props
}: BrandIllustrationProps) {
  const asset = getBrandIllustration(purpose)
  const isDecorative = decorative ?? alt === undefined

  return (
    <img
      data-brand-illustration={purpose}
      data-size={size}
      src={asset.src}
      alt={isDecorative ? '' : alt ?? asset.label}
      aria-hidden={isDecorative ? true : undefined}
      loading={loading}
      decoding="async"
      draggable={false}
      className={cn('block shrink-0 object-contain', ILLUSTRATION_SIZE_CLASS[size], className)}
      {...props}
    />
  )
}
