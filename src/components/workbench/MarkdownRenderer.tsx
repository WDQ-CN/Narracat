import { Children, Fragment, memo, useMemo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AGENT_BODY_CLASS, READING_BODY_FONT_CLASS } from '@/design-system'
import { cn } from '@/lib/cn'
import { resolveAgentQuickActionFromCommandLabel } from '@/lib/agent-commands'
import type { AgentQuickAction } from '@shared/types/agent'

export type MarkdownRendererVariant = 'document' | 'conversation'
type CommandPillRenderer = (commandLabel: string, action: AgentQuickAction) => ReactNode

const REMARK_PLUGINS = [remarkGfm]

const ROOT_CLASS_BY_VARIANT: Record<MarkdownRendererVariant, string> = {
  document: `min-w-0 max-w-full space-y-4 break-words ${READING_BODY_FONT_CLASS} leading-8 text-body-foreground [overflow-wrap:anywhere]`,
  conversation:
    `min-w-0 w-full max-w-full overflow-hidden space-y-3 break-words ${AGENT_BODY_CLASS} [overflow-wrap:anywhere]`,
}

const HEADING_CLASS_BY_VARIANT: Record<MarkdownRendererVariant, string> = {
  document: 'break-words font-semibold leading-tight text-foreground [overflow-wrap:anywhere]',
  conversation: 'break-words font-semibold leading-snug text-foreground [overflow-wrap:anywhere]',
}

const TABLE_WRAP_CLASS_BY_VARIANT: Record<MarkdownRendererVariant, string> = {
  document: 'max-w-full overflow-x-auto rounded-row border border-border',
  conversation: 'min-w-0 w-full max-w-full overflow-x-auto rounded-md border border-border',
}

const TABLE_CLASS_BY_VARIANT: Record<MarkdownRendererVariant, string> = {
  document: 'w-full min-w-max border-collapse text-left text-sm',
  conversation: 'w-max min-w-full border-collapse text-left text-sm',
}

const CODE_CLASS_BY_VARIANT: Record<MarkdownRendererVariant, string> = {
  document: 'rounded-sm bg-active px-1 py-0.5 font-mono text-foreground',
  conversation: 'rounded-sm bg-active px-1 py-0.5 font-mono text-foreground break-words [overflow-wrap:anywhere]',
}

const LONG_TEXT_BLOCK_CLASS_BY_VARIANT: Record<MarkdownRendererVariant, string> = {
  // 文档区长文性能优化（ADR-0022）保留；会话消息体量小且流式高度会抖，不塌缩。
  document: '[content-visibility:auto] [contain-intrinsic-size:1px_32px]',
  conversation: '',
}
const LONG_PANEL_BLOCK_CLASS_BY_VARIANT: Record<MarkdownRendererVariant, string> = {
  document: '[content-visibility:auto] [contain-intrinsic-size:1px_220px]',
  conversation: '',
}

const DOCUMENT_COMPONENTS = createMarkdownComponents('document')
const CONVERSATION_COMPONENTS = createMarkdownComponents('conversation')

