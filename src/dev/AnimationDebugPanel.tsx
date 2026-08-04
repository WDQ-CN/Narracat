// dev-only：首次介绍各幕的动画调参面板。定义每幕可调控件 schema，复用通用 DebugPanel。
// 仅在 import.meta.env.DEV 下被 FirstRunIntro 动态加载，生产不打包。
import { DebugPanel, type DebugField } from './DebugPanel'

const STAGE_FIELDS: Record<string, { title: string; fields: DebugField[] }> = {
  manifesto: {
    title: '序幕 · 品牌理念',
    fields: [
      { type: 'range', key: 'charStagger', label: '逐字间隔(s)', min: 0, max: 0.1, step: 0.002 },
      { type: 'range', key: 'duration', label: '单字时长(s)', min: 0.1, max: 1, step: 0.05 },
      { type: 'range', key: 'lineDelay', label: '行间隔(s)', min: 0.1, max: 1, step: 0.05 },
    ],
  },
  craft: {
    title: '第2幕 · Threads 丝线',
    fields: [
      { type: 'color', key: 'threadsColor', label: '丝线颜色' },
      { type: 'color', key: 'bgColor', label: '幕背景色' },
      { type: 'range', key: 'lineCount', label: '丝线条数', min: 1, max: 60, step: 1 },
      { type: 'range', key: 'lineWidth', label: '丝线宽度', min: 1, max: 30, step: 0.5 },
      { type: 'range', key: 'lineBlur', label: '丝线模糊', min: 0, max: 30, step: 0.5 },
      { type: 'range', key: 'amplitude', label: '振幅', min: 0, max: 3, step: 0.1 },
      { type: 'range', key: 'distance', label: '分布', min: 0, max: 1, step: 0.05 },
    ],
  },
  characters: {
    title: '第3幕 · 角色画廊',
    fields: [
      { type: 'range', key: 'bend', label: '弯曲度', min: -5, max: 5, step: 0.1 },
      { type: 'range', key: 'borderRadius', label: '圆角', min: 0, max: 0.3, step: 0.01 },
      { type: 'color', key: 'textColor', label: '标签色' },
      { type: 'range', key: 'height', label: '高度(px)', min: 200, max: 600, step: 10 },
      { type: 'range', key: 'scrollSpeed', label: '滚动速度', min: 0.5, max: 5, step: 0.1 },
      { type: 'range', key: 'scrollEase', label: '滚动缓动', min: 0.01, max: 0.2, step: 0.01 },
    ],
  },
  memory: {
    title: '第4幕 · 文字粒子',
    fields: [
      { type: 'range', key: 'count', label: '字符数', min: 20, max: 600, step: 10 },
      { type: 'range', key: 'baseSize', label: '字号基准', min: 200, max: 2000, step: 50 },
      { type: 'range', key: 'spread', label: '分布范围', min: 4, max: 20, step: 0.5 },
      { type: 'range', key: 'speed', label: '速度', min: 0.02, max: 0.5, step: 0.02 },
      { type: 'range', key: 'sizeRandomness', label: '字号随机', min: 0, max: 2, step: 0.1 },
      { type: 'range', key: 'brandRatio', label: '品牌绿比例', min: 0, max: 1, step: 0.05 },
    ],
  },
  finale: {
    title: '终幕 · Logo + Slogan',
    fields: [
      { type: 'range', key: 'typingSpeed', label: '打字速度(ms)', min: 20, max: 200, step: 5 },
      { type: 'range', key: 'initialDelay', label: 'slogan延迟(ms)', min: 0, max: 2000, step: 100 },
      { type: 'range', key: 'shinySpeed', label: '高光周期(s)', min: 1, max: 6, step: 0.5 },
    ],
  },
}

export interface AnimationDebugPanelProps {
  stageKey: string
  step: number
  totalSteps: number
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  onCopyStage: () => void
  onCopyAll: () => void
  onReplay: () => void
}

export function AnimationDebugPanel({
  stageKey,
  step,
  totalSteps,
  values,
  onChange,
  onCopyStage,
  onCopyAll,
  onReplay,
}: AnimationDebugPanelProps) {
  const config = STAGE_FIELDS[stageKey] ?? { title: '当前幕', fields: [] }
  return (
    <DebugPanel
      title={config.title}
      subtitle={`第 ${step + 1} / ${totalSteps} 幕`}
      fields={config.fields}
      values={values}
      onChange={onChange}
      onCopyStage={onCopyStage}
      onCopyAll={onCopyAll}
      onReplay={onReplay}
    />
  )
}
