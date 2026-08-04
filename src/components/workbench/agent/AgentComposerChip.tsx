import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

interface AgentComposerChipProps {
  label: string
  onActivate?: () => void
  onRemove?: () => void
  disabled?: boolean
  tone?: 'neutral' | 'command'
  className?: string
  title?: string
}

export function AgentComposerChip({
  label,
  onActivate,
  onRemove,
  disabled = false,
  tone = 'neutral',
  className,
  title,
}: AgentComposerChipProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 max-w-full items-center gap-0.5 rounded-full px-1.5',
        'text-xs font-medium leading-none ring-1 ring-inset',
        tone === 'command'
          ? 'bg-success/10 text-success ring-success/30'
          : 'bg-active text-foreground ring-transparent',
        className
      )}
    >
      {onActivate ? (
        <button
          type="button"
          className="min-w-0 truncate rounded-full text-current outline-none disabled:cursor-not-allowed"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            onActivate()
          }}
          aria-label={`切换${label}命令`}
        >
          {label}
        </button>
      ) : (
        <span className="min-w-0 truncate">{label}</span>
      )}
      {onRemove && (
        <button
          type="button"
          className="rounded-full text-current opacity-60 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled}
          onClick={onRemove}
          aria-label={`移除${label}命令`}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}