// memo：文档路径（不传 commandPillRenderer）下，相同 text/variant 不再重复 parse markdown——
// 这是切 tab 命中缓存秒回后避免父链重渲染触发重 parse 的关键（ADR-0022）。
// 会话路径的 commandPillRenderer 由调用方 useCallback 稳定（AgentMarkdown），memo 同样生效：
// 流式期间只有 text 增长的那条消息重 parse，其余消息不动。
export const MarkdownRenderer = memo(function MarkdownRenderer({
  commandPillRenderer,
  text,
  variant = 'document',
}: {
  commandPillRenderer?: CommandPillRenderer
  text: string
  variant?: MarkdownRendererVariant
}) {
  const components = useMemo(
    () =>
      commandPillRenderer
        ? createMarkdownComponents(variant, commandPillRenderer)
        : variant === 'conversation'
          ? CONVERSATION_COMPONENTS
          : DOCUMENT_COMPONENTS,
    [commandPillRenderer, variant],
  )

  return (
    <div
      className={ROOT_CLASS_BY_VARIANT[variant]}
      data-markdown-renderer={variant}
      data-markdown-viewer={variant === 'document' ? 'true' : undefined}
    >
      <ReactMarkdown
        components={components}
        remarkPlugins={REMARK_PLUGINS}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

function createMarkdownComponents(variant: MarkdownRendererVariant, commandPillRenderer?: CommandPillRenderer): Components {
  const headingClass = HEADING_CLASS_BY_VARIANT[variant]
  const renderChildren = (children: ReactNode) => renderInlineCommandPills(children, commandPillRenderer)

  return {
    a({ children, href, node: _node, ...props }) {
      return (
        <a
          className="text-foreground underline underline-offset-4"
          href={href}
          rel="noreferrer"
          target="_blank"
          {...props}
        >
          {children}
        </a>
      )
    },
    blockquote({ children, node: _node, ...props }) {
      return (
        <blockquote
          className={cn('border-l-2 border-border pl-4 text-muted-foreground', LONG_TEXT_BLOCK_CLASS_BY_VARIANT[variant])}
          {...props}
        >
          {children}
        </blockquote>
      )
    },
    code({ children, className, node: _node, ...props }) {
      const codeText = textFromReactNode(children) ?? ''
      if (commandPillRenderer && !className && !codeText.includes('\n') && hasRenderableCommand(codeText)) {
        return <>{renderCommandText(codeText, commandPillRenderer)}</>
      }

      return (
        <code className={cn(CODE_CLASS_BY_VARIANT[variant], className)} {...props}>
          {children}
        </code>
      )
    },
    h1({ children, node: _node, ...props }) {
      return (
        <h1 className={cn(headingClass, variant === 'document' ? 'text-xl' : 'text-base')} {...props}>
          {children}
        </h1>
      )
    },
    h2({ children, node: _node, ...props }) {
      return (
        <h2 className={cn(headingClass, variant === 'document' ? 'text-lg' : 'text-sm')} {...props}>
          {children}
        </h2>
      )
    },
    h3({ children, node: _node, ...props }) {
      return (
        <h3 className={cn(headingClass, 'text-base')} {...props}>
          {children}
        </h3>
      )
    },
    img({ alt, node: _node, ..._props }) {
      return (
        <span className="text-xs text-muted-foreground">[图片{alt ? `：${alt}` : ''}]</span>
      )
    },
    li({ children, node: _node, ...props }) {
      return (
        <li className="pl-1" {...props}>
          {renderChildren(children)}
        </li>
      )
    },
    ol({ children, node: _node, ...props }) {
      return (
        <ol className={cn('list-decimal space-y-1 pl-5', LONG_TEXT_BLOCK_CLASS_BY_VARIANT[variant])} {...props}>
          {children}
        </ol>
      )
    },
    p({ children, node: _node, ...props }) {
      return (
        <p
          className={cn('whitespace-pre-wrap break-words [overflow-wrap:anywhere]', LONG_TEXT_BLOCK_CLASS_BY_VARIANT[variant])}
          {...props}
        >
          {renderChildren(children)}
        </p>
      )
    },
    pre({ children, node: _node, ...props }) {
      return (
        <pre
          className={cn(
            'max-w-full overflow-auto rounded-row bg-active p-4 font-mono text-xs leading-6 text-body-foreground',
            LONG_PANEL_BLOCK_CLASS_BY_VARIANT[variant],
          )}
          {...props}
        >
          {children}
        </pre>
      )
    },
    table({ children, node: _node, ...props }) {
      return (
        <div className={cn(TABLE_WRAP_CLASS_BY_VARIANT[variant], LONG_PANEL_BLOCK_CLASS_BY_VARIANT[variant])}>
          <table className={TABLE_CLASS_BY_VARIANT[variant]} {...props}>
            {children}
          </table>
        </div>
      )
    },
    tbody({ children, node: _node, ...props }) {
      return (
        <tbody className="divide-y divide-border" {...props}>
          {children}
        </tbody>
      )
    },
    td({ children, node: _node, ...props }) {
      return (
        <td
          className="whitespace-pre-wrap break-words align-top px-3 py-2 text-muted-foreground [overflow-wrap:anywhere]"
          {...props}
        >
          {renderChildren(children)}
        </td>
      )
    },
    th({ children, node: _node, ...props }) {
      return (
        <th
          className="whitespace-pre-wrap break-words border-b border-border px-3 py-2 font-medium [overflow-wrap:anywhere]"
          scope="col"
          {...props}
        >
          {renderChildren(children)}
        </th>
      )
    },
    thead({ children, node: _node, ...props }) {
      return (
        <thead className="bg-active text-foreground" {...props}>
          {children}
        </thead>
      )
    },
    ul({ children, node: _node, ...props }) {
      return (
        <ul className={cn('list-disc space-y-1 pl-5', LONG_TEXT_BLOCK_CLASS_BY_VARIANT[variant])} {...props}>
          {children}
        </ul>
      )
    },
  }
}

function renderInlineCommandPills(children: ReactNode, commandPillRenderer?: CommandPillRenderer): ReactNode {
  if (!commandPillRenderer) return children

  return Children.map(children, (child) => {
    if (typeof child === 'string') return renderCommandText(child, commandPillRenderer)
    return child
  })
}

function textFromReactNode(node: ReactNode): string | null {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!Array.isArray(node)) return null

  const parts = node.map((child) => textFromReactNode(child))
  if (parts.some((part) => part === null)) return null
  return parts.join('')
}

function hasRenderableCommand(text: string): boolean {
  for (const match of text.matchAll(/\/narracat:[a-z-]+/gi)) {
    if (resolveAgentQuickActionFromCommandLabel(match[0])) return true
  }

  return false
}

function renderCommandText(text: string, commandPillRenderer: CommandPillRenderer): ReactNode[] {
  const nodes: ReactNode[] = []
  const commandPattern = /\/narracat:[a-z-]+/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = commandPattern.exec(text)) !== null) {
    const commandLabel = match[0]
    const action = resolveAgentQuickActionFromCommandLabel(commandLabel)
    if (!action) continue

    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    nodes.push(
      <Fragment key={`${commandLabel}-${match.index}`}>
        {commandPillRenderer(commandLabel, action)}
      </Fragment>,
    )
    lastIndex = match.index + commandLabel.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes.length > 0 ? nodes : [text]
}
