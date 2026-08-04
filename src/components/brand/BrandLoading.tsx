import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { BrandMark } from './BrandMark'

export interface BrandLoadingProps {
  /** 延迟多少毫秒才淡入，避免启动快时一闪而过（“快则不显”） */
  appearDelayMs?: number
}

const BREATHE_TRANSITION = {
  duration: 2.4,
  ease: 'easeInOut',
  repeat: Infinity,
} as const

/**
 * 品牌启动 loading：呼吸的 Logo + 品牌绿光晕。
 * 300ms 防抖——首屏在阈值内就绪就几乎看不到，超时才优雅淡入。
 * 替换原先的纯文字 “正在打开...”。
 */
export function BrandLoading({ appearDelayMs = 300 }: BrandLoadingProps) {
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), appearDelayMs)
    return () => window.clearTimeout(id)
  }, [appearDelayMs])

  return (
    <div
      className="flex h-full min-h-0 items-center justify-center bg-canvas"
      data-app-route-fallback="true"
      role="status"
      aria-label="正在打开 NarraCat"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: visible ? 1 : 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex items-center justify-center"
      >
        {/* 品牌绿光晕 */}
        <motion.span
          aria-hidden
          className="absolute size-24 rounded-full"
          style={{ background: 'var(--brand-soft)', filter: 'blur(26px)' }}
          animate={reduced ? undefined : { opacity: [0.25, 0.7, 0.25], scale: [0.9, 1.06, 0.9] }}
          transition={reduced ? undefined : BREATHE_TRANSITION}
        />
        {/* 呼吸 Logo */}
        <motion.span
          className="relative"
          animate={reduced ? undefined : { opacity: [0.55, 1, 0.55], scale: [0.97, 1, 0.97] }}
          transition={reduced ? undefined : BREATHE_TRANSITION}
        >
          <BrandMark size="xl" />
        </motion.span>
      </motion.div>
    </div>
  )
}
