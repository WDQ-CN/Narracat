import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

export type WorkbenchGenerationLoadingProps = {
  theme: 'light' | 'dark'
}

type AnimationPalette = {
  pageFill: string
  pageStroke: string
  lineStroke: string
  scanStroke: string
  shadow: string
}

const PALETTES: Record<WorkbenchGenerationLoadingProps['theme'], AnimationPalette> = {
  light: {
    pageFill: 'rgba(250, 250, 250, 0.74)',
    pageStroke: 'rgba(63, 63, 70, 0.58)',
    lineStroke: 'rgba(82, 82, 91, 0.70)',
    scanStroke: 'rgba(113, 113, 122, 0.52)',
    shadow: 'rgba(24, 24, 27, 0.10)',
  },
  dark: {
    pageFill: 'rgba(39, 39, 42, 0.50)',
    pageStroke: 'rgba(244, 244, 245, 0.74)',
    lineStroke: 'rgba(228, 228, 231, 0.72)',
    scanStroke: 'rgba(244, 244, 245, 0.58)',
    shadow: 'rgba(0, 0, 0, 0.24)',
  },
}

const LINE_Y = [91, 111, 132, 153]
const LINE_WIDTH = [86, 112, 96, 72]
const LINE_X = [80, 72, 80, 72]

function wave(loop: number, offset: number): number {
  return (Math.sin((loop + offset) * Math.PI * 2) + 1) / 2
}

export function WorkbenchGenerationLoading({ theme }: WorkbenchGenerationLoadingProps) {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const palette = PALETTES[theme]
  const loop = (frame % durationInFrames) / durationInFrames
  const easedLoop = interpolate(loop, [0, 1], [0, 1], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const scanY = interpolate(easedLoop, [0, 1], [66, 178])
  const scanOpacity = interpolate(loop, [0, 0.15, 0.55, 0.88, 1], [0, 0.44, 0.56, 0.12, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const pageScale = 1.34
  const pageLift = interpolate(wave(loop, 0.08), [0, 1], [0, -2])
  const pageOpacity = interpolate(wave(loop, 0.33), [0, 1], [0.86, 1])
  const cornerProgress = interpolate(wave(loop, 0.62), [0, 1], [0, 1])
  const cornerOffset = interpolate(cornerProgress, [0, 1], [8, 0])

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        backgroundColor: 'transparent',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <svg
        width="256"
        height="256"
        viewBox="0 0 256 256"
        role="img"
        aria-label="Workbench generation loading animation"
      >
        <defs>
          <filter id="soft-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor={palette.shadow} floodOpacity="1" />
          </filter>
          <linearGradient id="scan-gradient" x1="58" y1="0" x2="198" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={palette.scanStroke} stopOpacity="0" />
            <stop offset="0.5" stopColor={palette.scanStroke} stopOpacity="1" />
            <stop offset="1" stopColor={palette.scanStroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        <g
          filter="url(#soft-shadow)"
          opacity={pageOpacity}
          transform={`translate(128 ${128 + pageLift}) scale(${pageScale}) translate(-128 -128)`}
        >
          <path
            d="M76 52H156L188 84V196H76Z"
            fill={palette.pageFill}
            stroke={palette.pageStroke}
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d={`M156 52V${84 - cornerOffset}H${188 - cornerOffset}`}
            fill="none"
            stroke={palette.pageStroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
            opacity="0.64"
          />
          {LINE_Y.map((y, index) => {
            const pulse = wave(loop, index * 0.13)
            const opacity = interpolate(pulse, [0, 0.35, 1], [0.20, 0.52, 0.82])
            const width = interpolate(pulse, [0, 1], [LINE_WIDTH[index] * 0.42, LINE_WIDTH[index]])

            return (
              <line
                key={y}
                x1={LINE_X[index]}
                x2={LINE_X[index] + width}
                y1={y}
                y2={y}
                stroke={palette.lineStroke}
                strokeLinecap="round"
                strokeWidth="4"
                opacity={opacity}
              />
            )
          })}
          <line
            x1="62"
            x2="194"
            y1={scanY}
            y2={scanY}
            stroke="url(#scan-gradient)"
            strokeLinecap="round"
            strokeWidth="5"
            opacity={scanOpacity}
          />
        </g>
      </svg>
    </AbsoluteFill>
  )
}
