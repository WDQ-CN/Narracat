import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { useTheme, type EffectiveTheme } from '@/lib/theme'

const generationLoadingLightVideo = new URL('../../assets/workbench/generation-loading-light.webm', import.meta.url).href
const generationLoadingLightStill = new URL('../../assets/workbench/generation-loading-light.png', import.meta.url).href
const generationLoadingDarkVideo = new URL('../../assets/workbench/generation-loading-dark.webm', import.meta.url).href
const generationLoadingDarkStill = new URL('../../assets/workbench/generation-loading-dark.png', import.meta.url).href

type WorkbenchGenerationAnimationSize = 'main' | 'mini'

const ANIMATION_ASSETS: Record<EffectiveTheme, { still: string; video: string }> = {
  light: {
    video: generationLoadingLightVideo,
    still: generationLoadingLightStill,
  },
  dark: {
    video: generationLoadingDarkVideo,
    still: generationLoadingDarkStill,
  },
}

const SIZE_CLASS: Record<WorkbenchGenerationAnimationSize, string> = {
  main: 'size-28',
  mini: 'size-5',
}

function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function usePrefersReducedMotion(override?: boolean): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => override ?? readPrefersReducedMotion())

  useEffect(() => {
    if (override !== undefined) {
      setPrefersReducedMotion(override)
      return
    }

    if (typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches)
    setPrefersReducedMotion(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [override])

  return prefersReducedMotion
}

export function WorkbenchGenerationAnimation({
  className,
  reducedMotion,
  size,
  theme,
}: {
  className?: string
  reducedMotion?: boolean
  size: WorkbenchGenerationAnimationSize
  theme?: EffectiveTheme
}) {
  const { effectiveTheme } = useTheme()
  const resolvedTheme = theme ?? effectiveTheme
  const asset = ANIMATION_ASSETS[resolvedTheme]
  const prefersReducedMotion = usePrefersReducedMotion(reducedMotion)
  const [videoFailed, setVideoFailed] = useState(false)
  const showStill = prefersReducedMotion || videoFailed

  useEffect(() => {
    setVideoFailed(false)
  }, [resolvedTheme])

  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center', SIZE_CLASS[size], className)}
      data-workbench-generation-animation={size}
    >
      {showStill ? (
        <img
          src={asset.still}
          alt=""
          className="block h-full w-full object-contain"
          draggable={false}
        />
      ) : (
        <video
          src={asset.video}
          poster={asset.still}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="block h-full w-full object-contain"
          onError={() => setVideoFailed(true)}
        />
      )}
    </span>
  )
}
