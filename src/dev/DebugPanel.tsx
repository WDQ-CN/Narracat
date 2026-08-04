// dev-only 通用调试面板。通过控件 schema 实时调参 + 复制 JSON。
// 仅在 import.meta.env.DEV 下被动态加载，生产构建不打包（见 FirstRunIntro 的动态 import）。
import { useState } from 'react'

export type DebugField =
  | { type: 'range'; key: string; label: string; min: number; max: number; step: number }
  | { type: 'number'; key: string; label: string; min?: number; max?: number; step?: number }
  | { type: 'color'; key: string; label: string }
  | { type: 'boolean'; key: string; label: string }
  | { type: 'text'; key: string; label: string }

export interface DebugPanelProps {
  /** 面板顶部标题（如当前幕名） */
  title: string
  /** 副标题（如“第 2 / 5 幕”） */
  subtitle?: string
  fields: DebugField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  /** 复制当前幕参数 */
  onCopyStage: () => void
  /** 复制全部幕参数 */
  onCopyAll: () => void
  /** 重播当前幕动画 */
  onReplay?: () => void
}

const ROW = 'flex items-center gap-2 py-1 text-[11px]'
const LABEL = 'w-28 shrink-0 truncate text-zinc-400'
const NUM_INPUT =
  'w-16 shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-right text-[11px] text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500'

function Field({
  field,
  value,
  onChange,
}: {
  field: DebugField
  value: unknown
  onChange: (value: unknown) => void
}) {
  if (field.type === 'range') {
    const v = Number(value)
    return (
      <div className={ROW}>
        <span className={LABEL}>{field.label}</span>
        <input
          type="range"
          min={field.min}
          max={field.max}
          step={field.step}
          value={v}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1 flex-1 accent-emerald-500"
        />
        <input
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={v}
          onChange={(e) => onChange(Number(e.target.value))}
          className={NUM_INPUT}
        />
      </div>
    )
  }

  if (field.type === 'number') {
    return (
      <div className={ROW}>
        <span className={LABEL}>{field.label}</span>
        <input
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`${NUM_INPUT} ml-auto`}
        />
      </div>
    )
  }

  if (field.type === 'color') {
    const hex = String(value)
    return (
      <div className={ROW}>
        <span className={LABEL}>{field.label}</span>
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className="h-5 w-8 shrink-0 cursor-pointer rounded border border-zinc-700 bg-transparent"
        />
        <input
          type="text"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className={`${NUM_INPUT} w-20`}
        />
      </div>
    )
  }

  if (field.type === 'boolean') {
    return (
      <div className={ROW}>
        <span className={LABEL}>{field.label}</span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="ml-auto size-3.5 accent-emerald-500"
        />
      </div>
    )
  }

  // text
  return (
    <div className="py-1 text-[11px]">
      <span className="mb-1 block text-zinc-400">{field.label}</span>
      <textarea
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full resize-none rounded bg-zinc-800 px-1.5 py-1 text-[11px] text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </div>
  )
}

export function DebugPanel({
  title,
  subtitle,
  fields,
  values,
  onChange,
  onCopyStage,
  onCopyAll,
  onReplay,
}: DebugPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [copied, setCopied] = useState<'stage' | 'all' | null>(null)

  const copy = (which: 'stage' | 'all') => {
    if (which === 'stage') onCopyStage()
    else onCopyAll()
    setCopied(which)
    window.setTimeout(() => setCopied(null), 1200)
  }

  return (
    <div className="pointer-events-auto fixed right-3 top-3 z-[100] w-64 select-none rounded-lg border border-zinc-700 bg-zinc-900/95 text-zinc-100 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">{title}</div>
          {subtitle && <div className="truncate text-[10px] text-zinc-500">{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800"
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="max-h-[60vh] overflow-y-auto px-3 py-1">
            {fields.length === 0 ? (
              <div className="py-3 text-center text-[11px] text-zinc-500">本幕暂无可调参数</div>
            ) : (
              fields.map((field) => (
                <Field
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  onChange={(v) => onChange(field.key, v)}
                />
              ))
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-zinc-700 px-3 py-2">
            <button
              type="button"
              onClick={() => copy('stage')}
              className="flex-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium hover:bg-emerald-500"
            >
              {copied === 'stage' ? '已复制 ✓' : '复制本幕'}
            </button>
            <button
              type="button"
              onClick={() => copy('all')}
              className="flex-1 rounded bg-zinc-700 px-2 py-1 text-[11px] font-medium hover:bg-zinc-600"
            >
              {copied === 'all' ? '已复制 ✓' : '复制全部'}
            </button>
            {onReplay && (
              <button
                type="button"
                onClick={onReplay}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-[11px] hover:bg-zinc-700"
              >
                重播本幕动画
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
