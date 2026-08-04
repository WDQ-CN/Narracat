import { useRef } from 'react'
import { motion, useAnimationFrame, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { cn } from '@/lib/cn'

export interface ShinyTextProps {
  text: string
  /** 高光扫过一轮的秒数 */
  speed?: number
  /** 文字基础色（默认品牌绿） */
  color?: string
  /** 高光峰值色 */
  shineColor?: string
  /** 渐变角度 */
  spread?: number
  /** 强制静态（reduced-motion 会自动静态） */
  still?: boolean
  className?: string
}

/**
 * 品牌绿高光扫过文字。移植自官网 ShinyText（纯 framer-motion），默认色接品牌 token。
 * 用于终幕 Slogan 与品牌名的签名感。
 */
export function ShinyText({
  text,
  speed = 3,
  color = 'var(--brand)',
  shineColor = 'color-mix(in oklch, var(--brand) 55%, white)',
  spread = 120,
  still = false,
  className,
}: ShinyTextProps) {
  const reduced = useReducedMotion()
  const progress = useMotionValue(0)
  const elapsedRef = useRef(0)
  const lastTimeRef = useRef<number | null>(null)
  const duration = speed * 1000

  useAnimationFrame((time) => {
    if (still || reduced) return
    if (lastTimeRef.current === null) {
      lastTimeRef.current = time
      return
    }
    elapsedRef.current += time - lastTimeRef.current
    lastTimeRef.current = time
    const t = elapsedRef.current % duration
    progress.set((t / duration) * 100)
  })

  const backgroundPosition = useTransform(progress, (p) => `${150 - p * 2}% center`)

  if (still || reduced) {
    return (
      <span className={cn('inline-block', className)} style={{ color }}>
        {text}
      </span>
    )
  }

  return (
    <motion.span
      className={cn('inline-block', className)}
      style={{
        backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
        backgroundSize: '200% auto',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundPosition,
      }}
    >
      {text}
    </motion.span>
  )
}
