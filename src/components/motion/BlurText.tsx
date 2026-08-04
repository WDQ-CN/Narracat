import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/cn'

// 与 globals.css 的 slide-up-fade 同一条出场曲线，保持品牌动效一致。
const REVEAL_EASE = [0.16, 1, 0.3, 1] as const

export interface BlurTextProps {
  /** 要逐字浮现的文本 */
  text: string
  /** 整段起始延迟（秒）——多行级联时用来错开 */
  startDelay?: number
  /** 相邻字之间的间隔（秒） */
  charStagger?: number
  /** 单字动画时长（秒） */
  duration?: number
  /** 强制静态显示（不拆字、不动画）；reduced-motion 会自动静态 */
  still?: boolean
  /** 最后一个字动画结束的回调（用于编排下一步） */
  onDone?: () => void
  className?: string
  as?: 'p' | 'span' | 'div' | 'h1' | 'h2' | 'h3'
}

/**
 * 逐字模糊浮现。挂载即播（无滚动触发），移植自官网 BlurText / StoryLine 的核心手法：
 * blur(10px)→0、opacity 0→1、y 上浮，按字 stagger。序幕理念与功能三幕标题共用。
 */
export function BlurText({
  text,
  startDelay = 0,
  charStagger = 0.024,
  duration = 0.35,
  still = false,
  onDone,
  className,
  as: Tag = 'p',
}: BlurTextProps) {
  const reduced = useReducedMotion()

  if (still || reduced) {
    return <Tag className={className}>{text}</Tag>
  }

  const chars = Array.from(text)
  const lastIndex = chars.length - 1

  return (
    <Tag className={cn('flex flex-wrap', className)}>
      {chars.map((char, i) => (
        <motion.span
          key={i}
          className="inline-block will-change-[transform,filter,opacity]"
          initial={{ filter: 'blur(10px)', opacity: 0, y: 18 }}
          animate={{
            filter: ['blur(10px)', 'blur(5px)', 'blur(0px)'],
            opacity: [0, 0.6, 1],
            y: [18, -2, 0],
          }}
          transition={{
            duration,
            times: [0, 0.5, 1],
            delay: startDelay + i * charStagger,
            ease: REVEAL_EASE,
          }}
          onAnimationComplete={i === lastIndex ? onDone : undefined}
        >
          {char === ' ' ? ' ' : char}
        </motion.span>
      ))}
    </Tag>
  )
}
