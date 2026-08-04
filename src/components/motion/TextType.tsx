import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/cn'

export interface TextTypeProps {
  /** 单句或多句（多句配 loop 轮播） */
  text: string | string[]
  /** 每字打出的毫秒间隔 */
  typingSpeed?: number
  /** 开始打字前的延迟（毫秒） */
  initialDelay?: number
  /** 一句打完到开始删除的停留（毫秒，仅 loop/多句时用） */
  pauseDuration?: number
  /** 删除每字的毫秒间隔 */
  deletingSpeed?: number
  /** 是否循环；false 时打完最后一句停住 */
  loop?: boolean
  showCursor?: boolean
  cursorCharacter?: string
  className?: string
  cursorClassName?: string
  as?: 'div' | 'span' | 'p' | 'h1' | 'h2' | 'h3'
  /** 不循环时，最后一句打完触发一次 */
  onDone?: () => void
}

/**
 * 打字机效果（移植自 React Bits 的 TextType）。原组件用 gsap 仅做光标闪烁，
 * 这里改用已装的 framer-motion 实现等效闪烁，省去 gsap 依赖。reduced-motion 直接显示完整首句。
 */
export function TextType({
  text,
  typingSpeed = 75,
  initialDelay = 0,
  pauseDuration = 1500,
  deletingSpeed = 40,
  loop = false,
  showCursor = true,
  cursorCharacter = '|',
  className,
  cursorClassName,
  as: Tag = 'span',
  onDone,
}: TextTypeProps) {
  const reduced = useReducedMotion()
  const texts = useMemo(() => (Array.isArray(text) ? text : [text]), [text])
  const [display, setDisplay] = useState('')
  const [textIndex, setTextIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [started, setStarted] = useState(false)
  const doneRef = useRef(false)

  useEffect(() => {
    const id = window.setTimeout(() => setStarted(true), initialDelay)
    return () => window.clearTimeout(id)
  }, [initialDelay])

  useEffect(() => {
    if (reduced || !started) return
    const current = texts[textIndex]
    let id: number

    if (!deleting) {
      if (charIndex < current.length) {
        id = window.setTimeout(() => {
          setDisplay(current.slice(0, charIndex + 1))
          setCharIndex((c) => c + 1)
        }, typingSpeed)
      } else {
        const isLast = textIndex === texts.length - 1
        if (!loop && isLast) {
          if (!doneRef.current) {
            doneRef.current = true
            onDone?.()
          }
          return
        }
        id = window.setTimeout(() => setDeleting(true), pauseDuration)
      }
    } else if (charIndex > 0) {
      id = window.setTimeout(() => {
        setDisplay(current.slice(0, charIndex - 1))
        setCharIndex((c) => c - 1)
      }, deletingSpeed)
    } else {
      setDeleting(false)
      setTextIndex((i) => (i + 1) % texts.length)
    }

    return () => window.clearTimeout(id)
  }, [started, reduced, charIndex, deleting, textIndex, texts, typingSpeed, deletingSpeed, pauseDuration, loop, onDone])

  const content = reduced ? texts[0] : display

  return (
    <Tag className={cn('inline-block whitespace-pre-wrap', className)}>
      {content}
      {showCursor && (
        <motion.span
          aria-hidden
          className={cn('ml-0.5 inline-block', cursorClassName)}
          initial={{ opacity: 1 }}
          animate={reduced ? { opacity: 1 } : { opacity: 0 }}
          transition={reduced ? undefined : { duration: 0.5, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
        >
          {cursorCharacter}
        </motion.span>
      )}
    </Tag>
  )
}
