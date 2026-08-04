import type { ImgHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const narracatAboutBannerUrl = new URL('../../assets/brand/narracat-about-banner.webp', import.meta.url).href

export interface BrandStoryBannerProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  alt?: string
}

export function BrandStoryBanner({
  alt = 'NarraCat 品牌故事横幅',
  className,
  loading = 'lazy',
  ...props
}: BrandStoryBannerProps) {
  return (
    <img
      data-brand-story-banner="true"
      src={narracatAboutBannerUrl}
      alt={alt}
      loading={loading}
      decoding="async"
      draggable={false}
      className={cn('block h-full w-full object-cover', className)}
      {...props}
    />
  )
}
