import { useEffect, useState, type RefObject } from 'react'

/** 展开态预留给标题栏 + 操作栏 + 内边距 + 一条历史缝的高度（px），按真机微调。 */
export const COMPOSER_EXPAND_RESERVE_PX = 200
/** 展开态输入区的高度下限（px），保证极小窗口下仍明显高于收起态。 */
export const COMPOSER_EXPAND_MIN_PX = 160

/** 由对话栏 section 的可用高度推导展开态输入区高度，clamp 到下限。纯函数，便于单测。 */
export function resolveComposerExpandHeight(sectionHeight: number): number {
  return Math.max(COMPOSER_EXPAND_MIN_PX, sectionHeight - COMPOSER_EXPAND_RESERVE_PX)
}

/**
 * 量取 Agent 对话栏（composer 所在 <section>）的可用高度，返回展开态输入区目标高度。
 * 用 ResizeObserver 跟随窗口/面板尺寸变化，保证展开时填满列且不挤出底部操作栏。
 */
export function useComposerExpandHeight(containerRef: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(COMPOSER_EXPAND_MIN_PX)

  useEffect(() => {
    const section = containerRef.current?.closest('section')
    if (!section || typeof ResizeObserver === 'undefined') return

    const compute = () => setHeight(resolveComposerExpandHeight(section.clientHeight))
    compute()

    const observer = new ResizeObserver(compute)
    observer.observe(section)
    return () => observer.disconnect()
  }, [containerRef])

  return height
}
