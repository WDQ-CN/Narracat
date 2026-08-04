import { useLayoutEffect, useRef } from 'react'
import { READING_BODY_FONT_CLASS } from '@/design-system'

type EditorViewportSnapshot = {
  scrollFrame: HTMLElement | null
  frameScrollTop: number
  frameScrollLeft: number
  editorScrollTop: number
  editorScrollLeft: number
  selectionStart: number
  selectionEnd: number
  selectionDirection: 'forward' | 'backward' | 'none'
  focused: boolean
}

function captureViewportSnapshot(editor: HTMLTextAreaElement): EditorViewportSnapshot {
  const scrollFrame = editor.closest<HTMLElement>('[data-workbench-object-scroll-frame]')
  return {
    scrollFrame,
    frameScrollTop: scrollFrame?.scrollTop ?? 0,
    frameScrollLeft: scrollFrame?.scrollLeft ?? 0,
    editorScrollTop: editor.scrollTop,
    editorScrollLeft: editor.scrollLeft,
    selectionStart: editor.selectionStart,
    selectionEnd: editor.selectionEnd,
    selectionDirection: editor.selectionDirection,
    focused: document.activeElement === editor,
  }
}

function restoreViewportSnapshot(editor: HTMLTextAreaElement, snapshot: EditorViewportSnapshot) {
  if (
    snapshot.focused &&
    (editor.selectionStart !== snapshot.selectionStart ||
      editor.selectionEnd !== snapshot.selectionEnd ||
      editor.selectionDirection !== snapshot.selectionDirection)
  ) {
    editor.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, snapshot.selectionDirection)
  }
  editor.scrollTop = snapshot.editorScrollTop
  editor.scrollLeft = snapshot.editorScrollLeft
  if (snapshot.scrollFrame) {
    snapshot.scrollFrame.scrollTop = snapshot.frameScrollTop
    snapshot.scrollFrame.scrollLeft = snapshot.frameScrollLeft
  }
}

/**
 * 沉浸整章编辑区：纯文本 textarea，字体/行距/断行与阅读态 MarkdownRenderer document 变体
 * 对齐（READING_BODY_FONT_CLASS + leading-8），自动撑高随内容增长，外层滚动沿用内容面板。
 */
export function ManuscriptEditorView({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const pendingViewportSnapshotRef = useRef<EditorViewportSnapshot | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const snapshot = pendingViewportSnapshotRef.current ?? captureViewportSnapshot(el)
    pendingViewportSnapshotRef.current = null
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    restoreViewportSnapshot(el, snapshot)
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(event) => {
        pendingViewportSnapshotRef.current = captureViewportSnapshot(event.currentTarget)
        onChange(event.currentTarget.value)
      }}
      disabled={disabled}
      autoFocus
      data-manuscript-editor="true"
      className={`w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none whitespace-pre-wrap break-words ${READING_BODY_FONT_CLASS} leading-8 text-body-foreground [overflow-wrap:anywhere]`}
    />
  )
}
